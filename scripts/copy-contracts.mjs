import { cp } from "node:fs/promises";
await cp("contracts", "dist/contracts", { recursive: true });
