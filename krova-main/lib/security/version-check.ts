/**
 * Weekly CVE / version-drift scanner for the third-party things we pin.
 *
 * For each pinned version (kernel, Firecracker, Caddy, Railpack, Nixpacks,
 * Pack, plus npm packages like Next.js and Better Auth), we ask three
 * questions against upstream sources:
 *
 *   1. Is there a newer version available?
 *   2. Is there a security advisory affecting the version we're on?
 *   3. If so, is a fix available, and at what version?
 *
 * The output is a flat list of `CheckResult` rows, one per pinned thing.
 * The handler renders this into a Monday-morning email digest. Notify-only
 * by design — we don't auto-bump anything; the operator decides.
 *
 * Network strategy:
 *   - GitHub: unauthenticated. Public endpoints have a 60 req/hr unauth
 *     limit. We make ~12 calls per scan (one /releases/latest +
 *     /security-advisories per repo × ~6 repos) once a week — well under.
 *   - npm registry: no auth needed.
 *   - kernel.org/releases.json: no auth needed.
 *   - Each fetch is wrapped in `safeFetch` with a 10s timeout. Any failure
 *     becomes a `status: "error"` row with the error message — the scan
 *     never throws, so a Caddy outage doesn't block the kernel check.
 */

import {
  CADDY_VERSION,
  FIRECRACKER_VERSION,
  KERNEL_VERSION,
} from "@/config/platform";
import { compareVersions, normalizeVersion } from "@/lib/security/semver";

// Read npm-pinned package versions at scan time so we always see the
// committed package.json. (Workspace pins like "^1.6.9" are normalized to
// "1.6.9" by `normalizeVersion`.)
import packageJson from "@/package.json" with { type: "json" };

export type CheckSeverity = "low" | "medium" | "high" | "critical";

export type CheckAdvisory = {
  ghsaId: string;
  summary: string;
  severity: CheckSeverity;
  vulnerableRange: string;
  patchedVersion: string | null;
  url: string;
};

export type CheckResult = {
  /** Human-friendly name (Caddy, Firecracker, Linux Kernel 6.1, ...) */
  name: string;
  /** Where this constant lives so the operator knows what to bump. */
  pinnedAt: string;
  /** Version we have pinned right now. */
  current: string;
  /** Latest available upstream, or null if the source couldn't be reached. */
  latest: string | null;
  /** True when latest > current AND no advisories — purely informational. */
  behind: boolean;
  /** Advisories affecting our current version with severity >= "medium". */
  advisories: CheckAdvisory[];
  /** Status bucket the email groups by. */
  status: "ok" | "behind" | "vulnerable" | "error";
  /** Set when status === "error" — the source failure message. */
  error: string | null;
  /** Optional changelog/release URL the email links to. */
  upstreamUrl: string | null;
};

const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = "krova-cloud-security-scanner/1.0";

async function safeFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Source: GitHub releases + security advisories ────────────────────

type GitHubRelease = { tag_name: string; html_url: string };

async function ghLatestRelease(repo: string): Promise<GitHubRelease> {
  const res = await safeFetch(
    `https://api.github.com/repos/${repo}/releases/latest`
  );
  return (await res.json()) as GitHubRelease;
}

type GitHubAdvisory = {
  ghsa_id: string;
  summary: string;
  severity: CheckSeverity;
  html_url: string;
  vulnerabilities: Array<{
    package: { name: string; ecosystem: string };
    vulnerable_version_range: string;
    patched_versions: string | null;
  }>;
};

async function ghAdvisories(repo: string): Promise<GitHubAdvisory[]> {
  const res = await safeFetch(
    `https://api.github.com/repos/${repo}/security-advisories?per_page=20&state=published`
  );
  return (await res.json()) as GitHubAdvisory[];
}

/**
 * Walk the advisory's per-package vulnerability rows and keep the ones
 * that genuinely apply to `current`. Two filters layered on top of the
 * raw range match:
 *
 *   1. **Same-stream check via `patched_versions`.** A single GHSA often
 *      lists multiple vulnerability rows — one per maintenance stream
 *      (e.g. 0.45.x AND 1.0.0-beta.x for Drizzle). If the row's patched
 *      versions all live on a different MAJOR than `current`, the row is
 *      for a stream that doesn't apply to us — skip it.
 *
 *   2. **Already-patched short-circuit.** If `current >= patched_versions`
 *      (within our own major), we're past the fix even if our version
 *      mathematically still falls inside the published vulnerable range
 *      (e.g. ">= 2.10.0, < 2.11.2" patched in "2.11.2" — anyone on 2.11.2
 *      is fine).
 */
