import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type DiskTopology,
  hostIsNvmeClass,
  parseDiskTopology,
} from "@/lib/server/disk-topology";

test("parseDiskTopology parses a SATA-SSD + NVMe mix, sorted, with numa", () => {
  // Faithful to the real probe: scheduler is the RAW `queue/scheduler` value
  // ("none [mq-deadline]"); the parser extracts the bracketed active one.
  const out = [
    "sda\t0\tsata\tnone [mq-deadline] \t0",
    "nvme0n1\t0\tnvme\t[none] mq-deadline \t1",
    "sdb\t0\tsata\tnone [mq-deadline] \t0",
  ].join("\n");
  const topo = parseDiskTopology(out);
  assert.deepEqual(topo, [
    {
      device: "nvme0n1",
      rotational: false,
      nvme: true,
      tran: "nvme",
      scheduler: "none",
      numaNode: 1,
    },
    {
      device: "sda",
      rotational: false,
      nvme: false,
      tran: "sata",
      scheduler: "mq-deadline",
      numaNode: 0,
    },
    {
      device: "sdb",
      rotational: false,
      nvme: false,
      tran: "sata",
      scheduler: "mq-deadline",
      numaNode: 0,
    },
  ]);
});

test("parseDiskTopology: rotational=1 (HDD) and missing numa → -1", () => {
  const out = "sda\t1\tsata\tmq-deadline\t-1";
  const [d] = parseDiskTopology(out);
  assert.equal(d.rotational, true);
  assert.equal(d.numaNode, -1);
});

test("parseDiskTopology skips loop/sr/dm/md, keeps sd/nvme/vd only", () => {
  const out = [
    "loop0\t0\t\t\t-1",
    "sr0\t1\tata\t\t-1",
    "dm-0\t0\t\t\t-1",
    "md0\t0\t\t\t-1",
    "vda\t1\tvirtio\tmq-deadline\t-1",
  ].join("\n");
  const topo = parseDiskTopology(out);
  assert.equal(topo.length, 1);
  assert.equal(topo[0].device, "vda");
  assert.equal(topo[0].tran, "virtio");
});

test("parseDiskTopology is tolerant: empty/short lines → [] or filtered, never throws", () => {
  assert.deepEqual(parseDiskTopology(""), []);
  assert.deepEqual(parseDiskTopology("\n  \n"), []);
  // a short line with no recognizable device is dropped, not thrown
  assert.deepEqual(parseDiskTopology("garbage"), []);
  assert.deepEqual(parseDiskTopology("sda"), [
    {
      device: "sda",
      rotational: false,
      nvme: false,
      tran: null,
      scheduler: null,
      numaNode: -1,
    },
  ]);
});

test("parseDiskTopology: nvme detected by name even if tran is blank", () => {
  const [d] = parseDiskTopology("nvme1n1\t0\t\t\t2");
  assert.equal(d.nvme, true);
});

test("hostIsNvmeClass: true iff any nvme device present", () => {
  const sata: DiskTopology = parseDiskTopology("sda\t0\tsata\tmq-deadline\t0");
  const nvme: DiskTopology = parseDiskTopology("nvme0n1\t0\tnvme\tnone\t0");
  assert.equal(hostIsNvmeClass(sata), false);
  assert.equal(hostIsNvmeClass(nvme), true);
  assert.equal(hostIsNvmeClass([]), false);
  assert.equal(hostIsNvmeClass(null), false);
  assert.equal(hostIsNvmeClass(undefined), false);
});
