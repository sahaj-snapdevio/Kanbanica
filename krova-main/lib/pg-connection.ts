const LEGACY_SSL_MODES = new Set(["prefer", "require", "verify-ca"]);

export function normalizePgConnectionString(connectionString: string): string {
  let parsed: URL;

  try {
    parsed = new URL(connectionString);
  } catch {
    return connectionString;
  }

  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
  if (!sslMode || !LEGACY_SSL_MODES.has(sslMode)) {
    return connectionString;
  }

  if (parsed.searchParams.has("uselibpqcompat")) {
    return connectionString;
  }

  // Keep current strict behavior explicit across pg library upgrades.
  parsed.searchParams.set("sslmode", "verify-full");
  return parsed.toString();
}
