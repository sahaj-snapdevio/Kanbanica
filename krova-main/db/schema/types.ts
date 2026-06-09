import type { InferInsertModel, InferSelectModel } from "drizzle-orm"

import type { user, session, account, verification } from "@/db/schema/auth"
import type {
  spaces,
  spaceMemberships,
  memberPermissions,
  memberCubeAssignments,
} from "@/db/schema/spaces"
import type { invites } from "@/db/schema/invites"
import type { sshKeys } from "@/db/schema/ssh-keys"
import type { regions } from "@/db/schema/regions"
import type { servers } from "@/db/schema/servers"
import type { cubes, allocatedPorts } from "@/db/schema/cubes"
import type { domainMappings } from "@/db/schema/domains"
import type { spaceDomainClaims } from "@/db/schema/domain-claims"
import type { tcpPortMappings, tcpMappingWhitelistedIps } from "@/db/schema/tcp-mappings"
import type { lifecycleLogs } from "@/db/schema/logs"
import type { billingEvents } from "@/db/schema/billing"
import type { cubeBackups } from "@/db/schema/backups"

// Auth
export type User = InferSelectModel<typeof user>
export type NewUser = InferInsertModel<typeof user>
export type Session = InferSelectModel<typeof session>
export type NewSession = InferInsertModel<typeof session>
export type Account = InferSelectModel<typeof account>
export type NewAccount = InferInsertModel<typeof account>
export type Verification = InferSelectModel<typeof verification>
export type NewVerification = InferInsertModel<typeof verification>

// Spaces
export type Space = InferSelectModel<typeof spaces>
export type NewSpace = InferInsertModel<typeof spaces>
export type SpaceMembership = InferSelectModel<typeof spaceMemberships>
export type NewSpaceMembership = InferInsertModel<typeof spaceMemberships>
export type MemberPermission = InferSelectModel<typeof memberPermissions>
export type NewMemberPermission = InferInsertModel<typeof memberPermissions>
export type MemberCubeAssignment = InferSelectModel<
  typeof memberCubeAssignments
>
export type NewMemberCubeAssignment = InferInsertModel<
  typeof memberCubeAssignments
>

// Invites
export type Invite = InferSelectModel<typeof invites>
export type NewInvite = InferInsertModel<typeof invites>

// SSH Keys (operator/platform — bare-metal host access)
export type SshKey = InferSelectModel<typeof sshKeys>
export type NewSshKey = InferInsertModel<typeof sshKeys>

// Regions
export type Region = InferSelectModel<typeof regions>
export type NewRegion = InferInsertModel<typeof regions>

// Servers
export type Server = InferSelectModel<typeof servers>
export type NewServer = InferInsertModel<typeof servers>

// Cubes
export type Cube = InferSelectModel<typeof cubes>
export type NewCube = InferInsertModel<typeof cubes>
export type AllocatedPort = InferSelectModel<typeof allocatedPorts>
export type NewAllocatedPort = InferInsertModel<typeof allocatedPorts>

// Domains
export type DomainMapping = InferSelectModel<typeof domainMappings>
export type NewDomainMapping = InferInsertModel<typeof domainMappings>
export type SpaceDomainClaim = InferSelectModel<typeof spaceDomainClaims>
export type NewSpaceDomainClaim = InferInsertModel<typeof spaceDomainClaims>

// TCP Mappings
export type TcpPortMapping = InferSelectModel<typeof tcpPortMappings>
export type NewTcpPortMapping = InferInsertModel<typeof tcpPortMappings>
export type TcpMappingWhitelistedIp = InferSelectModel<
  typeof tcpMappingWhitelistedIps
>
export type NewTcpMappingWhitelistedIp = InferInsertModel<
  typeof tcpMappingWhitelistedIps
>

// Logs
export type LifecycleLog = InferSelectModel<typeof lifecycleLogs>
export type NewLifecycleLog = InferInsertModel<typeof lifecycleLogs>

// Billing
export type BillingEvent = InferSelectModel<typeof billingEvents>
export type NewBillingEvent = InferInsertModel<typeof billingEvents>

// Backups
export type CubeBackup = InferSelectModel<typeof cubeBackups>
export type NewCubeBackup = InferInsertModel<typeof cubeBackups>

// Runtime constants
export const PERMISSION_VALUES = [
  "cube.view",
  "cube.create",
  "cube.manage",
  "billing.view",
  "billing.manage",
  "members.invite",
  "members.manage",
  "webhook.manage",
] as const

export type PermissionValue = (typeof PERMISSION_VALUES)[number]

/**
 * Permissions hidden from the UI (invite picker, edit dialog, member badges,
 * invite emails) but still valid on existing rows. Empty for now — kept as a
 * filter point so future features can hide a permission without changing
 * every consumer.
 */
export const HIDDEN_PERMISSION_VALUES: readonly PermissionValue[] = [] as const

export const VISIBLE_PERMISSION_VALUES = PERMISSION_VALUES.filter(
  (p) => !HIDDEN_PERMISSION_VALUES.includes(p)
) as PermissionValue[]

export function isVisiblePermission(p: string): boolean {
  return (VISIBLE_PERMISSION_VALUES as string[]).includes(p)
}

export const CUBE_STATUS_VALUES = [
  "pending",
  "booting",
  "running",
  "sleeping",
  "stopping",
  "deleted",
  "error",
] as const

export type CubeStatusValue = (typeof CUBE_STATUS_VALUES)[number]

export const PERMISSION_LABELS: Record<string, string> = {
  "cube.view": "View Cubes",
  "cube.create": "Create Cubes",
  "cube.manage": "Manage Cubes",
  "billing.view": "View Billing",
  "billing.manage": "Manage Billing",
  "members.invite": "Invite Members",
  "members.manage": "Manage Members",
}
