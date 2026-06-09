# krova-agent v1 — Specification

> Status: **DRAFT for review.** Authored from the firecrackmanager feature audit + Krova product positioning. Not yet implementation-ready — see "Open questions" at the bottom.

A per-host daemon installed on every bare-metal server in the Krova fleet. Replaces the current "SSH from the worker and shell out" model with a typed mTLS API and a local state owner. The agent is the **node-level execution layer**; Krova remains the orchestrator, the catalog, the multi-tenant control plane, and the UI.

---

## 0. Design decisions (frozen unless re-opened)

These five questions were open after the feature audit. The recommendations below are folded into the rest of the spec — anything that depends on them references this section.

### 0.1 Multi-NIC per cube — **YES (all NICs are private)**

A cube has 1 primary NIC by default. Customers can attach up to 4 additional NICs via the agent (`Network.AttachInterface`). Each NIC has its own MAC, a private IP from its assigned virtual network, and a TAP device on the host.

**No NIC ever holds a public IP.** Every NIC is on a private virtual network owned by the customer's space. External reachability is provided exclusively by the platform edge — Caddy (HTTP/HTTPS + custom domains via Cloudflare for SaaS) and the platform's TCP port mapping (SSH on 2822, customer-mapped TCP ports). Multi-NIC is purely an **internal topology** feature for separating private traffic tiers.

- **Pricing:** no per-NIC charge — bandwidth is already a plan-level limit; NICs are a topology choice. Plan limit `maxNetworkInterfacesPerCube` (default 1 for Trial, 5 for higher tiers).
- **Use cases (all private/internal):**
  - **App-tier vs DB-tier split** — app cubes attach to `app-net` + `db-net`; DB cubes attach only to `db-net`. DBs are unreachable from app cubes the customer hasn't explicitly placed on `db-net`. Topology-level isolation, not just firewall.
  - **Dedicated monitoring/management network** — NIC 1 for app traffic, NIC 2 on a private `mgmt-net` so the customer's Prometheus/logging cubes scrape every cube over a separate path.
  - **Multi-tenant inside one cube** — customer running their own SaaS gives each of their tenants a NIC on a separate per-tenant network for traffic isolation.
  - **VPN bridging** — cube attached to a customer-managed WireGuard network as a private gateway between Krova-internal networks.
- **UI:** "Add interface" action on the cube detail page, behind the cube-edit permission. The UI must never show "public IP" terminology — only "network" + "private IP".

### 0.2 Multi-disk pricing — **flat per-GB, no plan tier**

A cube has 1 rootfs disk by default and can attach up to N data disks (plan-limited). All disks (rootfs + data) bill from the same per-GB pool. The plan caps **total disk per cube**, not "disks per cube" — customers freely choose between a fat rootfs or split rootfs + data disks.

- **Mount points:** customer-specified at attach time (validated against a reserved-paths list — `/`, `/boot`, `/proc`, etc., reject those). Default if not specified: `/data`, `/data2`, …
- **Persistence:** data disks are **independent of the cube lifecycle** — a cube delete preserves data disks (they become orphaned but attachable to a new cube). Customer must explicitly delete a data disk.
- **Snapshots:** data disks have their own snapshot lifecycle, separate from the cube's rootfs snapshot.
- **Schema change:** new `data_disks` table, FK to space (not to cube — disks outlive cubes).

### 0.3 Compose / image → rootfs UX — **two surfaces**

**(a) Quick Boot** — at cube-create time, the customer picks a source:
- "From OS template" (existing flow, Ubuntu/Debian)
- "From Docker image" (new — agent runs `RegistryToFC` inline as a provisioning phase)
- "From Docker Compose" (new — customer uploads `docker-compose.yml`, picks a service, agent runs `Compose2FC`)
- "From QEMU/VMDK image" (new — customer uploads, agent runs `QemuToFC`)

The conversion runs **on the destination server** as part of `cube.provision`. Built rootfs lives only on that cube — not reusable.

