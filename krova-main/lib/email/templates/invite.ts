import { createElement } from "react";
import { isVisiblePermission, PERMISSION_LABELS } from "@/db/schema/types";
import { InviteEmail } from "@/lib/email/components/invite";
import { formatEmailDateUtc, getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface InviteEmailOptions {
  expiresAt: Date;
  invitedByName: string;
  inviteUrl: string;
  permissions: string[];
  productName?: string;
  spaceName: string;
}

export async function inviteEmailTemplate({
  invitedByName,
  spaceName,
  inviteUrl,
  permissions,
  expiresAt,
  productName,
}: InviteEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;
  const expiryStr = formatEmailDateUtc(expiresAt);

  const visiblePermissions = permissions.filter(isVisiblePermission);

  const html = await renderEmailTemplate(
    createElement(InviteEmail, {
      invitedByName,
      spaceName,
      inviteUrl,
      permissions: visiblePermissions,
      expiryStr,
      permissionLabels: PERMISSION_LABELS,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const permissionsText =
    visiblePermissions.length > 0
      ? `\nPermissions: ${visiblePermissions.map((p) => PERMISSION_LABELS[p] ?? p).join(", ")}`
      : "";

  const text = `${invitedByName} has invited you to join ${spaceName} on ${name}.${permissionsText}

Accept your invitation:
${inviteUrl}

This invitation expires on ${expiryStr}.`;

  return { html, text };
}
