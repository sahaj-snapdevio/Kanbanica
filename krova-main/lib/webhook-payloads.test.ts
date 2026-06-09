import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBackupPayload,
  buildCubeSummary,
  buildDomainPayload,
  buildInvitePayload,
  buildMemberPayload,
  buildSnapshotPayload,
  buildSubscriptionPayload,
  buildTcpMappingPayload,
} from "@/lib/webhook-payloads";

test("buildCubeSummary: shapes the public fields", () => {
  const summary = buildCubeSummary({
    id: "cube_1",
    name: "web",
    status: "running",
    vcpus: 2,
    ramMb: 4096,
    diskLimitGb: 25,
    imageId: "ubuntu-2404",
    serverId: "srv_1",
    regionId: "us-west",
  });
  assert.deepEqual(summary, {
    diskLimitGb: 25,
    id: "cube_1",
    imageId: "ubuntu-2404",
    name: "web",
    ramMb: 4096,
    regionId: "us-west",
    serverId: "srv_1",
    status: "running",
    vcpus: 2,
  });
});

test("buildCubeSummary: NEVER leaks operator-only internal IPs", () => {
  // The codebase rule: internal_ip / internal_ipv6 are operator-only and must
  // be dropped from outbound webhooks / v1 API. Pass them in as extra props and
  // assert the shaper omits them.
  // A variable (not an object literal) carrying extra operator-only props —
  // excess-property checks only fire on literals, so this compiles and proves
  // the shaper drops anything not in its explicit output shape.
  const leaky = {
    id: "cube_1",
    name: "web",
    status: "running" as const,
    vcpus: 1,
    ramMb: 1024,
    diskLimitGb: 10,
    imageId: "ubuntu-2404",
    serverId: "srv_1",
    internalIp: "198.18.5.10",
    internalIpv6: "fd00:c0be:5::a",
  };
  const summary = buildCubeSummary(leaky);
  const keys = Object.keys(summary);
  assert.ok(
    !keys.includes("internalIp"),
    "internalIp leaked into webhook payload"
  );
  assert.ok(!keys.includes("internalIpv6"), "internalIpv6 leaked");
  assert.ok(!keys.includes("internal_ip"));
  assert.ok(!keys.includes("internal_ipv6"));
});

test("buildCubeSummary: null region normalizes to null", () => {
  const s = buildCubeSummary({
    id: "c",
    name: "n",
    status: "running",
    vcpus: 1,
    ramMb: 1024,
    diskLimitGb: 10,
    imageId: "img",
    serverId: "srv",
  });
  assert.equal(s.regionId, null);
});

test("buildSnapshotPayload: carries kind + nullable sizeBytes", () => {
  assert.deepEqual(
    buildSnapshotPayload({
      id: "s1",
      cubeId: "c1",
      name: "snap",
      kind: "auto",
      sizeBytes: null,
    }),
    { id: "s1", cubeId: "c1", name: "snap", kind: "auto", sizeBytes: null }
  );
});

test("buildBackupPayload: includes original cube identity", () => {
  const p = buildBackupPayload({
    id: "b1",
    name: "bk",
    originalCubeId: "c1",
    originalCubeName: "web",
    diskSizeGb: 20,
    sizeBytes: 12_345,
  });
  assert.equal(p.originalCubeId, "c1");
  assert.equal(p.originalCubeName, "web");
  assert.equal(p.sizeBytes, 12_345);
});

test("buildDomainPayload: surfaces routing + cloudflare status", () => {
  const p = buildDomainPayload({
    id: "d1",
    cubeId: "c1",
    domain: "app.example.com",
    port: 8080,
    status: "active",
    cloudflareStatus: "active",
  });
  assert.equal(p.domain, "app.example.com");
  assert.equal(p.status, "active");
  assert.equal(p.cloudflareStatus, "active");
});

test("buildTcpMappingPayload: defaults the whitelist to [] and carries isSsh", () => {
  const noWl = buildTcpMappingPayload({
    id: "t1",
    cubeId: "c1",
    cubePort: 22,
    hostPort: 30_022,
    label: "ssh",
    isSsh: true,
    status: "active",
  });
  assert.deepEqual(noWl.whitelistedCidrs, []);
  assert.equal(noWl.isSsh, true);

  const wl = buildTcpMappingPayload(
    {
      id: "t2",
      cubeId: "c1",
      cubePort: 5432,
      hostPort: 30_432,
      label: "pg",
      isSsh: false,
      status: "active",
    },
    ["10.0.0.0/8", "1.2.3.4/32"]
  );
  assert.deepEqual(wl.whitelistedCidrs, ["10.0.0.0/8", "1.2.3.4/32"]);
});

test("buildMemberPayload / buildInvitePayload: shape member + invite", () => {
  assert.deepEqual(
    buildMemberPayload({
      userId: "u1",
      email: "a@b.com",
      permissions: ["cube.manage"],
    }),
    { userId: "u1", email: "a@b.com", permissions: ["cube.manage"] }
  );
  assert.deepEqual(
    buildInvitePayload({ id: "i1", email: "a@b.com", permissions: [] }),
    { id: "i1", email: "a@b.com", permissions: [] }
  );
});

test("buildSubscriptionPayload: Date → ISO, null period stays null", () => {
  const withDate = buildSubscriptionPayload({
    cancelAtPeriodEnd: true,
    currentPeriodEnd: new Date("2026-06-01T00:00:00.000Z"),
    plan: { id: "plan_pro", name: "Pro", priceUsd: "20.0000" },
    providerSubscriptionId: "sub_1",
    status: "active",
  });
  assert.equal(withDate.currentPeriodEnd, "2026-06-01T00:00:00.000Z");
  assert.equal(withDate.cancelAtPeriodEnd, true);
  assert.deepEqual(withDate.plan, {
    id: "plan_pro",
    name: "Pro",
    priceUsd: "20.0000",
  });

  const noDate = buildSubscriptionPayload({
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    plan: { id: "plan_trial", name: "Trial", priceUsd: "0.0000" },
    providerSubscriptionId: null,
    status: null,
  });
  assert.equal(noDate.currentPeriodEnd, null);
  assert.equal(noDate.providerSubscriptionId, null);
});
