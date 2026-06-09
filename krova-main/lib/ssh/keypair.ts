import { createHash } from "crypto";

import ssh2 from "ssh2";

export interface DerivedKeyInfo {
  fingerprint: string;
  publicKey: string;
}

export function deriveKeyInfo(privateKeyPem: string): DerivedKeyInfo {
  const parsed = ssh2.utils.parseKey(privateKeyPem);
  if (parsed instanceof Error) {
    throw new Error(`Invalid SSH private key: ${parsed.message}`);
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  const wire = key.getPublicSSH();
  const publicKey = `${key.type} ${wire.toString("base64")}`;
  const hash = createHash("sha256")
    .update(wire)
    .digest("base64")
    .replace(/=+$/, "");
  const fingerprint = `SHA256:${hash}`;
  return { publicKey, fingerprint };
}
