import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  chmod,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const read = (relative: string) => readFile(path.join(root, relative), "utf8");
const digest = `registry.example.invalid/itcenter/app@sha256:${"a".repeat(64)}`;

test("one OCI digest drives all production processes and migration", async () => {
  const compose = await read("deploy/compose.yaml");
  assert.equal((compose.match(/image: \$\{APP_IMAGE/g) ?? []).length, 4);
  assert.equal((compose.match(/user: "1000:1000"/g) ?? []).length, 5);
  assert.equal(
    (compose.match(/userns_mode: "keep-id:uid=1000,gid=1000"/g) ?? []).length,
    5,
  );
  assert.equal((compose.match(/x-podman\.relabel: z/g) ?? []).length, 9);
  assert.match(compose, /userns_mode: "keep-id:uid=0,gid=0"/);
  assert.match(compose, /dist\/apps\/api\/src\/main\.js/);
  assert.match(compose, /dist\/apps\/agent-gateway\/src\/main\.js/);
  assert.match(compose, /dist\/apps\/worker\/src\/main\.js/);
  assert.match(compose, /dist\/database\/scripts\/migrate\.js/);
  assert.match(compose, /profiles: \["migration"\]/);
  assert.match(
    compose,
    /image: \$\{POSTGRES_IMAGE:\?Set immutable POSTGRES_IMAGE\}/,
  );
  assert.match(compose, /image: \$\{CADDY_IMAGE:\?Set immutable CADDY_IMAGE\}/);
  assert.match(
    compose,
    /DATABASE_SECRET_REF: file:\/run\/secrets\/database_url/,
  );
  assert.match(
    compose,
    /AGENT_AUTH_MODE: \$\{AGENT_AUTH_MODE:\?Set AGENT_AUTH_MODE=mtls\}/,
  );
  assert.doesNotMatch(
    compose,
    /X-Client-Cert|X-Agent-ID|X-Forwarded-Client-Cert/,
  );
  const postgres = compose.split("  postgres:")[1]?.split("  api:")[0] ?? "";
  assert.doesNotMatch(postgres, /^    ports:/m);
  const caddy = await read("deploy/caddy/Caddyfile");
  assert.match(caddy, /reverse_proxy api:3000/);
  assert.doesNotMatch(caddy, /agent-gateway|client.cert/i);
});

test("deployment profiles remain separate and production auth fails closed", async () => {
  const staging = await read("deploy/env/staging.example");
  const production = await read("deploy/env/production.example");
  const stagingRuntime = await read("deploy/env/runtime-staging.example");
  const productionRuntime = await read("deploy/env/runtime-production.example");
  assert.match(staging, /^COMPOSE_PROJECT_NAME=itsm-staging$/m);
  assert.match(production, /^COMPOSE_PROJECT_NAME=itsm-production$/m);
  assert.match(staging, /^AGENT_HOST_PORT=13001$/m);
  assert.match(staging, /^STAGING_HTTP_PORT=18080$/m);
  assert.match(staging, /^STAGING_HTTPS_PORT=18443$/m);
  assert.match(production, /^AGENT_HOST_PORT=3001$/m);
  assert.match(production, /^PRODUCTION_HTTP_PORT=8080$/m);
  assert.match(production, /^PRODUCTION_HTTPS_PORT=8443$/m);
  assert.match(
    production,
    /^RUNTIME_ENV_FILE=\/home\/itcenter\/\.config\/itcenter\/production\/runtime\.env$/m,
  );
  assert.match(production, /^POSTGRES_IMAGE=.*@sha256:[a-f0-9]{64}$/m);
  assert.match(production, /^CADDY_IMAGE=.*@sha256:[a-f0-9]{64}$/m);
  assert.match(staging, /\/staging\/secrets\/agent-ca-cert\.pem/);
  assert.match(production, /\/production\/secrets\/agent-ca-cert\.pem/);
  for (const runtime of [stagingRuntime, productionRuntime]) {
    assert.match(runtime, /^AUTH_MODE=oidc$/m);
    assert.match(runtime, /^AGENT_AUTH_MODE=mtls$/m);
    assert.match(
      runtime,
      /^DATABASE_SECRET_REF=file:\/run\/secrets\/database_url$/m,
    );
    assert.doesNotMatch(runtime, /mock|disabled|test-adapter/i);
  }
  assert.doesNotMatch(production, /latest|(^|:)main$/m);
  assert.doesNotMatch(production, /password=|PRIVATE KEY|client_secret=/i);
  assert.match(production, /^COMPOSE_PROJECT_NAME=itsm-production$/m);
});

test("container build is pinned, multi-stage, non-root, and excludes local credentials", async () => {
  const dockerfile = await read("Dockerfile");
  const ignore = await read(".dockerignore");
  assert.match(dockerfile, /^ARG NODE_VERSION=24\.21\.0$/m);
  assert.match(
    dockerfile,
    /FROM node:\$\{NODE_VERSION\}-bookworm-slim AS build/,
  );
  assert.match(
    dockerfile,
    /FROM node:\$\{NODE_VERSION\}-bookworm-slim AS runtime/,
  );
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm prune --omit=dev/);
  assert.match(dockerfile, /USER node/);
  assert.match(ignore, /^\.git$/m);
  assert.match(ignore, /^AGENTS\.md$/m);
  assert.match(ignore, /^\.npmrc$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^\*\.key$/m);
  assert.match(ignore, /^tests$/m);
});

