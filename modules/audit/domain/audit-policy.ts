const secretFields = new Set([
  "password",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "privatekey",
  "apisecret",
  "apikey",
  "licensekey",
  "clientsecret",
]);
export function assertNoSecretFields(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (secretFields.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
      throw new Error("Sensitive data cannot be stored in audit evidence");
    }
    assertNoSecretFields(child);
  }
}
