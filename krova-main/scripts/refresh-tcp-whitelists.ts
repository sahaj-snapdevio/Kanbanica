/**
 * One-off SECURITY remediation: re-apply every active TCP/SSH mapping's IP
 * whitelist so the fixed iptables rules replace the old, INERT ones.
 *
 * Why this is needed: before the 2026-05-31 fix, the whitelist FORWARD rules
 * matched `--dport <hostPort>`, but the PREROUTING DNAT rewrites the packet to
 * `<cubeInternalIp>:<cubePort>` BEFORE it reaches FORWARD — so the rules never
 * matched and EVERY customer source-IP whitelist (including SSH) was silently
 * DEAD, leaving the port open to the world. The code fix makes new/edited
 * mappings match the post-DNAT cube address + port, but mappings that already
 * exist on live hosts still carry the old inert rules until re-applied.
 *
 * What it does: enqueues a `tcp-mapping.update-whitelist` job per active mapping
 * that has whitelisted CIDRs. That handler runs the FIXED updateTcpWhitelist,
 * which first clears the rules tagged `tcp-wl-<hostPort>` (removing the old
 * inert ones — same tag) and then installs the correct `-d <cubeIp> --dport
 * <cubePort>` ACCEPT/DROP rules. Reusing the tested handler keeps this on the
 * same audited, job-logged path as the customer's whitelist-edit.
 *
 * The worker MUST be running. Idempotent — safe to re-run; a mapping already on
 * the correct rules is re-applied identically.
 *
 * Run: pnpm whitelists:refresh
 */

import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

async function main(): Promise<void> {
  const { eq, inArray } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { cubes, tcpMappingWhitelistedIps, tcpPortMappings } = await import(
    "@/db/schema"
  );
  const { enqueueJob } = await import("@/lib/worker/enqueue");
  const { JOB_NAMES } = await import("@/lib/worker/job-types");

  // Active mappings joined to their cube (need internalIp + serverId for the
  // post-DNAT match). Only `active` mappings have live iptables rules.
  const mappings = await db
    .select({
      id: tcpPortMappings.id,
      cubeId: tcpPortMappings.cubeId,
      hostPort: tcpPortMappings.hostPort,
      cubePort: tcpPortMappings.cubePort,
      internalIp: cubes.internalIp,
      serverId: cubes.serverId,
    })
    .from(tcpPortMappings)
    .innerJoin(cubes, eq(tcpPortMappings.cubeId, cubes.id))
    .where(eq(tcpPortMappings.status, "active"));

  if (mappings.length === 0) {
    console.log("No active TCP/SSH mappings found — nothing to refresh.");
    return;
  }

  // Fetch the whitelist CIDRs for these mappings in one query.
  const ids = mappings.map((m) => m.id);
  const wl = await db
    .select({
      mappingId: tcpMappingWhitelistedIps.mappingId,
      cidr: tcpMappingWhitelistedIps.cidr,
    })
    .from(tcpMappingWhitelistedIps)
    .where(inArray(tcpMappingWhitelistedIps.mappingId, ids));

  const cidrsByMapping = new Map<string, string[]>();
  for (const row of wl) {
    const list = cidrsByMapping.get(row.mappingId) ?? [];
    list.push(row.cidr);
    cidrsByMapping.set(row.mappingId, list);
  }

  // Only mappings WITH a whitelist need healing — a non-whitelisted mapping was
  // never firewalled and has no tagged rules to replace.
  const targets = mappings.filter(
    (m) => (cidrsByMapping.get(m.id)?.length ?? 0) > 0
  );

  if (targets.length === 0) {
    console.log(
      `${mappings.length} active mapping(s), none with an IP whitelist — nothing to heal.`
    );
    return;
  }

  console.log(
    `Re-applying ${targets.length} whitelisted mapping(s) (of ${mappings.length} active)...\n`
  );

  let enqueued = 0;
  let skipped = 0;
  for (const m of targets) {
    if (!m.internalIp) {
      console.log(
        `  ! mapping ${m.id} (cube ${m.cubeId}) has no internal IP — skipping`
      );
      skipped++;
      continue;
    }
    const cidrs = cidrsByMapping.get(m.id) ?? [];
    const jobId = await enqueueJob(
      JOB_NAMES.TCP_MAPPING_UPDATE_WHITELIST,
      {
        mappingId: m.id,
        cubeId: m.cubeId,
        serverId: m.serverId,
        hostPort: m.hostPort,
        cubePort: m.cubePort,
        cubeInternalIp: m.internalIp,
        whitelistedCidrs: cidrs,
      },
      { singletonKey: `wl-refresh:${m.id}` }
    );
    if (jobId) {
      enqueued++;
      console.log(
        `  ✓ host:${m.hostPort} → ${m.internalIp}:${m.cubePort} (${cidrs.length} CIDR) → job ${jobId}`
      );
    } else {
      console.log(`  • mapping ${m.id} → already queued/active, skipped`);
    }
  }

  console.log(
    `\nEnqueued ${enqueued}/${targets.length}${skipped ? ` (${skipped} skipped — no IP)` : ""}. Worker must be running; watch Orbit → cube Logs.`
  );
  console.log(
    "Each job clears the old inert host-port rules and installs the correct cube-IP+port whitelist."
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("refresh-tcp-whitelists failed:", err);
    process.exit(1);
  });