test("deployment gates on digest, migration, and exact readiness; rollback checks schema", async () => {
  const deploy = await read("deploy/scripts/deploy.sh");
  const rollback = await read("deploy/scripts/rollback.sh");
  const common = await read("deploy/scripts/common.sh");
  const smoke = await read("deploy/scripts/smoke.sh");
  assert.match(common, /flock -n/);
  assert.match(deploy, /verify_image_digest/);
  assert.ok(
    deploy.indexOf("run --rm migrate") <
      deploy.indexOf("up -d --wait --remove-orphans"),
  );
  assert.match(deploy, /STAGING_VERIFICATION_REQUIRED/);
  assert.match(deploy, /PRE_MIGRATION_BACKUP_REQUIRED/);
  assert.match(smoke, /\.data\.status == "READY"/);
  assert.match(smoke, /\.data\.profile == "WORKER"/);
  assert.match(rollback, /current-schema-revision\.js/);
  assert.match(rollback, /FORWARD_FIX_REQUIRED_SCHEMA_INCOMPATIBLE/);
  assert.doesNotMatch(rollback, /dist\/database\/scripts\/migrate\.js|down --/);
  assert.doesNotMatch(
    deploy,
    /npm (install|run build)|docker build|git (clone|pull)/,
  );
  assert.match(common, /\$\{CONTAINER_CLI:-podman\}.*compose/);
  assert.match(common, /COMPOSE_PROVIDER_UNAVAILABLE/);
  assert.match(common, /XDG_STATE_HOME/);
  assert.doesNotMatch(common, /docker compose/);
});

test("systemd host boot restores only the recorded immutable production release", async () => {
  const start = await read("deploy/scripts/start-current.sh");
  const stop = await read("deploy/scripts/stop-stack.sh");
  const unit = await read("deploy/systemd/itsm-compose.service");
  assert.match(start, /production\/CURRENT\.json/);
  assert.match(start, /verify_image_digest/);
  assert.doesNotMatch(
    start,
    /dist\/database\/scripts\/migrate\.js|run --rm migrate/,
  );
  assert.match(stop, /down --timeout 10/);
  assert.match(unit, /start-current\.sh/);
  assert.match(unit, /stop-stack\.sh/);
  assert.doesNotMatch(unit, /docker\.service|Requires=docker/);
  assert.match(unit, /WantedBy=default\.target/);
});

