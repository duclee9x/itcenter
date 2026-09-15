import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file: string) => readFile(file, "utf8");

test("RELEASE-005 keeps the approved PostgreSQL recovery policy", async () => {
  const backup = await read("deploy/scripts/backup.sh");
  const restore = await read("deploy/scripts/restore.sh");
  const status = await read("deploy/scripts/backup-status.sh");
  const compose = await read("deploy/compose.restore.yaml");
  assert.match(backup, /pg_dump -Fc/);
  assert.match(backup, /age -r/);
  assert.match(backup, /sha256sum/);
  assert.match(backup, /HOST_PROTECTED_MOUNT_UNAVAILABLE/);
  assert.match(backup, /GUEST_BACKUP_MOUNT/);
  assert.match(backup, /BACKUP_MOUNT_FSTYPES/);
  assert.doesNotMatch(
    backup,
    /Podman volume|cp .*postgres_data|tar .*postgres/,
  );
  assert.match(restore, /--confirm-production-restore/);
  assert.match(restore, /BACKUP_CHECKSUM_MISMATCH/);
  assert.match(restore, /pg_restore/);
  assert.match(restore, /compose\.restore\.yaml/);
  assert.match(status, /21600/);
  assert.match(compose, /restore_postgres_data/);
});

test("RELEASE-005 deployment integration gates migration", async () => {
  const deploy = await read("deploy/scripts/deploy.sh");
  assert.match(deploy, /backup\.sh/);
  assert.ok(deploy.indexOf("backup.sh") < deploy.indexOf("run --rm migrate"));
  assert.match(deploy, /BACKUP_RELEASE_ID/);
  assert.match(deploy, /PRE_MIGRATION_BACKUP_FAILED/);
});

test("RELEASE-005 scheduler and runtime references are Podman/Lima scoped", async () => {
  const timer = await read("deploy/systemd/itcenter-backup.timer");
  const service = await read("deploy/systemd/itcenter-backup.service");
  const readme = await read("deploy/README.md");
  assert.match(timer, /00\/6:00:00/);
  assert.match(service, /backup\.sh production/);
  assert.match(readme, /GUEST_BACKUP_MOUNT/);
  assert.match(readme, /UNVERIFIED/);
  assert.doesNotMatch(service, /docker/);
});