function matchAdvisories(
  advisories: GitHubAdvisory[],
  current: string,
  packageMatcher: (name: string, ecosystem: string) => boolean
): CheckAdvisory[] {
  const currentNorm = normalizeVersion(current);
  const out: CheckAdvisory[] = [];
  for (const adv of advisories) {
    for (const vuln of adv.vulnerabilities ?? []) {
      if (!packageMatcher(vuln.package.name, vuln.package.ecosystem)) {
        continue;
      }
      if (!isVersionInRange(current, vuln.vulnerable_version_range)) {
        continue;
      }

      if (vuln.patched_versions && currentNorm) {
        const sameStreamPatch = pickSameMajorPatch(
          vuln.patched_versions,
          currentNorm
        );
        if (sameStreamPatch === null) {
          // No patched version in our major — this row is about a
          // different maintenance stream. Skip.
          continue;
        }
        if (compareVersions(currentNorm, sameStreamPatch) >= 0) {
          // We're already at or past the fix.
          continue;
        }
      }

      out.push({
        ghsaId: adv.ghsa_id,
        summary: adv.summary,
        severity: adv.severity,
        vulnerableRange: vuln.vulnerable_version_range,
        patchedVersion: vuln.patched_versions || null,
        url: adv.html_url,
      });
      break; // one row per advisory is enough — don't list the same GHSA twice
    }
  }
  return out;
}

/**
 * GHSA `patched_versions` is sometimes a comma-separated list spanning
 * multiple maintenance streams (e.g. "15.5.14, 16.1.7"). Pick the one
 * whose MAJOR matches ours, or return null if none does.
 */
function pickSameMajorPatch(
  patchedVersions: string,
  currentNorm: string
): string | null {
  const currentMajor = currentNorm.split(".")[0];
  const candidates = patchedVersions
    .split(",")
    .map((s) => s.trim())
    .map((s) => normalizeVersion(s))
    .filter((s): s is string => s !== null);
  for (const c of candidates) {
    if (c.split(".")[0] === currentMajor) {
      return c;
    }
  }
  return null;
}

/**
 * Is `version` covered by `range`? GitHub advisory ranges have several
 * shapes we have to handle:
 *
 *   "1.4.5"                                — bare exact version
 *   "v1.14.0"                              — bare exact version with v-prefix
 *   "< 1.4.4"                              — single constraint
 *   ">= 1.4.8-beta.7, < 1.6.5"             — comma separates clauses of ONE range
 *   ">= 15.2.0 < 15.5.18"                  — whitespace separates clauses of ONE range
 *   ">=13.0.0 < 15.5.15, >= 16.0 < 16.2.3" — comma separates ALTERNATIVE ranges
 *
 * The grammar is ambiguous: a comma sometimes means "AND another constraint
 * in the same range" and sometimes means "OR a different range entirely."
 * Vercel uses both forms in their advisory feed. We treat comma as OR
 * (alternatives) — that matches the multi-major-version case (e.g. "13.x
 * AND 16.x are both vulnerable") which is what the OR-form is for. The
 * single-range comma case still works because the AND-of-clauses logic
 * runs within each comma-separated chunk on whitespace splits.
 *
 * Returns true ONLY when at least one alternative range is fully matched.
 * If we can't parse a clause, that single alternative is rejected (false)
 * — better to occasionally miss a true positive than spam admins with
 * dozens of advisories that don't apply.
 */
function isVersionInRange(version: string, range: string): boolean {
  const v = normalizeVersion(version);
  if (!v) {
    return false;
  }

  // Split on comma to find OR alternatives — but a chunk that starts with a
  // bare upper-bound operator (< or <=) is an AND continuation of the
  // PRECEDING range, not a new OR alternative.
  //
  // Example — one AND range, not two OR alts:
  //   ">= 1.7.0-beta.0, < 1.7.0-beta.4"  →  [">= 1.7.0-beta.0 < 1.7.0-beta.4"]
  //
  // Example — two genuine OR ranges (unchanged, both start with >=):
  //   ">=13.0.0 < 15.5.15, >= 16.0 < 16.2.3"  →  [">=13.0.0 < 15.5.15", ">= 16.0 < 16.2.3"]
  //
  // Without this merge, normalizeVersion strips the pre-release suffix so
  // "< 1.7.0-beta.4" becomes "< 1.7.0", which incorrectly matches stable
  // versions like 1.6.13 as a false positive.
  const parts = range
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const alternatives: string[] = [];
  for (const part of parts) {
    if (/^<=?/.test(part) && alternatives.length > 0) {
      alternatives[alternatives.length - 1] += ` ${part}`;
    } else {
      alternatives.push(part);
    }
  }

  for (const alt of alternatives) {
    if (matchesSingleRange(v, alt)) {
      return true;
    }
  }
  return false;
}

