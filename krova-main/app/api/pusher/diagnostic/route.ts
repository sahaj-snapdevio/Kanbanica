/**
 * Admin-only Pusher / Soketi diagnostic endpoint.
 *
 * Reveals exactly enough information to verify that the secret Krova holds
 * matches the secret Soketi was configured with — without exposing the
 * secret itself. The endpoint returns:
 *
 *  - `secretFingerprint`: first 16 hex chars of SHA-256(secret). Compare to
 *    `printf '%s' "$SOKETI_DEFAULT_APP_SECRET" | sha256sum | cut -c1-16` on
 *    the Soketi host. If the two values differ by a single character, the
 *    secrets do NOT match — that is the 401 cause.
 *  - `secretLength`: the byte length of the secret. A two-byte diff between
 *    Krova and Soketi (e.g. a stray trailing `\n`) shows up here even when
 *    the visible characters are identical.
 *  - `testSignature`: HMAC-SHA256 of the fixed string `pusher-auth-test`.
 *    A side-by-side comparison with `echo -n pusher-auth-test | openssl
 *    dgst -sha256 -hmac "$SOKETI_DEFAULT_APP_SECRET"` is the definitive
 *    same-secret check.
 *  - The non-secret config (key, app id, cluster, host, port) for sanity.
 *
 * Admin gate is mandatory — leaking even the fingerprint to non-admins
 * widens the surface for brute-force attacks against the secret.
 */

import { createHash, createHmac } from "node:crypto";

import { requireAdmin } from "@/lib/api/auth-helpers";
import { getPusherConfig } from "@/lib/service-config";

const TEST_PAYLOAD = "pusher-auth-test";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const config = getPusherConfig();

    const secretFingerprint = createHash("sha256")
      .update(config.secret, "utf8")
      .digest("hex")
      .slice(0, 16);

    const testSignature = createHmac("sha256", config.secret)
      .update(TEST_PAYLOAD, "utf8")
      .digest("hex");

    return Response.json({
      ok: true,
      appId: config.appId,
      key: config.key,
      cluster: config.cluster || null,
      host: config.host ?? null,
      port: config.port ?? null,
      secretLength: Buffer.byteLength(config.secret, "utf8"),
      secretFingerprint,
      testPayload: TEST_PAYLOAD,
      testSignature,
      verifyOnSoketiHost: [
        "# 1) compare fingerprints (must match exactly):",
        `printf '%s' "$SOKETI_DEFAULT_APP_SECRET" | sha256sum | cut -c1-16`,
        "",
        "# 2) compare test signatures (must match exactly):",
        `printf '%s' "${TEST_PAYLOAD}" | openssl dgst -sha256 -hmac "$SOKETI_DEFAULT_APP_SECRET" -hex`,
      ].join("\n"),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