**(b) Templates (paid plans only)** — customer builds a reusable rootfs template once, the result is stored on Storage Box like a snapshot, and any future cube can be provisioned from that template ID. Templates have versioning and visibility (private to space / shared across the operator's templates).

Templates are the **monetization angle** for the conversion feature — Quick Boot is free for anyone, Templates is a Pro feature.

### 0.4 Live-migration scope — **within-region only for v1**

V1 supports live migration only between servers in the same region. Cross-region requires:
- Memory state transfer over WAN latency (Frankfurt ↔ US-west tested 54ms — workable but every snapshot iteration round-trip multiplies)
- Storage Box paths re-pointing
- Inter-region mTLS trust extension

All solvable but adds 4–6 weeks. **Defer to v2.** V1 ships within-region live migration + the existing cold cross-region transfer for cross-region moves.

### 0.5 Browser console authentication — **short-lived signed JWT**

When a customer opens the cube console in Krova UI:
1. Krova mints a JWT signed with its server-side key. Claims: `{ spaceId, cubeId, agentServerId, iat, exp: iat+300, jti }`.
2. Browser opens WebSocket to Krova: `/api/spaces/{spaceId}/cubes/{cubeId}/console`. Krova proxies to agent at `wss://<agent>:8443/v1/console?token=<JWT>`.
3. Agent verifies JWT signature against Krova's public key (cached, rotated daily). Verifies `agentServerId` matches its own identity. Verifies `jti` not in its replay cache (in-memory, 10-min TTL).
4. Agent opens cube's serial console PTY, pipes bytes back over WS.
5. Token expires after 5 min — browser must re-open WS to continue. Krova issues a refresh from the existing console session if the user is still active.

**Why JWT, not the per-server cube cert:** the customer's browser can't hold a server-cert. Krova has to mint a short-lived bearer token. JWT is the standard shape for this. Public-key verification on the agent means Krova doesn't need to round-trip per console connection.

---

## 1. Goals

1. **Stability** — eliminate the bash-quoting, SSH-connection-pool, and worker-process-dies-mid-command failure modes that currently dominate Krova's incident log.
2. **Stronger product surface** — unlock features that are awkward or impossible from a remote-SSH model: browser console, live migration, fast metrics, Compose/image-to-rootfs, multi-disk.
3. **Simple install** — operator runs ONE command on a fresh bare-metal box and the box joins the Krova fleet. Same UX as `k3s agent` / `nomad agent` / `tailscale up`.
4. **Secure by default** — mTLS between Krova and every agent; jailer-isolated Firecracker; no SSH-root-from-the-control-plane.
5. **Owned IP** — written from scratch in Go, no fork, no dependency on a third-party project's licensing or roadmap.

## 2. Non-goals

1. **Not a standalone product.** The agent has no web UI, no local users, no login, no LDAP, no marketplace. Krova is the only client.
2. **Not the catalog.** Postgres on Krova remains the source of truth for cubes/spaces/plans/billing. The agent caches only what it needs to execute its local responsibilities.
3. **Not a Proxmox.** No clustering, HA, distributed scheduling, or shared storage at the agent layer. Krova decides where cubes go.
4. **Not multi-tenant within itself.** One agent = one Krova control plane = one operator's hosts.
5. **No customer-facing IPC.** Customers interact with cubes via SSH (port 2822, mapped TCP), the Krova web UI, and the browser console. They never talk to the agent directly.
6. **No public IPs on cubes — ever.** Every cube NIC (whether the default one or an additional multi-NIC attachment) carries a private IP on a virtual network owned by the customer's space. External reachability is provided exclusively by the platform edge: Caddy (HTTP/HTTPS + custom domains via Cloudflare for SaaS) for web traffic, and the platform's TCP port-mapping system for SSH (2822) and customer-mapped TCP ports. Inbound traffic always lands on the host first, never directly on a cube. Outbound traffic goes through host-level NAT. The agent must reject any RPC that requests a public/routable IP for a cube, and the UI must never expose "public IP" terminology to the customer.

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Krova control plane (existing)                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Next.js UI  │  │  pg-boss     │  │  Postgres (catalog)  │   │
│  │  + API       │  │  worker      │  │                      │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────┘   │
└─────────┼─────────────────┼─────────────────────────────────────┘
          │ mTLS gRPC       │ mTLS gRPC
          │                 │
   ┌──────┴──────────┐ ┌────┴─────────┐         ┌───────────────┐
   │  krova-agent    │ │ krova-agent  │   ...   │  krova-agent  │
   │  host: paris-1  │ │ host: ny-2   │         │  host: tok-3  │
   │                 │ │              │         │               │
   │  ┌───────────┐  │ │  Firecracker │         │  Firecracker  │
   │  │Firecracker│  │ │  + jailer    │         │  + jailer     │
   │  │+ jailer   │  │ │              │         │               │
   │  └───────────┘  │ │  TAP, Caddy, │         │  TAP, Caddy,  │
   │  TAP, Caddy,    │ │  Storage     │         │  Storage      │
   │  Storage links  │ │  links       │         │  links        │
   └─────────────────┘ └──────────────┘         └───────────────┘
```

**Krova → agent direction:** all imperative commands (boot, sleep, resize, snapshot, attach disk, …).
**Agent → Krova direction:** lifecycle events, metrics, job-log streams, host status, image-build progress, console-session ack.

Two channels:
- **gRPC over mTLS** on `:8443` — unary RPCs for commands, server-streaming RPCs for live events.
- **HTTP/1.1 + WebSocket over mTLS** on `:8443` (same port, multiplexed by `Content-Type` / `Upgrade` header) — browser console, large file streaming.

Agent listens on `:8443` only. No other ports exposed to the public internet. Customer ports (mapped TCP) go through Caddy on the same host but a different port range, completely separate from the agent.

---

## 4. Identity & enrollment

### 4.1 Bootstrap tokens

In Orbit → Servers → "Add server", the operator generates a **bootstrap token**: `ktok_` + 32 random bytes hex. The token row in Postgres carries:

```
bootstrap_tokens
  token_hash       sha256
  created_at       timestamptz
  created_by_user_id text  (Orbit admin who minted it)
  expires_at       timestamptz  (default: 24h)
  used_at          timestamptz nullable
  used_by_server_id text nullable
  region_id        text  (required — scopes which region the new server joins)
  scope            text  (e.g., "server:create") — future RBAC
```

Token is **single-use**. Once consumed, `used_at` + `used_by_server_id` set; further use rejected.

### 4.2 One-line install

Operator runs on the bare-metal box:

```sh
curl -fsSL https://install.krova.cloud/agent.sh | sudo sh -s -- \
  --token ktok_abc123def... \
  --control https://api.krova.cloud
```

Or via package manager (after one-time apt-repo / yum-repo setup):

```sh
sudo apt install krova-agent
sudo krova-agent join --token ktok_abc123def... --control https://api.krova.cloud
```

### 4.3 mTLS issuance flow

1. Agent generates a P-256 keypair locally.
2. Agent POSTs `/api/agent/join` with `{ token, csr, hostname, host_facts }` over TLS (regular HTTPS, since it has no client cert yet).
3. Krova validates token, checks expiry, marks `used_at`. Creates a `servers` row (or matches by hostname if pre-staged) with `status=joining`.
4. Krova signs the CSR with its internal CA, returns `{ cert, ca_cert, agent_server_id, agent_config }`.
5. Agent persists `{ cert, key, ca_cert, agent_server_id }` to `/etc/krova-agent/identity/`.
6. Agent starts the gRPC mTLS server on `:8443` using this identity.
7. Agent dials Krova's `/v1/agent.Bootstrap.Ready` (mTLS) to confirm; Krova flips `servers.status=bootstrapped` and proceeds with the existing phased setup (install → pull_images → network → verify → ready), now driven through the agent's API instead of via SSH.

### 4.4 Certificate rotation

Per-server cert TTL: 90 days. Agent auto-rotates at 70 days remaining by calling `Bootstrap.RotateCert(csr)` over the existing mTLS channel. Krova issues a new cert without operator intervention. If rotation fails for >7 days, the agent emits a `cert.rotation_failed` event and the cube provisions queue starts deferring to other hosts.

### 4.5 Revocation

In Orbit → Servers → server detail → "Revoke agent". Krova:
1. Adds cert serial to its short-lived CRL (cached in Postgres + pushed to all agents on next heartbeat).
2. Marks `servers.status=revoked`.
3. Existing in-flight RPCs to that agent get dropped on next call.
4. Operator must re-bootstrap (`krova-agent reset && krova-agent join …`) to restore.

Krova's CA is a soft CA — fast revocation matters more than a robust X.509 PKI. CRL-via-database, not OCSP.

### 4.6 Agent identity lifecycle

```
nothing → bootstrapping → joined → bootstrapped → ready → (revoked | retired)
```

`ready` matches today's `servers.status='active'` — the host is scheduling cubes.

---

## 5. Transport

### 5.1 Protocol choices

- **gRPC** over **HTTP/2** over **mTLS** for command + control. Protobuf wire format. Code-generated clients for TypeScript (Krova) and Go (agent self-tests).
- **WebSocket** over **mTLS** for browser console (because browser can't speak gRPC directly without an envoy proxy, and we want minimal infra dependencies).
- **HTTP/1.1 multipart** over **mTLS** for large binary uploads (image upload, rootfs upload) — gRPC's streaming chunk model is workable but multipart is dramatically simpler for resumable uploads.

All three terminate on the agent at `:8443`. The handler dispatches by content-type / upgrade header.

### 5.2 Versioning

- **gRPC service version in package name:** `krova.agent.v1.VMService`. v2 ships alongside v1 during transitions.
- **Per-call agent-version header:** `x-krova-agent-version: 0.4.2`. Krova rejects calls from agents older than its minimum-supported version (e.g., MIN_AGENT_VERSION=0.3.0). New servers run latest; old servers get auto-upgraded by the agent-upgrade flow.
- **Backwards compatibility window:** Krova always supports the previous 2 minor versions of the agent. Patch versions are always forward-compatible.

### 5.3 Connection model

- **Krova → Agent:** Krova maintains a connection pool per agent in the pg-boss worker process. Idle connections kept alive 5 min. Connection-per-request fallback when pool is exhausted.
- **Agent → Krova:** persistent stream for events (`Krova.EventStream`). Reconnects with exponential backoff on disconnect (1s → 30s cap). Events buffered locally during disconnects up to 10k events / 100 MB; oldest dropped on overflow.

### 5.4 Error model

All RPCs return `google.rpc.Status` with one of these canonical codes:

| Code | When |
|---|---|
| `NOT_FOUND` | Cube/disk/snapshot not on this host |
| `ALREADY_EXISTS` | Idempotent create called twice with conflicting spec |
| `FAILED_PRECONDITION` | Cube in wrong state for this op (e.g. resize while booting) |
| `RESOURCE_EXHAUSTED` | Host out of vCPU/RAM/disk |
| `PERMISSION_DENIED` | mTLS cert invalid / revoked |
| `UNAVAILABLE` | Agent draining, restarting, or upgrading |
| `INTERNAL` | Bug / unexpected error — always logged with stack |
| `DEADLINE_EXCEEDED` | Op took longer than client deadline |

Every error carries a stable `reason` string (`"cube.not_booted"`, `"disk.mount_path_reserved"`, `"image.checksum_mismatch"`) so Krova can decide what to show the customer without parsing English.

---

## 6. Service definitions

The agent exposes ten gRPC services. Proto-style sketch below — exact field tags TBD in the actual `.proto` files.

### 6.1 `agent.Bootstrap`

```proto
service Bootstrap {
  rpc Ready(ReadyRequest) returns (ReadyResponse);          // agent confirms join
  rpc RotateCert(RotateCertRequest) returns (RotateCertResponse);
  rpc Health(HealthRequest) returns (HealthResponse);       // unauth-ed liveness probe
  rpc HostFacts(HostFactsRequest) returns (HostFactsResponse); // CPU/RAM/disk/distro/kernel
  rpc Drain(DrainRequest) returns (DrainResponse);          // refuse new cubes, finish in-flight
  rpc Resume(ResumeRequest) returns (ResumeResponse);
}
```

### 6.2 `agent.VM` — cube lifecycle

```proto
service VM {
  rpc Create(CreateRequest) returns (CreateResponse);
  rpc Boot(BootRequest) returns (BootResponse);
  rpc Sleep(SleepRequest) returns (SleepResponse);                 // graceful (ctrl-alt-del + timeout → SIGTERM)
  rpc ForceStop(ForceStopRequest) returns (ForceStopResponse);     // SIGKILL
  rpc Delete(DeleteRequest) returns (DeleteResponse);              // removes from host; agent does NOT delete the DB row, Krova does
  rpc Get(GetRequest) returns (CubeStatus);
  rpc List(ListRequest) returns (ListResponse);
  rpc Resize(ResizeRequest) returns (ResizeResponse);              // CPU = cold restart, RAM via virtio-mem
  rpc UpdateUserData(UpdateUserDataRequest) returns (Empty);       // requires next boot
  rpc StreamEvents(StreamEventsRequest) returns (stream CubeEvent); // boot, halt, error, oom
  rpc Reachability(ReachabilityRequest) returns (ReachabilityResponse); // ping + port scan
}

message CreateRequest {
  string cube_id = 1;          // Krova's cube id, agent doesn't generate
  CubeSpec spec = 2;
  string idempotency_key = 3;  // safe to retry
}

message CubeSpec {
  int32 vcpu = 1;
  int32 ram_mb = 2;
  string kernel_image_ref = 3;
  string rootfs_image_ref = 4;
  string kernel_args = 5;
  string user_data = 6;
  repeated NetworkInterfaceSpec interfaces = 7;
  repeated DiskAttachment disks = 8;        // including rootfs at index 0
  VirtioMemConfig virtio_mem = 9;
  string hostname = 10;
  string jailer_uid = 11;                   // per-cube uid for isolation
}
```

### 6.3 `agent.Snapshot`

```proto
service Snapshot {
  rpc Create(CreateRequest) returns (CreateResponse);
  rpc Restore(RestoreRequest) returns (RestoreResponse);
  rpc List(ListRequest) returns (ListResponse);
  rpc Delete(DeleteRequest) returns (DeleteResponse);
  rpc CreateDiff(CreateDiffRequest) returns (CreateDiffResponse);  // differential snapshot
  rpc StreamProgress(StreamProgressRequest) returns (stream Progress);
}
```

Snapshots are uploaded to Storage Box by the agent (it has SFTP credentials via Krova). The agent emits progress on the stream.

### 6.4 `agent.Disk`

```proto
service Disk {
  rpc Attach(AttachRequest) returns (AttachResponse);          // formats ext4, updates fstab in rootfs, hot-plugs
  rpc Detach(DetachRequest) returns (DetachResponse);
  rpc Expand(ExpandRequest) returns (ExpandResponse);          // live grow + resize2fs
  rpc Shrink(ShrinkRequest) returns (ShrinkResponse);          // requires cube sleep
  rpc List(ListRequest) returns (ListResponse);
  rpc Snapshot(DiskSnapshotRequest) returns (DiskSnapshotResponse);  // disk-level, independent of cube
}
```

### 6.5 `agent.Network`

```proto
service Network {
  rpc CreateNetwork(CreateNetworkRequest) returns (CreateNetworkResponse); // bridge + subnet
  rpc DeleteNetwork(DeleteNetworkRequest) returns (Empty);
  rpc AttachInterface(AttachInterfaceRequest) returns (AttachInterfaceResponse); // add NIC to cube
  rpc DetachInterface(DetachInterfaceRequest) returns (Empty);
  rpc ApplyFirewallRules(ApplyFirewallRulesRequest) returns (Empty); // per-network ipt rules
  rpc ListInterfaces(ListInterfacesRequest) returns (ListInterfacesResponse);
  rpc SetNAT(SetNATRequest) returns (Empty);
}
```

### 6.6 `agent.Image` — rootfs/kernel artifacts

```proto
service Image {
  rpc PullKernel(PullKernelRequest) returns (PullKernelResponse);   // download from Krova-signed URL
  rpc PullRootfs(PullRootfsRequest) returns (PullRootfsResponse);
  rpc ListKernels(Empty) returns (ListKernelsResponse);
  rpc ListRootfs(Empty) returns (ListRootfsResponse);
  rpc DeleteImage(DeleteImageRequest) returns (Empty);              // refused if any cube references
  rpc ScanKernel(ScanKernelRequest) returns (ScanResult);           // virtio symbol detection
  rpc ScanRootfs(ScanRootfsRequest) returns (ScanResult);           // init/OS/SSH detection
  rpc VerifyChecksum(VerifyChecksumRequest) returns (VerifyChecksumResponse);
}
```

### 6.7 `agent.Build` — Compose / image / QEMU → rootfs

```proto
service Build {
  rpc BuildFromCompose(BuildFromComposeRequest) returns (BuildFromComposeResponse);
  rpc BuildFromImage(BuildFromImageRequest) returns (BuildFromImageResponse);
  rpc BuildFromQemu(BuildFromQemuRequest) returns (BuildFromQemuResponse);
  rpc StreamBuildLog(StreamBuildLogRequest) returns (stream BuildLogLine);
  rpc CancelBuild(CancelBuildRequest) returns (Empty);
  rpc SearchPublicImages(SearchPublicImagesRequest) returns (SearchPublicImagesResponse); // Docker Hub / Quay / GitLab
  rpc BuildKernel(BuildKernelRequest) returns (BuildKernelResponse); // operator-only, in-host kernel compile
}

message BuildFromComposeRequest {
  string build_id = 1;          // idempotency / progress key
  bytes compose_yaml = 2;
  string service_name = 3;
  int64 size_gib = 4;           // 0 = auto
  bool inject_ssh = 5;
  map<string, string> environment = 6;
  string output_uri = 7;        // where the agent uploads the resulting ext4
}
```

Build outputs go to Storage Box (template path) for Templates flow, or stay local + are linked into the new cube's rootfs path for Quick Boot.

### 6.8 `agent.Migration`

```proto
service Migration {
  rpc PrepareSource(PrepareSourceRequest) returns (PrepareSourceResponse);   // pause writes, snapshot
  rpc StreamMigration(stream MigrationChunk) returns (MigrationResponse);    // memory + disk pages
  rpc Commit(CommitRequest) returns (CommitResponse);                        // destination assumes cube
  rpc Abort(AbortRequest) returns (Empty);                                   // cleanup both sides
  rpc StreamProgress(StreamProgressRequest) returns (stream Progress);
}
```

Live migration sequence:
1. Krova calls `source.Migration.PrepareSource(cube_id, dest_agent_endpoint, transfer_token)`.
2. Source agent dials destination agent directly (mTLS, transfer_token verified by destination).
3. Source streams memory pages + disk diffs to destination.
4. When converged (memory diff rate stable + small), source pauses cube, sends final diff.
5. Source calls Krova `Migration.Commit` — Krova flips cube's `serverId` to destination atomically.
6. Destination resumes cube. Source cleans up.

### 6.9 `agent.Console`

```proto
// This service is WebSocket-only, not gRPC.
// GET /v1/console?cube_id=...&token=<JWT>   (Upgrade: websocket)
//   bidirectional: client → agent bytes go to PTY stdin, agent → client bytes come from PTY stdout.
```

JWT verification per §0.5. Replay cache 10 min, in-memory.

### 6.10 `agent.Metrics`

```proto
service Metrics {
  rpc GetCubeMetrics(GetCubeMetricsRequest) returns (CubeMetrics);     // last 5 min raw
  rpc GetCubeMetricsRange(GetCubeMetricsRangeRequest) returns (CubeMetricsRange); // downsampled
  rpc GetHostMetrics(Empty) returns (HostMetrics);                     // CPU/RAM/disk usage of bare-metal host
  rpc StreamCubeMetrics(StreamCubeMetricsRequest) returns (stream CubeMetricsTick);
}
```

### 6.11 `agent.System`

```proto
service System {
  rpc GetVersion(Empty) returns (VersionInfo);
  rpc UpgradeFirecracker(UpgradeFirecrackerRequest) returns (UpgradeFirecrackerResponse);
  rpc SetJailerConfig(SetJailerConfigRequest) returns (Empty);
  rpc GetKvmStatus(Empty) returns (KvmStatusResponse);
  rpc Ping(PingRequest) returns (PingResponse);            // network debug
  rpc ScanPorts(ScanPortsRequest) returns (ScanPortsResponse);
  rpc HttpProxyConfig(HttpProxyConfigRequest) returns (Empty);
}
```

---

## 7. On-host responsibilities

### 7.1 State ownership

The agent **owns**:
- Firecracker processes (PIDs, sockets, jailer chroots)
- TAP/bridge devices and iptables rules
- Local image files (`/var/lib/krova-agent/kernels/`, `/rootfs/`)
- Cube rootfs files (`/var/lib/krova-agent/cubes/<id>/rootfs.ext4`)
- Mounted data disks (`/var/lib/krova-agent/disks/<id>.ext4`)
- Local agent SQLite (runtime state — see §8)
- Caddy config (`/etc/caddy/Caddyfile.d/*.conf` for customer domains, port mappings)
- The local Firecracker binary + the agent binary itself

Krova **owns** (and the agent never independently mutates):
- Cube specs, plans, ownership, billing
- Snapshot/backup catalog metadata
- Customer custom domains (the agent only applies them when Krova tells it to)
- All pricing, plan caps, customer permissions

### 7.2 Per-cube local locking

Every mutating RPC for a cube acquires an in-process `sync.RWMutex` keyed by cube_id. Reads (status, metrics) take the read-lock. Writes (boot, resize, snapshot) take the write-lock. Held only for the duration of the agent-side operation; no cross-process locking needed because there is only one agent process per host.

### 7.3 Reconcile loops

Three concurrent loops, all started on agent boot:

1. **Cube state reconcile** (every 30s) — compare DB-of-running-Firecracker-PIDs (the agent's local SQLite) vs actual `ps`. Detect crashed cubes, emit `cube.crashed` event to Krova.
2. **Storage reconcile** (every 5 min) — verify local rootfs/disk file sizes match agent SQLite. Detect manual operator intervention or filesystem corruption.
3. **Caddy reconcile** (every 1 min) — ensure Caddy config matches expected state. Re-apply if drift detected.

The agent intentionally does **not** reconcile against Krova every tick — that's Krova's job (via `cube.state-sync` job). Local reconciles catch local drift fast; Krova reconciles catch global drift.

### 7.4 Background workers

- **Metrics collector** — every 10s, scrape CPU%/mem%/mem-used for every running cube via Firecracker's HTTP API or `/proc/<pid>/stat`. Write to local SQLite raw table.
- **Metrics compactor** — every 10 min, downsample raw → 10min averages. Every 1h, 10min → hourly. Every 24h, hourly → daily. Drop raw older than 1h, 10min older than 1d, hourly older than 7d. Keep daily for 6 months.
- **Image GC** — once per day, find images on disk not referenced by any active cube AND older than 7d, delete.
- **Process monitor** — for each running cube, `os.Process.Wait()` in a goroutine. On exit, mark cube as `crashed` locally and emit event.
- **Heartbeat** — every 30s, agent sends `Krova.Heartbeat(agent_id, ts, host_facts_summary)` so Krova can flag offline hosts in Orbit.

### 7.5 Cube-heartbeat replacement

Today Krova has `lib/worker/cube-heartbeat.ts` that pulses `cubes.updated_at` every 2 min during slow SFTP/decompress operations to prevent `cube.stale-check` from killing them. With the agent owning local state, this becomes simpler:

- The agent reports cube state directly via the event stream (`cube.transitioned`, `cube.long_operation_in_progress`).
- `cube.stale-check` becomes a Krova-side check: cube in `pending|booting|stopping` AND no recent agent event for >10 min → flag for investigation.
- The agent owns the lock for the operation duration; no remote stale-check can kill an in-flight operation.

This eliminates the entire class of races that Rule 34 in CLAUDE.md is trying to prevent.

---

## 8. Local data model

The agent keeps a minimal SQLite at `/var/lib/krova-agent/agent.db`. Postgres remains authoritative for the catalog — the local SQLite is a **cache + runtime ledger**, rebuildable from Krova at any time.

```
agent_identity                      (1 row)
  agent_server_id
  cert_pem
  key_pem
  ca_pem
  control_plane_url

cubes_local                         (one per cube assigned to this host)
  cube_id                pk
  spec_json              (cached CubeSpec)
  status                 (provisioning|running|sleeping|booting|stopping|error)
  pid                    (current Firecracker PID, 0 if not running)
  socket_path
  jailer_chroot
  last_boot_id           (matches /proc/sys/kernel/random/boot_id of host)
  last_state_change_at
  last_event_emitted_at

data_disks_local
  disk_id                pk
  cube_id                (nullable when detached)
  size_mb
  path
  format
  mount_point

builds_local                        (transient — building rootfs from compose/image/qemu)
  build_id               pk
  kind                   (compose|image|qemu|kernel)
  status                 (pending|running|completed|failed|cancelled)
  progress_pct
  log_tail               (last 100 lines, rotated)
  started_at
  completed_at
  result_path

operations                          (idempotency log + progress)
  idempotency_key        pk
  rpc_name
  request_hash
  status                 (in_progress|completed|failed)
  result_blob            (cached response for idempotent replay)
  started_at
  completed_at

metrics_raw                         (10s ticks, retained 1h)
metrics_10min                       (10min downsampled, retained 1d)
metrics_hourly                      (1h downsampled, retained 7d)
metrics_daily                       (1d downsampled, retained 6mo)

events_outbox                       (events waiting to be acked by Krova)
  event_id               pk
  cube_id                nullable
  kind
  payload_json
  emitted_at
  acked_at               nullable

host_boot_id                        (1 row, current /proc/sys/kernel/random/boot_id)
```

On agent start, if `host_boot_id` doesn't match current `/proc/.../boot_id`, the agent knows the host rebooted: it re-launches every cube whose `cubes_local.status='running'`, in parallel, then updates `host_boot_id`. Krova's `server.reboot-recovery` job is no longer needed — the agent does this autonomously.

---

## 9. Image / artifact distribution

### 9.1 Pull model

Krova does not push artifacts to agents. Agents **pull** from Krova-signed URLs:

1. Krova maintains the canonical kernel + rootfs files (on the Dokploy host, as today, OR on Storage Box for production scale).
2. Krova mints short-lived signed download URLs (e.g., Storage Box pre-signed SFTP, or a Krova-hosted HTTPS endpoint with HMAC-signed query string).
3. Agent calls `Image.PullKernel(url, expected_sha256)` and downloads. Verifies SHA-256 before linking into `/var/lib/krova-agent/kernels/`.

### 9.2 Snapshot/backup uploads

The agent has SFTP credentials for the assigned Storage Box (provided in `agent_config` during enrollment, rotated quarterly). For each snapshot/backup:

1. Krova calls `Snapshot.Create(cube_id, target_storage_box_id, target_path)`.
2. Agent compresses rootfs via `zstd`, computes SHA-256, SFTPs to Storage Box.
3. Agent emits progress events.
4. On success, agent calls `Krova.Snapshot.Confirm(snapshot_id, sha256, size)` — Krova updates `cube_snapshots` row.

This matches today's flow but pushes the SFTP work onto the agent (it's already on the host).

### 9.3 Compose/image build artifacts

Quick Boot builds: artifact stays local on the destination host.
Templates: agent SFTPs the built rootfs to Storage Box under the operator's template path. Krova writes a `templates` catalog row.

---

## 10. Streaming server-push

Server-streaming gRPC handles all long-running progress reporting:
- `VM.StreamEvents` — cube state changes (booted, halted, crashed, oom_killed)
- `Snapshot.StreamProgress`, `Build.StreamBuildLog`, `Migration.StreamProgress` — long ops
- `Metrics.StreamCubeMetrics` — live metric ticks for a customer's open dashboard

Krova subscribes per-cube on demand (when a customer opens the cube detail page) and unsubscribes when the page closes. Streams are NOT persistent across requests — closing the stream is the cleanup.

Console streaming is WebSocket only (see §6.9).

---

## 11. Versioning & upgrades

### 11.1 Agent self-upgrade

When Krova decides an agent needs to upgrade:
1. Krova calls `agent.System.UpgradeSelf(target_version, signed_url, sha256)`.
2. Agent downloads new binary to `/usr/local/bin/krova-agent.new`. Verifies SHA-256 + signature against the Krova public release key.
3. Agent calls `systemctl reload krova-agent` (the systemd unit uses `ExecReload` to trigger a SIGHUP, which the agent handles by exec-ing the new binary, passing fd state).
4. New process inherits TCP listener, accepts in-flight requests, kills the old process.

Cube processes (Firecracker) are NOT restarted — they keep running. Only the agent itself restarts. mTLS connections drop and are reconnected by Krova.

### 11.2 Rollback

If the new agent fails health-check within 5 min, `krova-agent.old` is restored by the systemd `ExecStartPre` shim. Cubes keep running through both directions.

### 11.3 Upgrade scheduling

Krova rolls upgrades region-by-region, 10% of fleet at a time, with 1-hour soak between waves. Operator can pause/cancel from Orbit.

### 11.4 Forced upgrade

If MIN_AGENT_VERSION is bumped (because Krova adds a backwards-incompatible feature), all agents below that version get forced-upgraded on their next heartbeat. Agents that fail to upgrade are removed from the scheduling pool and the operator gets a Pusher alert + email.

---

## 12. Security model

### 12.1 Threats considered

| Threat | Mitigation |
|---|---|
| Stolen bootstrap token | Single-use, 24h TTL, scoped to region |
| Stolen agent cert | 90d TTL, CRL via DB, revocable in Orbit |
| Compromised agent host | Jailer per cube (chroot + UID/GID isolation); no agent-to-agent connections except mTLS during migration |
| Krova → agent MITM | mTLS pinning of Krova's CA in agent identity dir |
| Agent → Krova MITM | mTLS with agent's per-server cert |
| Replay of console JWT | `jti` replay cache, 10-min TTL, 5-min token expiry |
| Customer escapes cube → host | Jailer chroot, dedicated UID per cube, no host filesystem access |
| Customer reads another cube's data | Per-cube data dir, per-cube UID, exclusive disk file ownership |
| Agent binary tampering | Signed release artifacts, agent verifies own signature on start |

### 12.2 Jailer is non-optional in v1

Krova today runs Firecracker bare-root (no jailer). The agent **always** uses jailer with:
- Per-cube chroot at `/srv/jailer/<cube_id>/`
- Per-cube UID = `100000 + (cube_id_hash % 65000)` (deterministic so reboots preserve ownership)
- Per-cube GID = same as UID
- Linux capabilities: only `CAP_NET_ADMIN` for TAP setup

This is a hardening upgrade that customers (and any future SOC 2 / ISO 27001 audit) will notice immediately.

### 12.3 No customer-controllable agent surface

Customers cannot reach the agent directly. The browser console goes Krova → agent. Every customer-driven action goes via Krova's API → pg-boss → agent. The agent's `:8443` is exposed only to Krova's egress IPs (Caddy firewall rules during setup phase).

### 12.4 Operator-controllable agent surface

Operator-level actions (kernel build, Firecracker upgrade, agent config) go through Krova's Orbit UI, which calls the agent over the same mTLS channel — no separate "admin port" on the agent.

---

## 13. Idempotency, retries, failures

### 13.1 Every mutating RPC takes an `idempotency_key`

The agent's `operations` table records `(idempotency_key, rpc_name, request_hash, status, result_blob)`. Identical retries within 24h return the cached result; mismatched retries (same key, different request body) return `ALREADY_EXISTS` with the conflicting request hash.

### 13.2 RPC retry policy (Krova side)

| Code | Retry? | Strategy |
|---|---|---|
| `UNAVAILABLE` | Yes | Exponential backoff, max 5 attempts |
| `DEADLINE_EXCEEDED` | Yes | Same |
| `INTERNAL` | No | Surface to operator |
| `FAILED_PRECONDITION` | No | Reflects real state — Krova should re-read |
| `RESOURCE_EXHAUSTED` | No | Krova reschedules to a different host |

### 13.3 In-flight ops during agent restart

If the agent restarts mid-operation (e.g., during self-upgrade), the operations table preserves the `idempotency_key + status=in_progress` row. On boot, the agent runs a recovery pass:
- `in_progress` operations: try to resume if resumable (e.g., a partial SFTP upload), otherwise mark `failed` and emit event.
- Krova retries from its end using the same idempotency key — gets `failed` back, decides whether to re-issue with a new key.

### 13.4 Crash recovery for cubes

If a cube's Firecracker process exits unexpectedly:
- Agent's process monitor catches it via `os.Process.Wait()`.
- Local cube row → `status=crashed`.
- Event emitted to Krova: `cube.crashed(reason)`.
- **Agent does NOT auto-restart.** Krova decides the policy (some cubes might need operator inspection).

### 13.5 Host reboot recovery

Already covered in §8 — agent detects boot-id mismatch, restarts all `running` cubes. Eliminates today's `server.reboot-recovery` job.

---

## 14. Packaging & install

### 14.1 Distribution channels

- **`.deb`** for Debian 12 / Ubuntu 22.04 / Ubuntu 24.04
- **`.rpm`** for AlmaLinux 9 / RHEL 9 / Rocky 9
- **`install.sh`** that detects the distro, sets up the apt or yum repo, installs

### 14.2 Repository hosting

- `https://apt.krova.cloud/` — Debian-style repo, signed with Krova's release key
- `https://yum.krova.cloud/` — RPM-style repo, same key
- `https://install.krova.cloud/agent.sh` — the one-line installer

The release key is rotated yearly; old keys remain valid for 2 years for old installs that haven't updated.

### 14.3 Package contents

```
/usr/local/bin/krova-agent                    # the binary
/etc/krova-agent/                             # config + identity dir (mode 0700)
/etc/systemd/system/krova-agent.service       # systemd unit
/var/lib/krova-agent/                         # state dir (cubes, images, db)
/var/log/krova-agent/                         # log dir (rotated by journald)
```

The package's post-install script:
1. Creates a `krova` system user/group (the agent runs as root because it needs `CAP_NET_ADMIN` + KVM access, but jailer drops capabilities for cubes).
2. Enables but does NOT start the service (waits for `krova-agent join`).
3. Prints a message: "Run `krova-agent join --token=<token> --control=<url>` to join your Krova fleet."

### 14.4 Removal

```sh
sudo apt remove krova-agent       # keeps /var/lib/krova-agent (state)
sudo apt purge krova-agent        # removes state too
```

Purge sends a final `Agent.Goodbye` to Krova before deleting cert, so Krova knows to mark the server `retired`.

---

## 15. Krova-side changes

The agent is half the work. Krova-side changes:

### 15.1 New service module: `lib/agent/`

- `client.ts` — gRPC client pool, mTLS config, retry policies
- `events.ts` — event-stream consumer (long-lived stream per agent)
- `transport.ts` — protobuf marshaling helpers

### 15.2 Worker handler refactor

Every `lib/worker/handlers/*.ts` that currently SSHes into a server gets two implementations during the transition:
- SSH (existing) — for hosts not yet running agent
- Agent (new) — for hosts where `servers.agent_version IS NOT NULL`

A dispatcher in each handler picks based on the server's agent status. Hosts complete migration when their last cube is moved to an agent-backed flow. The SSH path stays for ~6 months minimum during rollout.

### 15.3 New tables

```
bootstrap_tokens          (per §4.1)
agent_certificates        (issued certs, serial, expiry, revoked_at)
agent_events              (durable copy of important agent events for audit)
templates                 (Templates flow — built rootfs catalog)
data_disks                (per §0.2)
```

### 15.4 New Orbit pages

- Bootstrap-token mint UI
- Agent status per server (online, last heartbeat, version, cert expiry)
- Agent upgrade scheduling
- Agent revoke + re-bootstrap
- Compose/image/QEMU build progress (when used via Templates)
- Template catalog management

### 15.5 New customer-facing UI

- "Boot from Docker image / Compose / QEMU" in the cube-create flow
- Browser serial console on the cube detail page
- Multi-NIC attachment UI
- Data disk attachment + mount-point editor
- Per-network firewall rules (source IP allowlist) — gated behind paid plans

---

## 16. Phased rollout plan

The user said effort/timing isn't a constraint — but rollout still has to be staged to keep production safe. **No big-bang cutover.**

### Phase 0 — design + proto (1–2 weeks)

- Finalize `.proto` files for all 10 services.
- Land them in the Krova repo under `lib/agent/proto/`.
- Generate TypeScript + Go bindings.
- One PR, no implementation — review-only.

### Phase 1 — read-only agent in shadow (3–4 weeks)

- Build the agent binary with ONLY `Bootstrap`, `VM.Get/List`, `Metrics`, `System.Health`.
- Ship as `.deb`.
- Deploy to ALL existing servers in parallel with the SSH path. Agent reports cube status; Krova compares with SSH-path status. Discrepancy logging only — no decisions made on agent data yet.
- Soak 2 weeks. If agent + SSH agree on every cube every time, ship Phase 2.

### Phase 2 — single-cube ops via agent (4–6 weeks)

- Add `VM.Boot`, `VM.Sleep`, `VM.ForceStop`, `VM.Get` to the agent.
- Add a per-server feature flag `prefer_agent_for_cube_ops`. Operator flips on for one server at a time.
- Cube boot/sleep/stop for flagged servers go through agent; others stay SSH.
- 4-week soak per server before expanding.

### Phase 3 — resize + snapshot + backup via agent (6–8 weeks)

- Add `VM.Resize`, `Snapshot.*`, `Backup.*` to the agent.
- Same per-server flag expansion.

### Phase 4 — new features ship agent-only (rolling)

- Multi-disk, browser console, Compose/image/QEMU import, differential snapshots, live migration — these ship ONLY to agent-backed servers. Customers on SSH-only servers don't get them yet.
- This creates a natural incentive to migrate the remaining servers.

### Phase 5 — SSH path retirement (target: 12 months after Phase 1)

- All servers migrated. SSH path code paths deleted. `lib/ssh/*` modules removed.

Total calendar time to "agent everywhere": ~12 months. Customer-visible value (new features) ships from Phase 4 onward.

---

## 17. Open questions

These need decisions before we cut a v1 release tag, but they don't block starting the work.

1. **Agent ↔ agent direct trust for live migration.** Today's mTLS is agent ↔ Krova. For live migration, source needs to dial destination directly. Options: (a) issue migration-specific short-lived certs from Krova for each transfer, (b) extend the agent's existing cert to be valid for peer-agent traffic too. (a) is more secure, (b) is simpler. Lean (a).
2. **Where to host the apt/yum repos.** Operations: own infrastructure or use a hosted package-cloud service (e.g., packagecloud.io, Cloudsmith)? Hosted is easier but adds a vendor.
3. **gRPC vs Connect.** Connect (connectrpc.com) is gRPC-compatible but works natively over HTTP/1.1 + JSON without an envoy proxy — simpler for ops, slightly less performant. Worth considering.
4. **Multi-disk + snapshot semantics.** When a cube has a rootfs + 2 data disks and the customer snapshots: snapshot all 3? Just rootfs? Per-disk choice? Recommend per-disk choice (rootfs snapshot is the default, data disks have their own).
5. **Agent SQLite WAL configuration.** Default Postgres-style settings (journal_mode=WAL, synchronous=NORMAL)? Or stricter durability? Affects crash-recovery completeness vs write throughput.
6. **Browser console multiplexing.** If two operators open the same cube's console simultaneously, do they share stdin (chaos) or only one writes (last-opens-wins)? Recommend one-writer-at-a-time, others get a read-only view.
7. **Compose build resource limits.** A Compose build is CPU + RAM + disk hungry. Should the agent reserve resources for it, or let it compete freely with cubes? Lean toward CPU-cgroup limit + temp-disk quota.
8. **Storage Box rotation.** Today Krova has one Storage Box per region. With the agent SFTPing directly, key rotation needs to push new creds to every agent. How frequent, how coordinated?
9. **Live-migration MTU mismatch.** Source on jumbo-frame net, destination on standard MTU — migration must detect this and either negotiate down or refuse.
10. **What about Krova's existing customers during Phase 4–5?** Some won't be on agent-backed servers when new features ship. Do we migrate their cubes proactively (live migration!), or wait until they happen to be rescheduled?

---

## 18. Glossary

- **Agent** — the `krova-agent` Go binary running on a bare-metal host.
- **Bootstrap token** — single-use 24h token operators use to enroll a new host into Krova.
- **Cube** — a Firecracker microVM, Krova's customer-facing primitive.
- **Compose Build** — building a bootable ext4 rootfs from a `docker-compose.yml`.
- **Image Build** — building a bootable ext4 rootfs from a single Docker image reference.
- **Jailer** — Firecracker's standard hardening wrapper that chroots + drops UID/GID per microVM.
- **Live migration** — moving a running cube between hosts without halting it.
- **mTLS** — mutual TLS, where both sides authenticate with X.509 certs.
- **Quick Boot** — building a rootfs inline at cube-provision time, single-use.
- **Templates** — building a reusable rootfs catalog entry, multi-use, paid feature.
- **virtio-mem** — Firecracker's mechanism for hot-adding RAM to a running VM.

---

## Appendix A — feature-source mapping

For traceability against the original audit (`firecrackmanager` repo). Each feature here lists the firecrackmanager module that inspired it, when applicable. Krova's implementation is independent — this is for design reference, not code reuse.

| Krova-agent feature | firecrackmanager source |
|---|---|
| VM lifecycle + jailer | `internal/vm/vm.go` |
| Snapshots (full + diff) | `internal/vm/vm.go` snapshot methods |
| Disk attach + fstab | `internal/vm/vm.go` `AttachDisk` |
| Compose → ext4 | `internal/Compose2FC/` |
| Image → ext4 | `internal/RegistryToFC/` |
| QEMU → ext4 | `internal/QemuToFC/` |
| Kernel build | `internal/kernelbuilder/` |
| Metric downsampling | `cmd/firecrackmanager/main.go` lines 273–353 |
| Rootfs scanner | `internal/rootfs/scanner.go` |
| Kernel virtio scanner | `internal/kernelscanner/scanner.go` |
| Per-network firewall | `internal/firewall/firewall.go` |
| Live migration | `internal/vm/vm.go` `Migration*` types |
| Image search (Docker Hub / Quay / GitLab) | `internal/Compose2FC/Registries.go` |
| HTTP proxy config | `internal/proxyconfig/proxyconfig.go` |
| Raw-syscall TAP creation | `internal/network/network.go` |
| Browser console (WebSocket) | `internal/api/api.go` `handleVMConsole` |
| Auto-rootfs fixups | `internal/vm/vm.go` `fix*` methods |
| Reachability check | `internal/api/api.go` `handlePing`/`handleScanPorts` |
