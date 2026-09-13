import test from "node:test";
import assert from "node:assert/strict";
import {
  decideCorrelation,
  hasUnambiguousSharedSwitchIdentity,
  sharedTopologyFreshness,
  scoreCorrelationCandidate,
  type CorrelationEvidenceFacts,
  type ScoredCorrelationCandidate,
} from "../../modules/incident/index.js";

const facts = (overrides: Partial<CorrelationEvidenceFacts> = {}) => ({
  exactSourceKey: false,
  topologyFreshness: "UNKNOWN" as const,
  sameFailureDomainAncestor: false,
  sameVlanOrSubnet: false,
  sameSite: false,
  sameServiceOrDependency: false,
  sameSymptomFamily: false,
  onsetDifferenceMinutes: null,
  ...overrides,
});
const score = (values: Partial<CorrelationEvidenceFacts>) =>
  scoreCorrelationCandidate({
    rootIncidentId: "root",
    facts: facts(values),
    evidenceReferences: {},
  });

test("deterministic source correlation is strong and independent of time", () => {
  const result = score({ exactSourceKey: true, onsetDifferenceMinutes: 90 });
  assert.equal(result.score, 100);
  assert.deepEqual(result.strongSignals, ["DETERMINISTIC_SOURCE_KEY"]);
});

test("topology locality uses only the strongest fresh contribution", () => {
  const result = score({
    topologyFreshness: "FRESH",
    sameFailureDomainAncestor: true,
    sameVlanOrSubnet: true,
    sameSite: true,
  });
  assert.equal(result.rawScore, 60);
  assert.deepEqual(result.strongSignals, ["FRESH_FAILURE_DOMAIN_ANCESTOR"]);
});

test("stale or unknown topology contributes no topology points", () => {
  const result = score({
    topologyFreshness: "STALE",
    sameFailureDomainAncestor: true,
    sameVlanOrSubnet: true,
    sameSite: false,
  });
  assert.equal(result.score, 0);
  assert.equal(result.strongSignals.length, 0);
});

test("switch-name fallback needs the same tenant and one canonical shared scope", () => {
  const identity = {
    subjectTenantId: "tenant-a",
    candidateTenantId: "tenant-a",
    subjectScopeId: "site-1",
    candidateScopeId: "site-1",
    subjectSwitchName: "  Core   SW-01 ",
    candidateSwitchName: "core sw-01",
  };
  assert.equal(hasUnambiguousSharedSwitchIdentity(identity), true);
  const scopedFallbackStrong = hasUnambiguousSharedSwitchIdentity({
    ...identity,
    subjectScopeId: null,
  });
  const noScopeCandidate = score({
    topologyFreshness: "FRESH",
    sameFailureDomainAncestor: scopedFallbackStrong,
    sameServiceOrDependency: true,
    onsetDifferenceMinutes: 5,
  });
  assert.equal(noScopeCandidate.strongSignals.length, 0);
  assert.notEqual(
    decideCorrelation({ candidates: [noScopeCandidate] }).outcome,
    "AUTO_LINK",
  );
  assert.equal(
    hasUnambiguousSharedSwitchIdentity({ ...identity, subjectScopeId: null }),
    false,
  );
  assert.equal(
    hasUnambiguousSharedSwitchIdentity({
      ...identity,
      candidateScopeId: "site-2",
    }),
    false,
  );
  assert.equal(
    hasUnambiguousSharedSwitchIdentity({
      ...identity,
      candidateTenantId: "tenant-b",
    }),
    false,
  );
  assert.equal(
    hasUnambiguousSharedSwitchIdentity({
      ...identity,
      subjectSwitchName: "   ",
    }),
    false,
  );
});

test("shared topology evidence is fresh only when both observations are fresh", () => {
  assert.equal(sharedTopologyFreshness("FRESH", "FRESH"), "FRESH");
  assert.equal(sharedTopologyFreshness("FRESH", "STALE"), "STALE");
  assert.equal(sharedTopologyFreshness("STALE", "FRESH"), "STALE");
  assert.equal(sharedTopologyFreshness("FRESH", "UNKNOWN"), "UNKNOWN");
});

