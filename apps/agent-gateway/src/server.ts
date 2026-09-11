import type { Config } from "../../../packages/config/src/index.js";
import { createHttpServer } from "../../../packages/observability/src/index.js";
import {
  authenticate,
  type AuthenticationPort,
} from "../../../packages/auth/src/index.js";
// No user administration routes; dedicated adapter must authenticate enrolled agents.
export function agentServer(
  config: Config,
  ready: () => Promise<boolean>,
  agentAuthentication: AuthenticationPort,
) {
  return createHttpServer(config, ready, async (req) => {
    if (req.url?.startsWith("/api/v1/agent/"))
      await authenticate(agentAuthentication, req.headers.authorization);
    return false;
  });
}
