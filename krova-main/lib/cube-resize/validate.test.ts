import assert from "node:assert/strict";
import { test } from "node:test";
import { validateResize } from "@/lib/cube-resize/validate";

type Cube = Parameters<typeof validateResize>[0]["cube"];
type Server = Parameters<typeof validateResize>[0]["server"];

const cube = (o: Partial<Cube> = {}): Cube => ({
  vcpus: 2,
  ramMb: 2048,
  diskLimitGb: 20,
  hasVirtioMem: true,
  ...o,
});

// Generous server with plenty of headroom for the happy-path cases.
const server = (o: Partial<Server> = {}): Server => ({
  totalCpus: 32,
  totalRamMb: 65_536,
  totalDiskGb: 500,
  overheadDiskGb: 0,
  allocatedCpus: 2,
  allocatedRamMb: 2048,
  allocatedDiskGb: 20,
  maxCpuOvercommit: "2.0",
  maxRamOvercommit: "1.0",
  ...o,
});

function err(v: ReturnType<typeof validateResize>): string {
  assert.equal(v.ok, false, `expected invalid, got ${JSON.stringify(v)}`);
  return v.ok ? "" : v.error;
}

// ── range validation ─────────────────────────────────────────────────────────

test("rejects vCPUs below the platform minimum", () => {
  assert.match(
    err(
      validateResize({
        cube: cube(),
        server: server(),
        req: { vcpus: 0, ramMb: 2048, diskLimitGb: 20 },
      })
    ),
    /vcpu/i
  );
});

test("rejects vCPUs above the platform maximum", () => {
  assert.match(
    err(
      validateResize({
        cube: cube(),
        server: server(),
        req: { vcpus: 64, ramMb: 2048, diskLimitGb: 20 },
      })
    ),
    /vcpu/i
  );
});

test("ACCEPTS an odd vCPU count (no parity restriction — Krova never sets smt)", () => {
  const v = validateResize({
    cube: cube({ vcpus: 2 }),
    server: server(),
    req: { vcpus: 3, ramMb: 2048, diskLimitGb: 20 },
  });
  assert.equal(v.ok, true, `odd vcpu should be valid: ${JSON.stringify(v)}`);
});

test("rejects RAM that isn't on the step grid", () => {
  assert.match(
    err(
      validateResize({
        cube: cube(),
        server: server(),
        req: { vcpus: 2, ramMb: 3000, diskLimitGb: 20 },
      })
    ),
    /ram/i
  );
});

test("rejects disk that isn't on the step grid", () => {
  assert.match(
    err(
      validateResize({
        cube: cube(),
        server: server(),
        req: { vcpus: 2, ramMb: 2048, diskLimitGb: 23 },
      })
    ),
    /disk/i
  );
});

// ── shrink / no-op ───────────────────────────────────────────────────────────

test("rejects shrinking any dimension", () => {
  assert.match(
    err(
      validateResize({
        cube: cube({ vcpus: 4 }),
        server: server({ allocatedCpus: 4 }),
        req: { vcpus: 2, ramMb: 2048, diskLimitGb: 20 },
      })
    ),
    /shrink/i
  );
  assert.match(
    err(
      validateResize({
        cube: cube({ ramMb: 4096 }),
        server: server({ allocatedRamMb: 4096 }),
        req: { vcpus: 2, ramMb: 2048, diskLimitGb: 20 },
      })
    ),
    /shrink/i
  );
  assert.match(
    err(
      validateResize({
        cube: cube({ diskLimitGb: 40 }),
        server: server({ allocatedDiskGb: 40 }),
        req: { vcpus: 2, ramMb: 2048, diskLimitGb: 20 },
      })
    ),
    /shrink/i
  );
});

test("rejects a no-op (all three unchanged)", () => {
  assert.match(
    err(
      validateResize({
        cube: cube(),
        server: server(),
        req: { vcpus: 2, ramMb: 2048, diskLimitGb: 20 },
      })
    ),
    /no change/i
  );
});

// ── live vs cold classification ──────────────────────────────────────────────

test("RAM grow with virtio-mem → live", () => {
  const v = validateResize({
    cube: cube({ hasVirtioMem: true }),
    server: server(),
    req: { vcpus: 2, ramMb: 4096, diskLimitGb: 20 },
  });
  assert.equal(v.ok, true);
  assert.equal(v.ok && v.isLive, true);
});

test("live RAM grow WITHOUT virtio-mem is rejected (points at cold restart)", () => {
  assert.match(
    err(
      validateResize({
        cube: cube({ hasVirtioMem: false }),
        server: server(),
        req: { vcpus: 2, ramMb: 4096, diskLimitGb: 20 },
      })
    ),
    /virtio-mem/i
  );
});

test("CPU change → cold, even alongside RAM/disk grow and no virtio-mem", () => {
  const v = validateResize({
    cube: cube({ hasVirtioMem: false }),
    server: server(),
    req: { vcpus: 4, ramMb: 4096, diskLimitGb: 25 },
  });
  assert.equal(
    v.ok,
    true,
    `cold CPU resize should be valid: ${JSON.stringify(v)}`
  );
  assert.equal(v.ok && v.isLive, false);
});

test("disk-only grow → live", () => {
  const v = validateResize({
    cube: cube(),
    server: server(),
    req: { vcpus: 2, ramMb: 2048, diskLimitGb: 40 },
  });
  assert.equal(v.ok, true);
  assert.equal(v.ok && v.isLive, true);
});

// ── capacity headroom ────────────────────────────────────────────────────────

test("rejects a RAM grow that exceeds server RAM capacity", () => {
  assert.match(
    err(
      validateResize({
        cube: cube({ hasVirtioMem: true }),
        server: server({
          totalRamMb: 4096,
          allocatedRamMb: 2048,
          maxRamOvercommit: "1.0",
        }),
        req: { vcpus: 2, ramMb: 32_768, diskLimitGb: 20 },
      })
    ),
    /ram capacity/i
  );
});

test("rejects a disk grow that exceeds EFFECTIVE (overhead-adjusted) capacity", () => {
  assert.match(
    err(
      validateResize({
        cube: cube(),
        server: server({
          totalDiskGb: 100,
          overheadDiskGb: 60,
          allocatedDiskGb: 20,
        }),
        req: { vcpus: 2, ramMb: 2048, diskLimitGb: 100 },
      })
    ),
    /disk capacity/i
  );
});

test("rejects a CPU grow that exceeds the overcommit ceiling", () => {
  assert.match(
    err(
      validateResize({
        cube: cube({ vcpus: 2 }),
        server: server({
          totalCpus: 2,
          allocatedCpus: 2,
          maxCpuOvercommit: "2.0",
        }),
        req: { vcpus: 16, ramMb: 2048, diskLimitGb: 20 },
      })
    ),
    /cpu capacity/i
  );
});