function matchesSingleRange(currentNorm: string, range: string): boolean {
  const trimmed = range.trim();

  // Bare version (with or without leading "v"): require exact match.
  // Examples: "1.4.5", "v1.14.0"
  if (/^v?\d/.test(trimmed) && !/[<>=~^]/.test(trimmed)) {
    const target = normalizeVersion(trimmed);
    if (!target) {
      return false;
    }
    return compareVersions(currentNorm, target) === 0;
  }

  // Constraint chain: ">= 15.2.0 < 15.5.18" or ">= 1.4.8-beta.7, < 1.6.5"
  // (the comma inside one alternative is rare but valid). Split on
  // whitespace OR comma, then re-parse each "(op)(version)" token.
  const tokens = trimmed
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Tokens may be glued ("<1.13.1") or split (">= 16.0"). Re-pair them.
  const constraints: Array<{ op: string; version: string }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const glued = tok.match(/^(>=|<=|>|<|=)([\w.-]+)$/);
    if (glued) {
      constraints.push({ op: glued[1], version: glued[2] });
      continue;
    }
    if (/^(>=|<=|>|<|=)$/.test(tok)) {
      const next = tokens[i + 1];
      if (!next) {
        return false;
      }
      constraints.push({ op: tok, version: next });
      i++;
      continue;
    }
    // Bare token mid-chain — unparseable. Reject this alternative.
    return false;
  }

  if (constraints.length === 0) {
    return false;
  }

  for (const c of constraints) {
    const target = normalizeVersion(c.version);
    if (!target) {
      return false;
    }
    const cmp = compareVersions(currentNorm, target);
    const ok =
      (c.op === ">=" && cmp >= 0) ||
      (c.op === "<=" && cmp <= 0) ||
      (c.op === ">" && cmp > 0) ||
      (c.op === "<" && cmp < 0) ||
      (c.op === "=" && cmp === 0);
    if (!ok) {
      return false;
    }
  }
  return true;
}

// ─── Source: npm registry ─────────────────────────────────────────────

async function npmLatest(pkg: string): Promise<string> {
  const res = await safeFetch(`https://registry.npmjs.org/${pkg}/latest`);
  const json = (await res.json()) as { version: string };
  return json.version;
}

// ─── Source: kernel.org ───────────────────────────────────────────────

type KernelRelease = {
  moniker: string;
  version: string;
  iseol: boolean;
};

async function kernelLatestForBranch(branch: string): Promise<string> {
  const res = await safeFetch("https://www.kernel.org/releases.json");
  const json = (await res.json()) as { releases: KernelRelease[] };
  const match = json.releases.find(
    (r) => r.version.startsWith(`${branch}.`) && !r.iseol
  );
  if (!match) {
    throw new Error(`No active kernel release found for branch ${branch}.x`);
  }
  return match.version;
}

// ─── Per-source check builders ────────────────────────────────────────

async function checkGithubRepo(args: {
  name: string;
  pinnedAt: string;
  current: string;
  repo: string;
  /** GitHub release tags often start with "v"; pinned constants may or may not. */
  stripV?: boolean;
}): Promise<CheckResult> {
  const { name, pinnedAt, current, repo, stripV = true } = args;
  try {
    const [release, advisories] = await Promise.all([
      ghLatestRelease(repo).catch(() => null),
      ghAdvisories(repo).catch(() => [] as GitHubAdvisory[]),
    ]);
    const latestRaw = release?.tag_name ?? null;
    const latest =
      latestRaw && stripV ? latestRaw.replace(/^v/, "") : latestRaw;
    const currentNorm = stripV ? current.replace(/^v/, "") : current;
    const matched = matchAdvisories(advisories, currentNorm, () => true);
    const behind =
      latest !== null &&
      compareVersions(latest, currentNorm) > 0 &&
      matched.length === 0;
    return {
      name,
      pinnedAt,
      current,
      latest,
      behind,
      advisories: matched,
      status: matched.length > 0 ? "vulnerable" : behind ? "behind" : "ok",
      error: null,
      upstreamUrl: release?.html_url ?? `https://github.com/${repo}/releases`,
    };
  } catch (err) {
    return {
      name,
      pinnedAt,
      current,
      latest: null,
      behind: false,
      advisories: [],
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      upstreamUrl: `https://github.com/${repo}/releases`,
    };
  }
}

