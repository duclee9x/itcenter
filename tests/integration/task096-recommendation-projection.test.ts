import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  materializeRecommendationSource,
  readRecommendationById,
  recordRecommendationInteraction,
  reconcileRecommendationSources,
} from "../../modules/recommendation/index.js";
import { testDatabase } from "../helpers.js";
import type {
  AuthorizationPort,
  Principal,
} from "../../packages/auth/src/index.js";

const source = (sourceId: string, version: number) => ({
  family: "KNOWLEDGE_GUIDANCE" as const,
  source_domain: "KNOWLEDGE" as const,
  source_type: "KNOWLEDGE_RECOMMENDATION_ITEM",
  source_id: sourceId,
  contexts: [{ type: "RECOMMENDATION_SESSION" as const, id: sourceId }],
  generation: { source_id: sourceId, source_version: version },
  source_version: { source_version: version },
  profile_id: "TASK-093-SELF-SERVICE",
  profile_version: 1,
  rank: 1,
  score: 84,
  reason_codes: ["EXACT_KNOWN_ERROR"],
  evidence_summary: { categories: ["KNOWN_ERROR"] },
  freshness: { state: "ELIGIBLE" },
  initial_provenance: "INITIAL_RECONCILIATION" as const,
});

test("TASK-096 same-generation retries are idempotent; revisions append and actor dismissal is revision scoped", async () => {
  const db = await testDatabase();
  const tenant = `task096-${randomUUID()}`;
  const itemId = randomUUID();
  try {
    const concurrent = await Promise.all([
      db.uow.run(tenant, (tx) =>
        materializeRecommendationSource({
          tx,
          source: source(itemId, 1),
          generatedAt: "2026-09-01T00:00:00.000Z",
        }),
      ),
      db.uow.run(tenant, (tx) =>
        materializeRecommendationSource({
          tx,
          source: source(itemId, 1),
          generatedAt: "2026-09-01T00:00:00.000Z",
        }),
      ),
    ]);
    const first = concurrent.find((result) => result.created)!;
    assert.equal(concurrent.filter((result) => result.created).length, 1);
    const retry = await db.uow.run(tenant, (tx) =>
      materializeRecommendationSource({
        tx,
        source: source(itemId, 1),
        generatedAt: "2026-09-01T00:01:00.000Z",
      }),
    );
    assert.equal(first.revision, 1);
    assert.equal(first.created, true);
    assert.equal(retry.revision, 1);
    assert.equal(retry.created, false);

    const second = await db.uow.run(tenant, (tx) =>
      materializeRecommendationSource({
        tx,
        source: source(itemId, 2),
        generatedAt: "2026-09-02T00:00:00.000Z",
      }),
    );
    assert.equal(second.revision, 2);
    assert.equal(second.created, true);
    const staleReplay = await db.uow.run(tenant, (tx) =>
      materializeRecommendationSource({
        tx,
        source: source(itemId, 1),
        generatedAt: "2026-09-03T00:00:00.000Z",
      }),
    );
    assert.equal(staleReplay.revision, 2);
    assert.equal(
      "stale_generation" in staleReplay && staleReplay.stale_generation,
      true,
    );

    const recommendation = await db.pool.query<{ id: string }>(
      "SELECT id FROM recommendation.recommendations WHERE tenant_id=$1 AND source_id=$2",
      [tenant, itemId],
    );
    const recommendationId = recommendation.rows[0]!.id;
    const interactionKey = randomUUID();
    const dismissed = await db.uow.run(tenant, (tx) =>
      recordRecommendationInteraction({
        tx,
        recommendationId,
        revision: 2,
        actorId: "actor-a",
        interaction: "DISMISSED",
        idempotencyKey: interactionKey,
        correlationId: randomUUID(),
      }),
    );
    const replay = await db.uow.run(tenant, (tx) =>
      recordRecommendationInteraction({
        tx,
        recommendationId,
        revision: 2,
        actorId: "actor-a",
        interaction: "DISMISSED",
        idempotencyKey: interactionKey,
        correlationId: randomUUID(),
      }),
    );
    assert.equal(dismissed.replayed, false);
    assert.equal(replay.replayed, true);
    const actorA = await db.uow.run(tenant, (tx) =>
      readRecommendationById({
        tx,
        recommendationId,
        actorId: "actor-a",
      }),
    );
    const actorB = await db.uow.run(tenant, (tx) =>
      readRecommendationById({
        tx,
        recommendationId,
        actorId: "actor-b",
      }),
    );
    assert.ok((actorA?.actor_interactions as string[]).includes("DISMISSED"));
    assert.deepEqual(actorB?.actor_interactions, []);
    await db.uow.run(tenant, (tx) =>
      materializeRecommendationSource({
        tx,
        source: source(itemId, 3),
        generatedAt: "2026-09-04T00:00:00.000Z",
      }),
    );
    const state = await db.pool.query<{
      revision: number;
      source_generation: { source_version: number };
    }>(
      `SELECT revision,source_generation FROM recommendation.recommendation_revisions
        WHERE tenant_id=$1 AND recommendation_id=$2 ORDER BY revision`,
      [tenant, recommendationId],
    );
    assert.deepEqual(
      state.rows.map((row) => row.revision),
      [1, 2, 3],
    );
    assert.deepEqual(
      state.rows.map((row) => row.source_generation.source_version),
      [1, 2, 3],
    );
    const actors = await db.pool.query<{ actor_id: string; revision: number }>(
      `SELECT actor_id,revision FROM recommendation.recommendation_interactions
        WHERE tenant_id=$1 AND recommendation_id=$2`,
      [tenant, recommendationId],
    );
    assert.deepEqual(actors.rows, [{ actor_id: "actor-a", revision: 2 }]);
    await assert.rejects(
      db.pool.query(
        `UPDATE recommendation.recommendation_revisions SET reason_codes='{}'
          WHERE tenant_id=$1 AND recommendation_id=$2 AND revision=1`,
        [tenant, recommendationId],
      ),
      /immutable/i,
    );
    await assert.rejects(
      db.pool.query("TRUNCATE recommendation.recommendation_revisions"),
      /immutable|foreign key/i,
    );
    await assert.rejects(
      db.pool.query("TRUNCATE recommendation.recommendation_interactions"),
      /append-only/i,
    );
    const count = await db.pool.query<{ count: string }>(
      "SELECT count(*) FROM recommendation.recommendation_revisions WHERE tenant_id=$1 AND recommendation_id=$2",
      [tenant, recommendationId],
    );
    assert.equal(count.rows[0]!.count, "3");
  } finally {
    await db.close();
  }
});

