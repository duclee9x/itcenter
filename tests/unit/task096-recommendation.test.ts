import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOMMENDATION_FAMILIES,
  availableSourceAction,
  canonicalSourceGeneration,
} from "../../modules/recommendation/index.js";
import {
  incidentSource,
  replacementSource,
} from "../../modules/recommendation/index.js";

test("TASK-096 catalog is exactly three source-owned families with no shared score", () => {
  assert.deepEqual(RECOMMENDATION_FAMILIES, [
    "INCIDENT_CORRELATION_REVIEW",
    "KNOWLEDGE_GUIDANCE",
    "ASSET_REPLACEMENT_REVIEW",
  ]);
  for (const family of RECOMMENDATION_FAMILIES) {
    assert.ok(availableSourceAction(family).action_type);
    assert.equal("universal_score" in availableSourceAction(family), false);
  }
});

test("source generation serialization is deterministic and preserves family data values", () => {
  assert.equal(
    canonicalSourceGeneration({ version: 3, source: { id: "a", rank: 1 } }),
    canonicalSourceGeneration({ source: { rank: 1, id: "a" }, version: 3 }),
  );
  assert.notEqual(
    canonicalSourceGeneration({ version: 3, score: 82 }),
    canonicalSourceGeneration({ version: 4, score: 82 }),
  );
});

test("family adapters preserve owner scores, profiles, reasons and evidence without normalization", () => {
  const incident = incidentSource({
    decision_id: "decision-1",
    incident_id: "incident-1",
    candidates: [
      {
        root_incident_id: "root-1",
        raw_score: 91,
        confidence: 84,
        strong_signals: ["SAME_SERVICE"],
        evidence_categories: ["SAME_SERVICE"],
      },
    ],
    decision_state: "REVIEW_REQUIRED",
    confidence: 84,
    ambiguity: { reason_code: "AMBIGUOUS_CANDIDATES", candidate_count: 1 },
    reason_codes: ["AMBIGUOUS_CANDIDATES"],
    profile_id: "TASK-092-V1",
    profile_version: 1,
    source_generation: "decision-1",
    evaluation_identity: "eval-1",
    evaluated_at: "2026-09-01T00:00:00.000Z",
    eligible: true,
  });
  const replacement = replacementSource({
    candidate_id: "candidate-1",
    asset_id: "asset-1",
    candidate_state: "UNDER_REVIEW",
    candidate_version: 4,
    assessment_id: "assessment-1",
    score: 78,
    band: "PRIORITY",
    completeness: 91,
    profile_id: "TASK-094-V1",
    profile_version: "1",
    reasons: ["REPLACEMENT_PRIORITY"],
    contributions: { risk: { available: true, score: 35 } },
    calculated_at: "2026-09-01T00:00:00.000Z",
    valid_until: "2026-09-02T00:00:00.000Z",
    freshness: "CURRENT",
    source_generation: {
      candidate_id: "candidate-1",
      candidate_version: 4,
      assessment_id: "assessment-1",
    },
    eligible: true,
  });
  assert.equal(incident.score, 84);
  assert.equal(incident.profile_id, "TASK-092-V1");
  assert.deepEqual(incident.reason_codes, ["AMBIGUOUS_CANDIDATES"]);
  assert.equal(
    (incident.evidence_summary.candidates as Array<{ raw_score: number }>)[0]
      ?.raw_score,
    91,
  );
  assert.deepEqual(
    (
      incident.evidence_summary.candidates as Array<{
        strong_signals: string[];
      }>
    )[0]?.strong_signals,
    ["SAME_SERVICE"],
  );
  assert.equal(replacement.score, 78);
  assert.equal(replacement.band, "PRIORITY");
  assert.equal(replacement.profile_id, "TASK-094-V1");
  assert.deepEqual(replacement.reason_codes, ["REPLACEMENT_PRIORITY"]);
  assert.equal("global_score" in incident, false);
  assert.equal("global_score" in replacement, false);
});