async function deploymentFixture(baseDir: string) {
  const staging = await read("deploy/env/staging.example");
  const configFile = path.join(baseDir, "staging.env");
  const envRoot = path.join(baseDir, "staging");
  const config = staging
    .replaceAll("/home/itcenter/.config/itcenter/staging", envRoot)
    .replaceAll("idp-staging.example.invalid", "idp.staging.test")
    .replaceAll("itcenter-staging.example.invalid", "api.staging.test")
    .replaceAll("agent-staging.example.invalid", "agent.staging.test");
  await mkdir(path.join(envRoot, "secrets"), { recursive: true });
  await writeFile(
    configFile,
    config.replace(/^APP_IMAGE=.*$/m, `APP_IMAGE=${digest}`),
  );
  const runtimeExample = (
    await read("deploy/env/runtime-staging.example")
  ).replaceAll("idp-staging.example.invalid", "idp.staging.test");
  const runtimeFile = path.join(envRoot, "runtime.env");
  await writeFile(runtimeFile, runtimeExample);
  await chmod(configFile, 0o600);
  await chmod(runtimeFile, 0o600);
  for (const match of config.matchAll(/^([A-Z0-9_]+_FILE)=(.+)$/gm)) {
    if (match[1] === "RUNTIME_ENV_FILE") continue;
    const file = match[2]!;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      match[1] === "AGENT_CA_SIGNING_PASSPHRASE_FILE"
        ? ""
        : "test-only fixture\n",
    );
    await chmod(file, 0o600);
  }
  const rcFile = path.join(baseDir, "rc.json");
  await writeFile(
    rcFile,
    JSON.stringify({
      release_id: "R4-test-1",
      application_version: "0.0.0",
      source_commit: "b".repeat(40),
      image_repository: digest.split("@")[0],
      image_digest: digest.split("@")[1],
      schema_revision: "c".repeat(64),
      build_time: "2026-09-15T00:00:00.000Z",
    }),
  );
  return { configFile, rcFile };
}

async function fakeCommands(baseDir: string, podmanBody: string) {
  const bin = path.join(baseDir, "bin");
  await mkdir(bin, { recursive: true });
  const podman = path.join(bin, "podman");
  await writeFile(
    podman,
    `#!/usr/bin/env bash
if [[ "$*" == "--version" ]]; then printf 'podman version 5.8.4\\n'; exit 0; fi
if [[ "$*" == "compose version" ]]; then printf 'podman-compose version 1.6.0\\n'; exit 0; fi
printf '%s\\n' "$*" >>"$FAKE_PODMAN_LOG"
${podmanBody}
`,
  );
  await chmod(podman, 0o700);
  const flock = path.join(bin, "flock");
  await writeFile(flock, "#!/usr/bin/env bash\nexit 0\n");
  await chmod(flock, 0o700);
  return bin;
}

