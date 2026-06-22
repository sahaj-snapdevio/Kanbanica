import { createElement } from "react";
import { PRODUCT_NAME } from "@/config/platform";
import { WorkspaceInviteEmail } from "@/lib/email/components/workspace-invite";
import { renderEmailTemplate } from "@/lib/email/renderer";

export async function workspaceInviteTemplate({
  inviterName,
  workspaceName,
  inviteUrl,
}: {
  inviterName: string;
  workspaceName: string;
  inviteUrl: string;
}) {
  const html = await renderEmailTemplate(
    createElement(WorkspaceInviteEmail, {
      inviterName,
      workspaceName,
      inviteUrl,
      productName: PRODUCT_NAME,
    })
  );

  const text = `You're invited to ${workspaceName} on ${PRODUCT_NAME}

${inviterName} has invited you to join the ${workspaceName} workspace.

Accept your invitation here:
${inviteUrl}

This invitation expires in 7 days. If you did not expect this invite, you can ignore this email.`;

  return { html, text };
}
