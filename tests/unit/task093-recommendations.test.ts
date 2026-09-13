import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRecommendationText,
  recommendationContextHash,
  scoreKnowledgeRecommendation,
} from "../../modules/problem/index.js";

const article = {
  knowledgeId: "kb-1",
  title: "VPN connection timeout on Windows",
  body: "Use the approved VPN recovery procedure.",
};

test("TASK-093 v1 scoring uses the strongest exact Known Error signal without double counting", () => {
  const result = scoreKnowledgeRecommendation({
    ...article,
    context: {
      description: "VPN connection timeout",
      category: "VPN connection timeout",
      known_error_id: "ke-1",
      problem_id: "ke-1",
      service_id: "service-1",
    },
    applicability: [
      { type: "KNOWN_ERROR", id: "ke-1" },
      { type: "PROBLEM", id: "ke-1" },
      { type: "SERVICE", id: "service-1" },
    ],
    historicalSuccess: true,
  });
  assert.equal(result.score, 100);
  assert.deepEqual(
    result.evidence.map(({ code, points }) => [code, points]),
    [
      ["EXACT_KNOWN_ERROR", 60],
      ["SAME_CANONICAL_SERVICE_OR_PRODUCT", 20],
      ["SAME_NORMALIZED_CATEGORY_OR_SYMPTOM", 15],
      ["PRIOR_CONFIRMED_DEFLECTION_CONTEXT", 10],
    ],
  );
  assert.equal(result.strong, true);
});

test("TASK-093 v1 scoring includes same Problem evidence when no exact binding exists", () => {
  const result = scoreKnowledgeRecommendation({
    ...article,
    context: {
      description: "VPN connection timeout",
      problem_id: "problem-1",
      platform_id: "platform-1",
      service_environment_id: "environment-1",
    },
    applicability: [
      { type: "PROBLEM", id: "problem-1" },
      { type: "PLATFORM", id: "platform-1" },
      { type: "SERVICE_ENVIRONMENT", id: "environment-1" },
    ],
    historicalSuccess: true,
  });
  assert.equal(result.score, 70);
  assert.deepEqual(
    result.evidence.map(({ code, points }) => [code, points]),
    [
      ["SAME_PROBLEM_OR_KNOWN_ERROR", 50],
      ["SAME_CANONICAL_PLATFORM_OR_ENVIRONMENT", 10],
      ["PRIOR_CONFIRMED_DEFLECTION_CONTEXT", 10],
    ],
  );
});

test("TASK-093 v1 caps explainable score at 100 and groups service/product and platform/environment", () => {
  const result = scoreKnowledgeRecommendation({
    ...article,
    context: {
      description: "VPN connection timeout",
      knowledge_id: article.knowledgeId,
      known_error_id: "ke-1",
      problem_id: "problem-1",
      service_id: "service-1",
      software_product_id: "product-1",
      platform_id: "platform-1",
      service_environment_id: "environment-1",
      category: "VPN connection timeout",
    },
    applicability: [
      { type: "KNOWN_ERROR", id: "ke-1" },
      { type: "PROBLEM", id: "problem-1" },
      { type: "SERVICE", id: "service-1" },
      { type: "SOFTWARE_PRODUCT", id: "product-1" },
      { type: "PLATFORM", id: "platform-1" },
      { type: "SERVICE_ENVIRONMENT", id: "environment-1" },
    ],
    historicalSuccess: true,
  });
  assert.equal(result.score, 100);
  assert.equal(
    result.evidence.filter(
      (item) => item.code === "SAME_CANONICAL_SERVICE_OR_PRODUCT",
    ).length,
    1,
  );
  assert.equal(
    result.evidence.filter(
      (item) => item.code === "SAME_CANONICAL_PLATFORM_OR_ENVIRONMENT",
    ).length,
    1,
  );
  assert.equal(
    result.evidence.filter(
      (item) => item.code === "SAME_PROBLEM_OR_KNOWN_ERROR",
    ).length,
    0,
  );
});

test("TASK-093 normalization and historical context identity exclude ephemeral ticket identity", () => {
  assert.equal(
    normalizeRecommendationText("Échec réseau — VPN"),
    "echec reseau vpn",
  );
  const first = recommendationContextHash({
    description: "VPN failure",
    category: "Network",
    ticket_id: "ticket-a",
  });
  const replay = recommendationContextHash({
    description: " VPN   failure ",
    category: "NETWORK",
    ticket_id: "ticket-b",
  });
  assert.equal(first, replay);
});
