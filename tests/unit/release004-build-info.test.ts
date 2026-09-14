import assert from "node:assert/strict";
import test from "node:test";
import { buildInfoFromEnvironment } from "../../packages/config/src/build-info.js";

test("build metadata accepts only safe provenance fields", () => {
  const result = buildInfoFromEnvironment({
    APP_VERSION: "1.2.3-rc.4",
    GIT_COMMIT: "a".repeat(40),
    BUILD_TIME: "2026-09-15T00:00:00.000Z",
    IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
  });
  assert.deepEqual(result, {
    version: "1.2.3-rc.4",
    source_commit: "a".repeat(40),
    built_at: "2026-09-15T00:00:00.000Z",
    image_digest: `sha256:${"b".repeat(64)}`,
  });
});

test("build metadata does not reflect arbitrary environment values", () => {
  const result = buildInfoFromEnvironment({
    APP_VERSION: "token=secret",
    GIT_COMMIT: "unknown",
    BUILD_TIME: "not a date",
    IMAGE_DIGEST: "mutable-tag",
  });
  assert.deepEqual(result, {
    version: "unknown",
    source_commit: "unknown",
    built_at: "unknown",
    image_digest: null,
  });
});
