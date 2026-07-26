// Fails boot loudly instead of silently falling back to an insecure default.
// Superseded by a full env schema in Block 1 item 3 — this is the minimal fail-fast
// needed to remove the JWT_SECRET fallback now.
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
