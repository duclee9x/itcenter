export interface BuildInfo {
  version: string;
  source_commit: string;
  built_at: string;
  image_digest: string | null;
}

const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;
const COMMIT = /^[a-f0-9]{7,64}$/i;
const DIGEST = /^sha256:[a-f0-9]{64}$/i;

export function buildInfoFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): BuildInfo {
  const version = env.APP_VERSION ?? "development";
  const commit = env.GIT_COMMIT ?? "unknown";
  const builtAt = env.BUILD_TIME ?? "unknown";
  const digest = env.IMAGE_DIGEST ?? "";
  return {
    version: VERSION.test(version) ? version : "unknown",
    source_commit: COMMIT.test(commit) ? commit : "unknown",
    built_at:
      builtAt !== "unknown" && Number.isFinite(Date.parse(builtAt))
        ? new Date(builtAt).toISOString()
        : "unknown",
    image_digest: DIGEST.test(digest) ? digest : null,
  };
}
