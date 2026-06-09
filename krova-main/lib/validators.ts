/**
 * Centralized input validation functions.
 * Used by server actions and API routes — never duplicate these.
 */

/** Validate and sanitize a name (Cube or App): 1–64 chars, printable (no control chars). */
export function validateName(name: unknown): string | null {
  if (!name || typeof name !== "string") {
    return null;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    return null;
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional detection of control characters
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Validate and sanitize domain: must be a valid FQDN or null. */
export function validateDomain(domain: unknown): string | null {
  if (domain === undefined || domain === null || domain === "") {
    return null;
  }
  if (typeof domain !== "string") {
    return null;
  }
  const trimmed = domain.trim().toLowerCase();
  if (trimmed.length > 253) {
    return null;
  }
  const labels = trimmed.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63)) {
    return null;
  }
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Validate and sanitize domain, returning an error object on invalid input.
 * Used by server actions where the caller needs to distinguish "no domain" from "invalid domain".
 */
export function validateDomainStrict(
  domain: string | undefined
): string | null | { error: string } {
  if (domain === undefined || domain === null || domain === "") {
    return null;
  }
  const trimmed = domain.trim().toLowerCase();
  if (trimmed.length > 253) {
    return { error: "Domain must be 253 characters or fewer" };
  }
  const labels = trimmed.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63)) {
    return { error: "Each domain label must be 1-63 characters" };
  }
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(trimmed)) {
    return { error: "Invalid domain format" };
  }
  return trimmed;
}

/** Validate and sanitize branch name: alphanumeric, dots, slashes, hyphens, underscores. */
export function validateBranch(branch: unknown): string {
  if (!branch || typeof branch !== "string") {
    return "main";
  }
  const trimmed = branch.trim();
  if (!/^[a-zA-Z0-9._/-]+$/.test(trimmed)) {
    return "main";
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("..")
  ) {
    return "main";
  }
  return trimmed;
}

/**
 * Validate branch name, returning an error object on invalid input.
 * Used by server actions where invalid branch should be rejected rather than defaulting.
 */
export function validateBranchStrict(
  branch: string
): string | { error: string } {
  const trimmed = branch.trim();
  if (!trimmed || trimmed.length > 256) {
    return { error: "Branch name must be 1-256 characters" };
  }
  if (!/^[a-zA-Z0-9._/-]+$/.test(trimmed)) {
    return { error: "Branch contains invalid characters" };
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("..")
  ) {
    return { error: "Invalid branch format" };
  }
  return trimmed;
}

/** Validate repo name: must match owner/repo pattern with safe characters. */
export function validateRepoName(name: unknown): string | null {
  if (!name || typeof name !== "string") {
    return null;
  }
  if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(name)) {
    return null;
  }
  if (name.length > 140) {
    return null;
  }
  return name;
}

/** Validate email format. */
export function validateEmail(email: unknown): string | null {
  if (!email || typeof email !== "string") {
    return null;
  }
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Valid SSH public key type prefixes. */
export const SSH_KEY_PREFIXES = [
  "ssh-rsa",
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "ssh-dss",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
] as const;

/** Validate an SSH public key string. Returns true if it starts with a valid key type prefix. */
export function isValidSshPublicKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) {
    return false;
  }
  const keyType = trimmed.split(/\s+/)[0];
  return SSH_KEY_PREFIXES.some((prefix) => keyType?.startsWith(prefix));
}

/** Validate a TCP port number (1–65535). */
export function validatePort(port: unknown): number | null {
  const n = typeof port === "number" ? port : Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) {
    return null;
  }
  return n;
}

/** Validate CIDR notation (e.g., "192.168.1.0/24" or bare IP "10.0.0.1"). */
export function isValidCidr(cidr: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(cidr)) {
    return false;
  }
  const [ip, prefix] = cidr.split("/");
  const octets = ip.split(".").map(Number);
  if (octets.some((o) => o < 0 || o > 255)) {
    return false;
  }
  if (prefix !== undefined) {
    const p = Number.parseInt(prefix, 10);
    if (p < 0 || p > 32) {
      return false;
    }
  }
  return true;
}
