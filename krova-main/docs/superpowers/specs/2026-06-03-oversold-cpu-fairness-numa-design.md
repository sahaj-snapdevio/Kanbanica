# Oversold-CPU: fairness + NUMA + turbo — audit & best-setup design (2026-06-03)

Context: Krova hosts are dual-socket **Xeon Gold 6140** (2×18C / 36 cores / 72 threads), 251 GB RAM.
CPU is **deliberately oversold** (`config/platform.ts:53-57`: "Firecracker safely oversubscribes CPU 2–4×; RAM and disk are honest 1:1"). Owner goal: the **best, fully-automated** setup for an always-oversold model, **without** breaking overselling (so: no hard 1:1 pinning).

This doc = current-state audit (verified file:line) + external best-practice research (cited) + a layered, automatable design + a prioritized rollout.

---

## 1. Diagnosis (corrected by the empty-server benchmark)

Geekbench 6 on an **empty** 6140 host: **single 812 / multi 7827**. Reference 6140 baseline: **~1114 / ~8620** ([Geekbench Browser](https://browser.geekbench.com/processors/intel-xeon-gold-6140)).

- **Single-core 812 / 1114 ≈ 73%** on an *idle* box → the core is **not reaching its 3.7 GHz single-core turbo** even with nothing else running (812 ≈ a core stuck ~2.7 GHz). This is **config/firmware, not silicon, not contention** — and it's **~37% recoverable fleet-wide** from settings alone.
- **Multi-core 7827 / 8620 ≈ 91%** → healthy; the 6140 is a throughput part (multi is its strength).
- Likely causes of the idle single-core shortfall: (a) OS governor not `performance` on that server, (b) **Dell BIOS "System Profile" in a power-saving mode (DAPC / Perf-per-Watt)** that caps turbo + can take P-state control away from the OS (consistent with banana having had *no cpufreq* until manually enabled).

**Implication:** the single-core "low" is the **first and biggest win**, and it's pure configuration — separate from (and larger than) the cgroup/NUMA architecture work.

---

## 2. Current state (verified audit)

| Capability | State | Evidence |
|---|---|---|
| CPU oversell | **PRESENT, default 2.0×** | `allocate.ts:90-97`: cube fits iff `allocatedCpus + vcpus ≤ totalCpus × maxCpuOvercommit`; `servers.maxCpuOvercommit` default `"2"` (`db/schema/servers.ts:89-91`) → 72-thread host sells **144 vCPUs** |
| Allocator placement | **count-only, topology-blind** | candidates ordered `asc(allocatedRamMb)` only (`allocate.ts:62-73`); no CPU/NUMA-aware ordering; the cap formula is **duplicated in 6 sites** (allocate + resize + 4 transfer paths), not centralized like disk |
| Per-cube CPU share/fairness | **ABSENT** | jailer passes `--cgroup-version 2` + **no `--cgroup` limits** (`jailer.ts:143-165`); cubes float across all 72 threads under default CFS — no `cpu.weight` |
| NUMA awareness | **ENTIRELY ABSENT** | grep `numa` → 0 hits; no `numactl` install, no socket detection, no `cpuset.mems`, no `numa_balancing` config |
| Host CPU governor + turbo | **PRESENT (shipped C1)** | `krova-cpu-perf` oneshot: `performance` + EPP + `no_turbo=0` + `boost=1` (`server-install.ts:319-354`) |
| Bootstrap topology detect | **`nproc` only** | `server-bootstrap.ts:153-164` → `totalCpus` (logical 72); **no sockets / NUMA / cores-per-socket**; no `lscpu`/`dmidecode` |
| Host parent cgroup / `cpu`,`cpuset` in subtree_control | **NOT CREATED (by design)** | `jailer.ts:108-128` |
| C-states / `isolcpus` / housekeeping-core carve-out / `mitigations=` policy | **MISSING** | grep: zero matches |
| Only real host CPU "cap" today | Firecracker `vcpu_count` (thread count) + allocator scalar | `firecracker.ts:709-711`; `allocate.ts:90-97` |

**The load-bearing constraint (operator invariant, `jailer.ts:122-128`):** a host must **never** pre-create `/sys/fs/cgroup/firecracker` with domain controllers (`cpu`/`memory`) enabled in its own `cgroup.subtree_control` — the jailer's move of Firecracker into it then fails the cgroup-v2 **"no internal process" rule** and **bricks every jailed launch** on that host. The documented path (audit C2, `2026-06-02-...:65`): host-side parent-cgroup prep first → then per-cube `--cgroup cpu.weight=… [cpu.max=…] [memory.high=…]` via `buildJailerArgs`.

---

## 3. Best-practice research (cited)

- **Firecracker production-host-setup** ([docs](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)): use the cgroup **CPU controller** via the jailer's **`--cgroup`/`--resource-limit`** flags; **disable SMT** for tenant separation; mitigate the **`kvm-pit` timer-interrupt host overhead** (`modprobe kvm min_timer_period_us=…` and/or move the kvm-pit thread into the cube's cgroup). Firecracker **leaves oversubscription, pinning, and NUMA to the operator**.
- **cgroup v2** ([kernel.org](https://docs.kernel.org/admin-guide/cgroup-v2.html)): **`cpu.weight`** (default 100, range 1–10000) is **proportional, work-conserving** fair-share — idle siblings' cycles ARE redistributed, so it **preserves overselling** while killing noisy-neighbour starvation. **`cpuset.cpus`/`cpuset.mems`** bind a cube to one **NUMA node** (no 1:1 core pin). **Omit `cpu.max`** to keep oversell burst. The "no internal process" rule requires VMs in **leaf** cgroups under a controller-enabled parent.
- **KVM/NUMA practice** ([Red Hat](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/7/html/virtualization_tuning_and_optimization_guide/sect-virtualization_tuning_optimization_guide-numa-numa_and_libvirt)): cross-NUMA memory + vCPU migration can cost **50%+**; pin vCPUs to the **same node as their memory**; reserve a couple **housekeeping cores**. The oversell-friendly form is **"floating within a node"** (cpuset to a *socket*, oversell inside it) — **not** strict 1:1 pinning (which kills oversell).

---

## 4. The design — four layers (each independently shippable)

### L0 — Single-core turbo (BIOS + governor) — *biggest, simplest, do first*
- **OS:** `governor=performance` + `no_turbo=0` — already shipped (`install:cpu-governor`); just ensure it's run on **every** server.
- **BIOS (Dell):** set **System Profile = Performance** (max performance, disables C-states, gives full turbo + OS P-state control). Per-host, needs a reboot.
- **Payoff:** ~37% single-core (812 → ~1114), fleet-wide, zero architecture change. **Validate with Test A** (below).

### L1 — Per-cube `cpu.weight` fairness — *the core C2 win; tames noisy neighbours under 2× oversell*
- **Host prep (the prerequisite):** create a correctly-structured parent cgroup so the jailer can place each FC in a **leaf**, with `cpu` (and later `cpuset`) enabled on the **parent's** `subtree_control` — **never** on the node that directly holds FC (respects the invariant). New `install`-phase step + retrofit script.
- **Per-cube weight:** thread `cpu.weight = clamp(vcpus × 100, 1, 10000)` into `buildJailerArgs` as `--cgroup cpu.weight=<w>` (`jailer.ts:143-165` — one place, covers all launch paths via `launchJailed`).
- **No `cpu.max`** (preserve oversell burst into idle headroom).
- **Leaf cleanup** on teardown (the `rm -rf` chroot does NOT touch `/sys/fs/cgroup` → cgroup leaves would leak; add explicit cleanup).
- **Fail-safe:** a cgroup-arg failure must not brick launch (harder than post-boot API calls since the jailer applies cgroup at launch — design carefully + canary).
- **Effort:** medium. **Risk:** the invariant (a wrong parent bricks the host) → mandatory canary host-smoke (Rule 60, operator-run).

### L2 — NUMA-aware placement — *recovers the cross-socket penalty (up to 50% on memory-bound)*
- **Detect topology** at bootstrap: add `lscpu`/`/sys/devices/system/node*` → store `sockets` + `coresPerNode` + per-node memory on `servers` (new columns, additive migration).
- **Allocator:** track per-socket allocation (mirror the `jailer-uids.ts` per-server allocator pattern); place each cube **wholly on one node** (best-fit per node), **oversell within the node**. Centralize the 6 duplicated CPU-cap sites into a `cpu-capacity.ts` helper (mirror `disk-capacity.ts`) first.
- **Bind at launch:** `--cgroup cpuset.cpus=<node cores> cpuset.mems=<node>` per cube → local L3 + memory, no UPI hop.
- **Reserve housekeeping cores** (e.g. cores 0–1) for the host/worker/IRQ — exclude from cube cpusets.
- **Effort:** larger (schema + allocator + 6 cap sites + launch). Do **after** L1 proves the cgroup path on a canary.

### L3 — Host micro-tuning — *cheap wins, batch into the L1/L2 host prep*
- Install **`numactl`** (Rule 46: base packages + verify + retrofit).
- **`modprobe kvm min_timer_period_us=…`** (Firecracker-recommended; cuts host CPU spent on guest timer interrupts).
- Optional **C-state cap** (`intel_idle.max_cstate=1`) for tail-latency — tradeoff vs power; measure first.
- **SMT decision** (separate doc) — disable for tenant separation is the secure default, but it halves logical CPUs (capacity tradeoff under oversell).

---

## 5. Fully-automated wiring (no manual ops)

Everything maps onto **existing patterns**, so once shipped it's automatic:
- **Host prep** (parent cgroup, numactl, kvm-pit, BIOS-independent OS bits) → new steps in the **`install` setup phase** + a **`pnpm install:cpu-cgroup`** retrofit (mirrors `install:cpu-governor` / `install:network-tuning`) + a **`verify`-phase** assertion.
- **Per-cube weight + cpuset** → `buildJailerArgs` (single chokepoint; every (re)launch path inherits it for free).
- **NUMA socket assignment** → allocator + a per-server NUMA-node allocator (mirror `lib/server/jailer-uids.ts`); new additive `servers` columns via `pnpm db:generate`.
- **The only non-automatable bit is the BIOS System Profile** (L0) — it's firmware, so it's an operator iDRAC/BIOS action per host (one-time, reboot).

---

## 6. Constraints & risks (must respect)

1. **cgroup-v2 only**; `--cgroup-version 2` must always stay (test-pinned `jailer.test.ts:8-13`).
2. **The operator invariant is absolute** — wrong parent-cgroup structure bricks every launch. Hardest constraint.
3. **Per-cube cgroup leaves must be cleaned up** on teardown or they leak.
4. **Launch must stay fail-safe** (cgroup-arg failure ≠ bricked boot).
5. **Oversell must be preserved** — `cpu.weight` only (no hard `cpu.max` = allocated vCPUs).
6. **Rule 60:** all live-host validation (parent-cgroup prep, real confinement, NUMA binding) is **operator-run on a canary** (`pnpm test:host` + the jailer-canary-smoke protocol), never agent-run.
7. `--new-pid-ns` but **no `--netns`** — cgroup/NUMA work in the host net namespace; fine for cpu/cpuset.

---

## 7. Roadmap & what to do now

| # | Action | Effort | Risk | Payoff |
|---|---|---|---|---|
| 0 | **L0 — Test A then BIOS System Profile = Performance + governor on all hosts** | tiny (ops) | low | **~37% single-core, fleet-wide** |
| 1 | **L1 — per-cube `cpu.weight` fairness** (host parent-cgroup prep + jailer `--cgroup cpu.weight=vcpus×100`, no `cpu.max`) | medium | med (invariant → canary) | kills noisy-neighbour under 2× oversell |
| 2 | **L3 — numactl + kvm-pit + housekeeping cores** (batch with L1 host prep) | small | low | lower host overhead, cleaner placement |
| 3 | **L2 — NUMA-aware placement** (topology detect + per-socket allocator + `cpuset.cpus/mems`) | large | med | recovers cross-socket penalty |
| 4 | (optional) **SMT decision** + centralize the 6 CPU-cap sites into `cpu-capacity.ts` | small–med | low | security / Rule-14 cleanup |

**Immediate (today, no code):** run **Test A** on the empty server — set `performance` governor + `no_turbo=0`, confirm `cpu0` hits ~3700 under a single-thread load, re-run Geekbench. If single-core jumps 812 → ~1100, set **Dell BIOS System Profile = Performance** on every host (maintenance window) — that's the big, easy win locked in.

**Then:** approve **L1 (cpu.weight fairness)** — it's the highest-value architecture change for an oversold host, greenfield, well-anticipated by the codebase, and oversell-preserving. It must ship with a canary host-smoke (operator-run) because of the brick-the-host invariant.