test("fresh shared failure domain with independent service/time evidence can auto-link", () => {
  const result = score({
    topologyFreshness: "FRESH",
    sameFailureDomainAncestor: true,
    sameVlanOrSubnet: true,
    sameSite: true,
    sameServiceOrDependency: true,
    onsetDifferenceMinutes: 5,
  });
  assert.equal(result.rawScore, 95);
  assert.deepEqual(result.strongSignals, ["FRESH_FAILURE_DOMAIN_ANCESTOR"]);
  assert.equal(
    decideCorrelation({ candidates: [result] }).outcome,
    "AUTO_LINK",
  );
});

test("temporal evidence uses exact inclusive boundaries", () => {
  assert.equal(score({ onsetDifferenceMinutes: 5 }).score, 15);
  assert.equal(score({ onsetDifferenceMinutes: 5.01 }).score, 10);
  assert.equal(score({ onsetDifferenceMinutes: 15 }).score, 10);
  assert.equal(score({ onsetDifferenceMinutes: 15.01 }).score, 0);
  assert.equal(score({ onsetDifferenceMinutes: -1 }).score, 0);
});

test("service, symptom and temporal evidence add independently and cap at 100", () => {
  const result = score({
    exactSourceKey: true,
    sameServiceOrDependency: true,
    sameSymptomFamily: true,
    onsetDifferenceMinutes: 4,
  });
  assert.equal(result.rawScore, 145);
  assert.equal(result.score, 100);
  assert.equal(result.contributions.length, 4);
});

test("VLAN, site and time evidence are not strong enough for AUTO_LINK", () => {
  const result = score({
    topologyFreshness: "FRESH",
    sameVlanOrSubnet: true,
    sameSite: true,
    sameServiceOrDependency: true,
    onsetDifferenceMinutes: 5,
  });
  assert.equal(result.score, 50);
  assert.equal(result.strongSignals.length, 0);
  assert.equal(decideCorrelation({ candidates: [result] }).outcome, "NO_LINK");
});

test("thresholds and candidate ambiguity are explicit", () => {
  const candidate = (
    rootIncidentId: string,
    scoreValue: number,
    strong = true,
  ): ScoredCorrelationCandidate => ({
    rootIncidentId,
    rawScore: scoreValue,
    score: scoreValue,
    strongSignals: strong ? ["DETERMINISTIC_SOURCE_KEY"] : [],
    contributions: [],
  });
  assert.equal(
    decideCorrelation({ candidates: [candidate("a", 59)] }).outcome,
    "NO_LINK",
  );
  assert.equal(
    decideCorrelation({ candidates: [candidate("a", 60)] }).outcome,
    "REVIEW_REQUIRED",
  );
  assert.equal(
    decideCorrelation({ candidates: [candidate("a", 90, false)] }).outcome,
    "REVIEW_REQUIRED",
  );
  assert.equal(
    decideCorrelation({ candidates: [candidate("a", 90), candidate("b", 59)] })
      .outcome,
    "AUTO_LINK",
  );
  assert.equal(
    decideCorrelation({ candidates: [candidate("a", 90), candidate("b", 60)] })
      .outcome,
    "REVIEW_REQUIRED",
  );
  assert.equal(
    decideCorrelation({ candidates: [candidate("a", 91), candidate("b", 88)] })
      .outcome,
    "REVIEW_REQUIRED",
  );
});

test("explicit ambiguity forces review without changing candidate evidence", () => {
  const result = decideCorrelation({
    candidates: [],
    explicitReviewReason: "ACTIVE_ROOT_CONFLICT",
  });
  assert.equal(result.outcome, "REVIEW_REQUIRED");
  assert.equal(result.reasonCode, "ACTIVE_ROOT_CONFLICT");
});