test("staging attestation requires matching deployed digest and verified evidence", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r4-staging-attest-"));
  try {
    const { configFile, rcFile } = await deploymentFixture(temp);
    const stateRoot = path.join(temp, "state");
    const releaseId = "R4-test-1";
    const releaseDir = path.join(stateRoot, "staging");
    await mkdir(releaseDir, { recursive: true });
    const deployment = {
      release_id: releaseId,
      image: digest,
      source_commit: "b".repeat(40),
      schema_revision: "c".repeat(64),
      config_revision: "d".repeat(64),
      status: "SMOKE_PASSED",
    };
    await writeFile(
      path.join(releaseDir, `${releaseId}.json`),
      JSON.stringify(deployment),
    );
    await writeFile(
      path.join(releaseDir, "CURRENT.json"),
      JSON.stringify(deployment),
    );
    const evidenceFile = path.join(temp, "acceptance.json");
    await writeFile(
      evidenceFile,
      JSON.stringify({
        release_id: releaseId,
        image: digest,
        source_commit: deployment.source_commit,
        schema_revision: deployment.schema_revision,
        overall_status: "ACCEPTED",
        releases: {
          "RELEASE-001": "VERIFIED",
          "RELEASE-002": "VERIFIED",
          "RELEASE-003": "VERIFIED",
        },
        evidence_refs: {
          "RELEASE-001": "oidc-run-42",
          "RELEASE-002": "mtls-run-43",
          "RELEASE-003": "compose-run-44",
        },
        accepted_by: "release-operator",
        accepted_at: "2026-09-15T12:00:00Z",
      }),
    );
    await chmod(evidenceFile, 0o600);
    const bin = await fakeCommands(temp, "exit 0");
    const result = spawnSync(
      "bash",
      [
        path.join(root, "deploy/scripts/verify-staging.sh"),
        rcFile,
        configFile,
        evidenceFile,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          DEPLOY_LOCK_ROOT: path.join(temp, "locks"),
          DEPLOY_STATE_ROOT: stateRoot,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const attestation = JSON.parse(
      await readFile(
        path.join(releaseDir, "attestations", `${releaseId}.json`),
        "utf8",
      ),
    );
    assert.equal(attestation.status, "VERIFIED");
    assert.equal(attestation.image, digest);
    assert.match(attestation.evidence_sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("mutable image tags are rejected before deployment commands run", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r4-mutable-image-"));
  try {
    const { configFile, rcFile } = await deploymentFixture(temp);
    const bin = await fakeCommands(temp, "exit 0");
    const podmanLog = path.join(temp, "podman.log");
    const result = spawnSync(
      "bash",
      [
        path.join(root, "deploy/scripts/deploy.sh"),
        "staging",
        "registry.example.invalid/itcenter/app:latest",
        configFile,
        rcFile,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_PODMAN_LOG: podmanLog,
          DEPLOY_LOCK_ROOT: path.join(temp, "locks"),
          DEPLOY_STATE_ROOT: path.join(temp, "state"),
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /IMMUTABLE_IMAGE_DIGEST_REQUIRED/);
    await assert.rejects(readFile(podmanLog));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("migration failure stops rollout and preserves current/LKG state", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r4-migrate-fail-"));
  try {
    const { configFile, rcFile } = await deploymentFixture(temp);
    const bin = await fakeCommands(
      temp,
      '[[ "$*" == *"run --rm migrate"* ]] && exit 27\nexit 0',
    );
    const log = path.join(temp, "podman.log");
    const result = spawnSync(
      "bash",
      [
        path.join(root, "deploy/scripts/deploy.sh"),
        "staging",
        digest,
        configFile,
        rcFile,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_PODMAN_LOG: log,
          DEPLOY_LOCK_ROOT: path.join(temp, "locks"),
          DEPLOY_STATE_ROOT: path.join(temp, "state"),
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /MIGRATION_FAILED/);
    const commands = await readFile(log, "utf8");
    assert.match(commands, /run --rm migrate/);
    assert.doesNotMatch(commands, /up -d --wait --remove-orphans/);
    await assert.rejects(
      readFile(path.join(temp, "state/staging/CURRENT.json")),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("readiness failure is not recorded as a successful release", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r4-readiness-fail-"));
  try {
    const { configFile, rcFile } = await deploymentFixture(temp);
    const adjusted = (await readFile(configFile, "utf8")).replace(
      "SMOKE_TIMEOUT_SECONDS=180",
      "SMOKE_TIMEOUT_SECONDS=1",
    );
    await writeFile(configFile, adjusted);
    const bin = await fakeCommands(
      temp,
      'if [[ "$*" == *"run --rm migrate"* ]]; then exit 0; fi\nif [[ "$*" == *"exec -T worker"* ]]; then printf \'%s\' \'{"data":{"profile":"WORKER","status":"READY"}}\'; fi\nexit 0',
    );
    const curl = path.join(bin, "curl");
    await writeFile(
      curl,
      '#!/usr/bin/env bash\nprintf \'%s\' \'{"data":{"profile":"API","status":"NOT_READY"}}\'\n',
    );
    await chmod(curl, 0o700);
    const stateRoot = path.join(temp, "state");
    const result = spawnSync(
      "bash",
      [
        path.join(root, "deploy/scripts/deploy.sh"),
        "staging",
        digest,
        configFile,
        rcFile,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_PODMAN_LOG: path.join(temp, "podman.log"),
          DEPLOY_LOCK_ROOT: path.join(temp, "locks"),
          DEPLOY_STATE_ROOT: stateRoot,
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /READINESS_OR_SMOKE_TIMEOUT/);
    await assert.rejects(
      readFile(path.join(stateRoot, "staging/CURRENT.json")),
    );
    const eventFiles = await import("node:fs/promises").then((fs) =>
      fs.readdir(path.join(stateRoot, "staging/events")),
    );
    assert.ok(eventFiles.some((name) => name.endsWith("-FAILED.json")));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("rollback refuses a current schema that differs from the target RC", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r4-rollback-schema-"));
  try {
    const { configFile, rcFile } = await deploymentFixture(temp);
    const bin = await fakeCommands(
      temp,
      'if [[ "$*" == *"current-schema-revision.js"* ]]; then printf "%s\\n" "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"; exit 0; fi\nexit 0',
    );
    const result = spawnSync(
      "bash",
      [
        path.join(root, "deploy/scripts/rollback.sh"),
        "staging",
        digest,
        configFile,
        rcFile,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_PODMAN_LOG: path.join(temp, "podman.log"),
          DEPLOY_LOCK_ROOT: path.join(temp, "locks"),
          DEPLOY_STATE_ROOT: path.join(temp, "state"),
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FORWARD_FIX_REQUIRED_SCHEMA_INCOMPATIBLE/);
    const commands = await readFile(path.join(temp, "podman.log"), "utf8");
    assert.match(commands, /current-schema-revision\.js/);
    assert.doesNotMatch(commands, /up -d --wait --remove-orphans|down --/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("deployment lock is exclusive when Linux flock is available", async (context) => {
  const flock = spawnSync("bash", ["-lc", "command -v flock"], {
    encoding: "utf8",
  });
  if (flock.status !== 0 || !flock.stdout.trim()) {
    context.skip(
      "flock is provided by the Linux deployment host; unavailable on this workstation",
    );
    return;
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "r4-lock-"));
  let lockProcess: ReturnType<typeof spawn> | undefined;
  try {
    const { configFile, rcFile } = await deploymentFixture(temp);
    const bin = path.join(temp, "bin");
    await mkdir(bin, { recursive: true });
    const podman = path.join(bin, "podman");
    await writeFile(
      podman,
      '#!/usr/bin/env bash\nif [[ "$*" == "--version" ]]; then printf "podman version 5.8.4\\n"; exit 0; fi\nif [[ "$*" == "compose version" ]]; then printf "podman-compose version 1.6.0\\n"; exit 0; fi\nexit 0\n',
    );
    await chmod(podman, 0o700);
    const lockRoot = path.join(temp, "locks");
    await mkdir(lockRoot);
    const lockPath = path.join(lockRoot, "itcenter-staging.deploy.lock");
    lockProcess = spawn("flock", [lockPath, "sleep", "3"], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = spawnSync(
      "bash",
      [
        path.join(root, "deploy/scripts/deploy.sh"),
        "staging",
        digest,
        configFile,
        rcFile,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_PODMAN_LOG: path.join(temp, "podman.log"),
          DEPLOY_LOCK_ROOT: lockRoot,
          DEPLOY_STATE_ROOT: path.join(temp, "state"),
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DEPLOYMENT_ALREADY_IN_PROGRESS/);
  } finally {
    lockProcess?.kill();
    await rm(temp, { recursive: true, force: true });
  }
});