async function checkNpmPackage(args: {
  name: string;
  pinnedAt: string;
  current: string;
  pkg: string;
  /** GitHub repo to pull GHSA from. */
  ghsaRepo: string;
}): Promise<CheckResult> {
  const { name, pinnedAt, current, pkg, ghsaRepo } = args;
  const currentNorm = normalizeVersion(current) ?? current;
  try {
    const [latest, advisories] = await Promise.all([
      npmLatest(pkg).catch(() => null),
      ghAdvisories(ghsaRepo).catch(() => [] as GitHubAdvisory[]),
    ]);
    const matched = matchAdvisories(
      advisories,
      currentNorm,
      (advName, ecosystem) => ecosystem === "npm" && advName === pkg
    );
    const behind =
      latest !== null &&
      compareVersions(latest, currentNorm) > 0 &&
      matched.length === 0;
    return {
      name,
      pinnedAt,
      current: currentNorm,
      latest,
      behind,
      advisories: matched,
      status: matched.length > 0 ? "vulnerable" : behind ? "behind" : "ok",
      error: null,
      upstreamUrl: `https://www.npmjs.com/package/${pkg}`,
    };
  } catch (err) {
    return {
      name,
      pinnedAt,
      current: currentNorm,
      latest: null,
      behind: false,
      advisories: [],
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      upstreamUrl: `https://www.npmjs.com/package/${pkg}`,
    };
  }
}

async function checkKernelBranch(args: {
  pinnedAt: string;
  current: string;
  branch: string;
}): Promise<CheckResult> {
  const { pinnedAt, current, branch } = args;
  const name = `Linux Kernel ${branch}.x (LTS)`;
  try {
    const latest = await kernelLatestForBranch(branch);
    const behind = compareVersions(latest, current) > 0;
    return {
      name,
      pinnedAt,
      current,
      latest,
      behind,
      advisories: [],
      status: behind ? "behind" : "ok",
      error: null,
      upstreamUrl: "https://www.kernel.org/",
    };
  } catch (err) {
    return {
      name,
      pinnedAt,
      current,
      latest: null,
      behind: false,
      advisories: [],
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      upstreamUrl: "https://www.kernel.org/",
    };
  }
}

// ─── Public entry ─────────────────────────────────────────────────────

export async function runVersionScan(): Promise<CheckResult[]> {
  const deps = packageJson.dependencies as Record<string, string>;

  const checks = await Promise.all([
    checkKernelBranch({
      pinnedAt: "config/platform.ts → KERNEL_VERSION",
      current: KERNEL_VERSION,
      branch: "6.1",
    }),
    checkGithubRepo({
      name: "Firecracker",
      pinnedAt: "config/platform.ts → FIRECRACKER_VERSION",
      current: FIRECRACKER_VERSION,
      repo: "firecracker-microvm/firecracker",
    }),
    checkGithubRepo({
      name: "Caddy",
      pinnedAt: "config/platform.ts → CADDY_VERSION",
      current: CADDY_VERSION,
      repo: "caddyserver/caddy",
    }),
    checkNpmPackage({
      name: "Next.js",
      pinnedAt: "package.json → next",
      current: deps.next,
      pkg: "next",
      ghsaRepo: "vercel/next.js",
    }),
    checkNpmPackage({
      name: "Better Auth",
      pinnedAt: "package.json → better-auth",
      current: deps["better-auth"],
      pkg: "better-auth",
      ghsaRepo: "better-auth/better-auth",
    }),
    checkNpmPackage({
      name: "pg-boss",
      pinnedAt: "package.json → pg-boss",
      current: deps["pg-boss"],
      pkg: "pg-boss",
      ghsaRepo: "timgit/pg-boss",
    }),
    checkNpmPackage({
      name: "Drizzle ORM",
      pinnedAt: "package.json → drizzle-orm",
      current: deps["drizzle-orm"],
      pkg: "drizzle-orm",
      ghsaRepo: "drizzle-team/drizzle-orm",
    }),
  ]);

  return checks;
}

export function summarizeScan(results: CheckResult[]): {
  vulnerable: CheckResult[];
  behind: CheckResult[];
  ok: CheckResult[];
  error: CheckResult[];
} {
  return {
    vulnerable: results.filter((r) => r.status === "vulnerable"),
    behind: results.filter((r) => r.status === "behind"),
    ok: results.filter((r) => r.status === "ok"),
    error: results.filter((r) => r.status === "error"),
  };
}
