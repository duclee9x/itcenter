import test from "node:test";
import assert from "node:assert/strict";
import {
  ageContribution,
  ageMonthsUtc,
  calculateReplacement,
  calculateRisk,
  currentConditionEvidence,
  economicRepairContribution,
  replacementBand,
  riskBand,
  warrantyContribution,
} from "../../modules/asset/domain/scoring.js";

const emptyRisk = (
  overrides: Partial<Parameters<typeof calculateRisk>[0]> = {},
) =>
  calculateRisk({
    health: "HEALTHY",
    operational: "ONLINE",
    incidentEpisodes: 0,
    monitoringEpisodes: 0,
    monitoringIdentityAvailable: true,
    incidentMonitoringEpisodeIds: [],
    monitoringEpisodeIds: [],
    maintenanceCorrectiveCount: 0,
    maintenanceUnknownCount: 0,
    maintenanceAvailable: true,
    ...overrides,
  });

test("TASK-094 current condition uses max to prevent correlated double count", () => {
  const condition = currentConditionEvidence("CRITICAL", "OFFLINE");
  assert.equal(condition.score, 40);
  assert.equal(condition.available, true);
  assert.equal(currentConditionEvidence("WARNING", "MAINTENANCE").score, 20);
  assert.equal(currentConditionEvidence("UNKNOWN", "OFFLINE").score, 30);
  assert.equal(currentConditionEvidence("UNKNOWN", "OFFLINE").available, false);
});

test("TASK-094 reliability deduplicates Monitoring overlaps and Root episodes", () => {
  const risk = emptyRisk({
    incidentEpisodes: 2,
    monitoringEpisodes: 4,
    incidentMonitoringEpisodeIds: ["root-episode-a"],
    monitoringEpisodeIds: ["root-episode-a", "m2", "m3", "m4"],
  });
  assert.equal(risk.groups.RELIABILITY?.score, 25);
  assert.deepEqual(risk.groups.RELIABILITY?.details, {
    incident_episode_count: 2,
    incident_contribution: 25,
    monitoring_episode_count_before_overlap: 4,
    monitoring_incident_overlap_excluded: 1,
    monitoring_episode_count: 3,
    monitoring_contribution: 25,
    combination: "MAX",
  });
});

test("TASK-094 reliability and maintenance evidence preserve unavailable versus empty", () => {
  const empty = emptyRisk();
  assert.equal(empty.score, 0);
  assert.equal(empty.completeness, 100);
  const unknownMaintenance = emptyRisk({ maintenanceUnknownCount: 2 });
  assert.equal(unknownMaintenance.groups.CORRECTIVE_MAINTENANCE?.score, 0);
  assert.equal(
    unknownMaintenance.groups.CORRECTIVE_MAINTENANCE?.available,
    false,
  );
  assert.equal(unknownMaintenance.completeness, 80);
  const failedReliability = emptyRisk({
    incidentEpisodes: null,
    monitoringEpisodes: null,
    monitoringIdentityAvailable: false,
  });
  assert.equal(failedReliability.groups.RELIABILITY?.available, false);
  assert.equal(failedReliability.completeness, 60);
});

test("TASK-094 partial evidence band never labels incomplete low score as healthy", () => {
  assert.equal(riskBand(15, 40), "UNKNOWN");
  assert.equal(riskBand(50, 40), "HIGH");
  assert.equal(riskBand(70, 20), "CRITICAL");
  const partialCritical = emptyRisk({
    health: "CRITICAL",
    operational: "UNKNOWN",
    incidentEpisodes: null,
    monitoringEpisodes: null,
    monitoringIdentityAvailable: false,
    maintenanceAvailable: false,
  });
  assert.equal(partialCritical.score, 40);
  assert.equal(partialCritical.band, "UNKNOWN");
  const provenCritical = emptyRisk({
    health: "CRITICAL",
    operational: "UNKNOWN",
    incidentEpisodes: 3,
    monitoringEpisodes: null,
    monitoringIdentityAvailable: false,
    maintenanceAvailable: false,
  });
  assert.equal(provenCritical.score, 80);
  assert.equal(provenCritical.band, "CRITICAL");
});

test("TASK-094 age uses verified UTC calendar-month anniversaries", () => {
  assert.equal(ageMonthsUtc("2024-01-31", "2024-02-29T12:00:00.000Z"), 1);
  assert.equal(ageMonthsUtc("2024-01-31", "2024-02-28T12:00:00.000Z"), 0);
  assert.equal(ageMonthsUtc("2025-02-10", "2025-01-10T00:00:00.000Z"), null);
  assert.equal(ageMonthsUtc("invalid", "2025-01-10T00:00:00.000Z"), null);
});

test("TASK-094 useful-life ratio, Warranty and economic bands honor boundaries", () => {
  assert.equal(ageContribution(69, 100)?.score, 0);
  assert.equal(ageContribution(70, 100)?.score, 5);
  assert.equal(ageContribution(90, 100)?.score, 10);
  assert.equal(ageContribution(100, 100)?.score, 15);
  assert.equal(ageContribution(120, 100)?.score, 20);
  assert.equal(warrantyContribution("VALID"), 0);
  assert.equal(warrantyContribution("EXPIRING"), 5);
  assert.equal(warrantyContribution("EXPIRED"), 15);
  assert.equal(warrantyContribution("UNKNOWN"), null);
  assert.equal(economicRepairContribution(0.2), 5);
  assert.equal(economicRepairContribution(0.4), 10);
  assert.equal(economicRepairContribution(0.6), 15);
  assert.equal(economicRepairContribution(0.8), 25);
});

test("TASK-094 incomplete replacement low score is UNKNOWN; score bands remain decision support", () => {
  assert.equal(replacementBand(15, 55), "UNKNOWN");
  assert.equal(replacementBand(60, 55), "PLAN");
  assert.equal(replacementBand(80, 40), "PRIORITY");
  const assessment = calculateReplacement({
    riskScore: 90,
    ageScore: null,
    warrantyScore: 5,
    economicScore: null,
    components: {
      OPERATIONAL_RISK: {
        available: true,
        score: 36,
        details: { availability_weight: 40 },
      },
      AGE_USEFUL_LIFE: {
        available: false,
        score: 0,
        details: { availability_weight: 20 },
        missing_reason: "NO_POLICY",
      },
      WARRANTY: {
        available: true,
        score: 5,
        details: { availability_weight: 15 },
      },
      ECONOMIC_REPAIR: {
        available: false,
        score: 0,
        details: { availability_weight: 25 },
        missing_reason: "NO_LEDGER",
      },
    },
  });
  assert.equal(assessment.score, 41);
  assert.equal(assessment.completeness, 55);
  assert.equal(assessment.band, "UNKNOWN");
  const capped = calculateReplacement({
    riskScore: 100,
    ageScore: 20,
    warrantyScore: 15,
    economicScore: 25,
    components: {
      RISK: {
        available: true,
        score: 80,
        details: { availability_weight: 40 },
      },
      AGE: { available: true, score: 30, details: { availability_weight: 20 } },
      WARRANTY: {
        available: true,
        score: 20,
        details: { availability_weight: 15 },
      },
      ECONOMIC: {
        available: true,
        score: 40,
        details: { availability_weight: 25 },
      },
    },
  });
  assert.equal(capped.score, 100);
  assert.equal(capped.completeness, 100);
});
