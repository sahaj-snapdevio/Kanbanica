import type {
  Cube,
  CubeBackup,
  DomainMapping,
  TcpPortMapping,
} from "@/db/schema/types";

/**
 * Per-event payload builders. Every outbound-webhook fan-out goes through one
 * of these so the wire format stays consistent across handlers and the docs in
 * `docs/api/v1.md`. Add a new builder here rather than inlining JSON at the
 * call site (Rule 14).
 *
 * Each function returns the `data` object that goes inside the envelope
 * `{id, event, createdAt, spaceId, data}` published by
 * `lib/webhook-dispatch.ts`.
 */

export interface CubeSummary {
  diskLimitGb: number;
  id: string;
  imageId: string;
  name: string;
  ramMb: number;
  regionId: string | null;
  serverId: string;
  status: string;
  vcpus: number;
}

export function buildCubeSummary(
  cube: Pick<
    Cube,
    | "id"
    | "name"
    | "status"
    | "vcpus"
    | "ramMb"
    | "diskLimitGb"
    | "imageId"
    | "serverId"
  > & { regionId?: string | null }
): CubeSummary {
  return {
    diskLimitGb: cube.diskLimitGb,
    id: cube.id,
    imageId: cube.imageId,
    name: cube.name,
    ramMb: cube.ramMb,
    regionId: cube.regionId ?? null,
    serverId: cube.serverId,
    status: cube.status,
    vcpus: cube.vcpus,
  };
}

export interface CubeShape {
  diskLimitGb: number;
  ramMb: number;
  vcpus: number;
}

export interface ResizeDetail {
  from: CubeShape;
  to: CubeShape;
}

export interface TransferDetail {
  fromServerId: string;
  toServerId: string;
}

export function buildSnapshotPayload(snapshot: {
  cubeId: string;
  id: string;
  kind: "auto" | "manual";
  name: string;
  sizeBytes: number | null;
}) {
  return {
    cubeId: snapshot.cubeId,
    id: snapshot.id,
    kind: snapshot.kind,
    name: snapshot.name,
    sizeBytes: snapshot.sizeBytes,
  };
}

export function buildBackupPayload(
  backup: Pick<
    CubeBackup,
    | "id"
    | "name"
    | "originalCubeId"
    | "originalCubeName"
    | "diskSizeGb"
    | "sizeBytes"
  >
) {
  return {
    diskSizeGb: backup.diskSizeGb,
    id: backup.id,
    name: backup.name,
    originalCubeId: backup.originalCubeId,
    originalCubeName: backup.originalCubeName,
    sizeBytes: backup.sizeBytes,
  };
}

export function buildDomainPayload(
  domain: Pick<
    DomainMapping,
    "id" | "cubeId" | "domain" | "port" | "status" | "cloudflareStatus"
  >
) {
  return {
    cloudflareStatus: domain.cloudflareStatus,
    cubeId: domain.cubeId,
    domain: domain.domain,
    id: domain.id,
    port: domain.port,
    status: domain.status,
  };
}

export function buildTcpMappingPayload(
  mapping: Pick<
    TcpPortMapping,
    "id" | "cubeId" | "cubePort" | "hostPort" | "label" | "isSsh" | "status"
  >,
  whitelistedCidrs: string[] = []
) {
  return {
    cubeId: mapping.cubeId,
    cubePort: mapping.cubePort,
    hostPort: mapping.hostPort,
    id: mapping.id,
    isSsh: mapping.isSsh,
    label: mapping.label,
    status: mapping.status,
    whitelistedCidrs,
  };
}

export function buildMemberPayload(member: {
  email: string;
  permissions: string[];
  userId: string;
}) {
  return {
    email: member.email,
    permissions: member.permissions,
    userId: member.userId,
  };
}

export function buildInvitePayload(invite: {
  email: string;
  id: string;
  permissions: string[];
}) {
  return {
    email: invite.email,
    id: invite.id,
    permissions: invite.permissions,
  };
}

export function buildSubscriptionPayload(args: {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  plan: { id: string; name: string; priceUsd: string };
  providerSubscriptionId: string | null;
  status: string | null;
}) {
  return {
    cancelAtPeriodEnd: args.cancelAtPeriodEnd,
    currentPeriodEnd: args.currentPeriodEnd
      ? args.currentPeriodEnd.toISOString()
      : null,
    plan: args.plan,
    providerSubscriptionId: args.providerSubscriptionId,
    status: args.status,
  };
}