test("TASK-096 reports AVAILABLE_EMPTY separately from source failure for every family", async () => {
  const db = await testDatabase();
  const tenant = `task096-availability-${randomUUID()}`;
  const user: Principal = {
    id: "reviewer",
    tenant_id: tenant,
    actor_type: "USER",
  };
  const allow: AuthorizationPort = {
    async evaluate() {
      return { result: "ALLOW", reason: "test authorization" };
    },
  };
  const deny: AuthorizationPort = {
    async evaluate() {
      return { result: "DENY", reason: "no source access" };
    },
  };
  const context = {
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    causation_id: randomUUID(),
  };
  try {
    const available = await db.uow.run(tenant, (tx) =>
      reconcileRecommendationSources({
        tx,
        principal: user,
        authorization: allow,
        correlation: context,
      }),
    );
    for (const family of Object.values(available.families))
      assert.equal(family.availability, "AVAILABLE_EMPTY");
    const watermarks = await db.pool.query<{ count: string }>(
      "SELECT count(*) FROM recommendation.source_watermarks WHERE tenant_id=$1 AND last_success_at IS NOT NULL",
      [tenant],
    );
    assert.equal(watermarks.rows[0]!.count, "3");

    const unavailableTenant = `task096-unavailable-${randomUUID()}`;
    const unavailable = await db.uow.run(unavailableTenant, (tx) =>
      reconcileRecommendationSources({
        tx,
        principal: { ...user, tenant_id: unavailableTenant },
        authorization: deny,
        correlation: context,
      }),
    );
    for (const family of Object.values(unavailable.families))
      assert.equal(family.availability, "SOURCE_UNAVAILABLE");
    const errors = await db.pool.query<{ count: string }>(
      "SELECT count(*) FROM recommendation.source_watermarks WHERE tenant_id=$1 AND last_error_code IS NOT NULL",
      [unavailableTenant],
    );
    assert.equal(errors.rows[0]!.count, "3");
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        reconcileRecommendationSources({
          tx,
          principal: { ...user, tenant_id: "other-tenant" },
          authorization: allow,
          correlation: context,
        }),
      ),
      /Access denied/i,
    );
  } finally {
    await db.close();
  }
});
