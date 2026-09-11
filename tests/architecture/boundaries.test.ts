import test from "node:test";
import assert from "node:assert/strict";
import { violation, check } from "../../scripts/check-boundaries.js";
test("dependency rules reject forbidden edges", () => {
  for (const [from, to] of [
    ["modules/identity/domain/a.ts", "modules/identity/infrastructure/b.ts"],
    ["modules/identity/application/a.ts", "modules/audit/infrastructure/b.ts"],
    ["packages/shared-kernel/src/a.ts", "modules/identity/index.ts"],
    ["modules/audit/index.ts", "apps/api/src/main.ts"],
  ])
    assert.ok(violation(from!, to!));
  assert.equal(
    violation("apps/api/src/main.ts", "modules/identity/index.ts"),
    undefined,
  );
});
test("repository dependency graph is valid", check);
