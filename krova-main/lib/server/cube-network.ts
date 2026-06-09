/**
 * Pure derivation of a cube's IPv4 + IPv6 addresses from its server's
 * `bridge_subnet` (S) and the cube's host octet. Single source of truth for
 * the address math (spec: Unified addressing §).
 *
 * IPv4 = base 198.18.0.0 + S*256 + octet (base+offset integer math over the
 * 198.18.0.0/15 range — one /24 per server). IPv6 = fd00:c0be:<S-hex>::<octet>
 * (S as the third hextet, octet as the hex suffix). S ∈ [1, 511] — one /24 per
 * server, allocated at create (allocateBridgeSubnet).
 *
 * INVARIANT (spec L9): TAP name, vsock CID, and ip.txt derive ONLY from the
 * IPv4 internal_ip — never from internal_ipv6. These helpers never feed v6
 * into anything octet-derived.
 */
import {
  CUBE_BRIDGE_SUBNET_MAX,
  CUBE_IPV4_BASE,
  CUBE_IPV6_PREFIX,
} from "@/config/platform";

/** Parse a dotted IPv4 to a uint32. Throws on malformed input. */
function ipToInt(ip: string): number {
  const labels = ip.split(".");
  if (labels.length !== 4) {
    throw new Error(`ipToInt: not a valid IPv4 address: "${ip}"`);
  }
  let n = 0;
  for (const label of labels) {
    const o = Number.parseInt(label, 10);
    if (!Number.isInteger(o) || String(o) !== label || o < 0 || o > 255) {
      throw new Error(`ipToInt: not a valid IPv4 address: "${ip}"`);
    }
    n = n * 256 + o;
  }
  return n >>> 0;
}

/** uint32 → dotted IPv4. */
function intToIp(n: number): string {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join(".");
}

const IPV4_BASE_INT = ipToInt(CUBE_IPV4_BASE);
/** Number of usable host addresses spanned by the /15 (512 /24s × 256). */
const IPV4_SPAN = 512 * 256;

function assertSubnet(s: number): void {
  // Allow 0 here (reserved); the ALLOCATOR enforces MIN=1 for new servers.
  if (!Number.isInteger(s) || s < 0 || s > CUBE_BRIDGE_SUBNET_MAX) {
    throw new Error(
      `cube-network: bridge_subnet ${s} out of range [0, ${CUBE_BRIDGE_SUBNET_MAX}]`
    );
  }
}

/** Last IPv4 octet as a base-10 number. Works on any IPv4 (used on both the
 *  old 10.x and the new 198.18.x during migration). Throws on non-IPv4. */
export function octetOf(internalIp: string): number {
  const labels = internalIp.split(".");
  const last = labels.length === 4 ? labels[3] : undefined;
  const n = last === undefined ? Number.NaN : Number.parseInt(last, 10);
  if (!Number.isInteger(n) || String(n) !== last || n < 0 || n > 255) {
    throw new Error(`octetOf: not a valid IPv4 address: "${internalIp}"`);
  }
  return n;
}

/** Reconstruct the per-server subnet S from a cube IPv4 in CUBE_IPV4_BASE/15.
 *  Throws if the address is outside the range (e.g. a legacy 10.x address) so
 *  it can never be silently misparsed during migration. */
export function subnetOf(internalIp: string): number {
  const delta = (ipToInt(internalIp) - IPV4_BASE_INT) >>> 0;
  if (delta >= IPV4_SPAN) {
    throw new Error(
      `subnetOf: ${internalIp} is not in the cube IPv4 range ${CUBE_IPV4_BASE}/15`
    );
  }
  return delta >>> 8;
}

export function cubeIpv4Subnet(s: number): string {
  assertSubnet(s);
  return `${intToIp((IPV4_BASE_INT + s * 256) >>> 0)}/24`;
}

export function cubeIpv4Gateway(s: number): string {
  assertSubnet(s);
  return intToIp((IPV4_BASE_INT + s * 256 + 1) >>> 0);
}

export function cubeIpv4Address(s: number, octet: number): string {
  assertSubnet(s);
  return intToIp((IPV4_BASE_INT + s * 256 + octet) >>> 0);
}

export function cubeIpv6Subnet(s: number): string {
  assertSubnet(s);
  return `${CUBE_IPV6_PREFIX}:${s.toString(16)}::/64`;
}

export function cubeIpv6Gateway(s: number): string {
  assertSubnet(s);
  return `${CUBE_IPV6_PREFIX}:${s.toString(16)}::1`;
}

export function cubeIpv6Address(s: number, octet: number): string {
  assertSubnet(s);
  return `${CUBE_IPV6_PREFIX}:${s.toString(16)}::${octet.toString(16)}`;
}
