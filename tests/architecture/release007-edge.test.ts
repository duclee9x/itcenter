import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");
const root = process.cwd();

test("R7 Caddy configs enforce the API edge contract", () => {
  const production = read(`${root}/deploy/caddy/Caddyfile.production`);
  const staging = read(`${root}/deploy/caddy/Caddyfile.staging`);
  const manual = read(`${root}/deploy/caddy/Caddyfile.production.manual`);
  for (const config of [production, staging, manual]) {
    assert.match(config, /max_size 2MB/);
    assert.match(config, /dial_timeout 5s/);
    assert.match(config, /response_header_timeout 30s/);
    assert.match(config, /read_timeout 60s/);
    assert.match(config, /X-Content-Type-Options/);
    assert.match(config, /X-Frame-Options/);
    assert.match(config, /redir https:\/\//);
    assert.doesNotMatch(
      config,
      /X-Client-Cert|X-Agent-ID|X-Authenticated-Agent/,
    );
  }
  assert.match(production, /Strict-Transport-Security "max-age=86400"/);
  assert.doesNotMatch(staging, /Strict-Transport-Security/);
  assert.match(staging, /tls internal/);
  assert.match(manual, /\/run\/secrets\/api_tls_certificate/);
});

test("Compose keeps API/Postgres private and Agent Gateway direct", () => {
  const compose = read(`${root}/deploy/compose.yaml`);
  const production = read(`${root}/deploy/compose.production.yaml`);
  assert.match(compose, /CADDY_CONFIG_FILE/);
  assert.match(compose, /caddy.*validate/);
  assert.match(compose, /expose:\s*\["3000"\]/);
  const caddy = compose.split("  caddy:")[1]?.split("\nsecrets:")[0] ?? "";
  assert.match(caddy, /CADDY_CONFIG_FILE/);
  assert.doesNotMatch(compose, /X-Client-Cert/);
  assert.match(production, /AGENT_HOST_PORT:-3001}:3001/);
  assert.doesNotMatch(production, /api:3000|5432/);
});

test("deployment validates Caddy before rollout and smoke checks HTTP redirect", () => {
  assert.match(
    read(`${root}/deploy/scripts/deploy.sh`),
    /validate_caddy_config/,
  );
  assert.match(
    read(`${root}/deploy/scripts/smoke.sh`),
    /PUBLIC_HTTP_REDIRECT_FAILED/,
  );
});
