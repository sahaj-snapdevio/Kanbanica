import { createElement } from "react";

import { enqueueEmail } from "@/lib/email";
import { AdminSpaceDeletedEmail } from "@/lib/email/components/admin-space-deleted";
import { AdminUserDeletedEmail } from "@/lib/email/components/admin-user-deleted";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";
import type {
  SpaceDeletionSummary,
  UserDeletionSummary,
} from "@/lib/orbit/deletion-summaries";
import { getErrorNotifyEmails } from "@/lib/service-config";

const isoOrEmpty = (d: Date | null | undefined): string =>
  d ? d.toISOString().slice(0, 10) : "";

const initiatorLabel = (initiator: {
  type: "admin" | "owner" | "system";
  email: string | null;
  userId: string | null;
}): string => {
  if (initiator.type === "system") {
    return "System (automated)";
  }
  const role = initiator.type === "admin" ? "Admin" : "Owner (self-service)";
  return initiator.email ? `${role} — ${initiator.email}` : role;
};

/**
 * Send an admin notification when a user is deleted. Recipients come from
 * the operator's configured ERROR_NOTIFY_EMAILS list (same source as the
 * Cube error alerts). No-ops cleanly if no recipients are configured.
 */
export async function notifyAdminsOfUserDeletion(
  summary: UserDeletionSummary
): Promise<void> {
  const recipients = await getErrorNotifyEmails();
  if (recipients.length === 0) {
    return;
  }

  const branding = await getPlatformBranding();
  const subject = `[${branding.productName}] User deleted: ${summary.email}`;

  const html = await renderEmailTemplate(
    createElement(AdminUserDeletedEmail, {
      userEmail: summary.email,
      userName: summary.name,
      userId: summary.userId,
      accountCreatedAt: isoOrEmpty(summary.createdAt),
      lastSignedInAt: summary.lastSignedInAt
        ? isoOrEmpty(summary.lastSignedInAt)
        : null,
      role: summary.role,
      emailVerified: summary.emailVerified,
      membershipsRemoved: summary.spaces,
      initiatorLabel: initiatorLabel(summary.initiator),
      reason: summary.reason,
      productName: branding.productName,
      logoUrl: branding.logoUrl,
    })
  );

  const text = [
    "User Deleted",
    "",
    `Email: ${summary.email}`,
    `Name: ${summary.name}`,
    `User ID: ${summary.userId}`,
    `Created: ${isoOrEmpty(summary.createdAt)}`,
    `Last sign-in: ${summary.lastSignedInAt ? isoOrEmpty(summary.lastSignedInAt) : "Never"}`,
    `Role: ${summary.role ?? "user"}`,
    `Email verified: ${summary.emailVerified ? "Yes" : "No"}`,
    `Deleted by: ${initiatorLabel(summary.initiator)}`,
    "",
    `Memberships removed (${summary.spaces.length}):`,
    ...summary.spaces.map((s) => `  - ${s.spaceName} (${s.spaceId})`),
    "",
    summary.reason ? `Reason: ${summary.reason}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  for (const to of recipients) {
    try {
      await enqueueEmail({ to, subject, html, text });
    } catch (err) {
      console.error(
        `[notify-deletion] failed to enqueue user-deleted email to ${to}:`,
        err
      );
    }
  }
}

/**
 * Send an admin notification when a space is deleted. The summary may carry
 * an `orphanUsersDeleted` augmentation from the space-delete worker.
 */
export async function notifyAdminsOfSpaceDeletion(
  summary: SpaceDeletionSummary & { orphanUsersDeleted?: string[] }
): Promise<void> {
  const recipients = await getErrorNotifyEmails();
  if (recipients.length === 0) {
    return;
  }

  const branding = await getPlatformBranding();
  const subject = `[${branding.productName}] Space deleted: ${summary.spaceName}`;

  const ownerLabel = summary.owner.email
    ? `${summary.owner.email}${summary.owner.name ? ` (${summary.owner.name})` : ""}`
    : "—";
  const totalRamGb = Math.round((summary.cubes.totalRamMb / 1024) * 100) / 100;
  const planLabel = summary.planName
    ? `${summary.planName} (${summary.planId})`
    : summary.planId;

  const html = await renderEmailTemplate(
    createElement(AdminSpaceDeletedEmail, {
      spaceName: summary.spaceName,
      spaceId: summary.spaceId,
      ownerLabel,
      planLabel,
      subscriptionStatus: summary.subscriptionStatus,
      spaceCreatedAt: isoOrEmpty(summary.createdAt),
      creditBalanceUsd: summary.creditBalanceUsd,
      cubeCount: summary.cubes.count,
      totalVcpus: summary.cubes.totalVcpus,
      totalRamGb,
      totalDiskGb: summary.cubes.totalDiskGb,
      cubeNames: summary.cubes.names,
      snapshotCount: summary.snapshots.count,
      snapshotTotalGb: summary.snapshots.totalGb,
      backupCount: summary.backups.count,
      backupTotalGb: summary.backups.totalGb,
      domainCount: summary.domains.count,
      domainHostnames: summary.domains.hostnames,
      memberCount: summary.members.count,
      memberEmails: summary.members.emails,
      orphanUsersDeleted: summary.orphanUsersDeleted ?? [],
      initiatorLabel: initiatorLabel(summary.initiator),
      productName: branding.productName,
      logoUrl: branding.logoUrl,
    })
  );

  const text = [
    "Space Deleted",
    "",
    `Space: ${summary.spaceName}`,
    `Space ID: ${summary.spaceId}`,
    `Owner: ${ownerLabel}`,
    `Plan: ${planLabel}`,
    `Subscription: ${summary.subscriptionStatus ?? "—"}`,
    `Created: ${isoOrEmpty(summary.createdAt)}`,
    `Credit forfeited: $${summary.creditBalanceUsd}`,
    `Deleted by: ${initiatorLabel(summary.initiator)}`,
    "",
    `Cubes: ${summary.cubes.count} — ${summary.cubes.totalVcpus} vCPUs, ${totalRamGb} GB RAM, ${summary.cubes.totalDiskGb} GB disk`,
    `Snapshots: ${summary.snapshots.count} (${summary.snapshots.totalGb} GB)`,
    `Backups: ${summary.backups.count} (${summary.backups.totalGb} GB)`,
    `Domains: ${summary.domains.count}`,
    `Members affected: ${summary.members.count}`,
    `Orphan accounts deleted: ${(summary.orphanUsersDeleted ?? []).length}`,
  ].join("\n");

  for (const to of recipients) {
    try {
      await enqueueEmail({ to, subject, html, text });
    } catch (err) {
      console.error(
        `[notify-deletion] failed to enqueue space-deleted email to ${to}:`,
        err
      );
    }
  }
}
