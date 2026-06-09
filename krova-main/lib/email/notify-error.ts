import { createElement } from "react";
import { enqueueEmail } from "@/lib/email";
import { AdminCubeErrorEmail } from "@/lib/email/components/admin-cube-error";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";
import { env } from "@/lib/env";
import { getErrorNotifyEmails } from "@/lib/service-config";

/**
 * Optional manual-action hint included with the notification. When the
 * platform notices something it deliberately does not auto-fix (orphaned
 * VMs, ghost cubes, stale errors), it surfaces the host path + the exact
 * CLI command an admin would run to inspect / destroy.
 */
export interface CubeErrorManualAction {
  destroyCommand: string;
  diskSize: string;
  hostPath: string;
  inspectCommand: string;
  processState: string;
  serverHostname: string;
}

/**
 * Send a Cube error notification to all configured admin error emails.
 * Reads recipients from DB (serviceConfig) with env var fallback.
 * Does nothing if no recipients are configured.
 */
export async function notifyAdminsOfCubeError({
  cubeName,
  cubeId,
  spaceId,
  serverId,
  reason,
  manualAction,
}: {
  cubeName: string;
  cubeId: string;
  spaceId: string;
  serverId: string;
  reason: string;
  manualAction?: CubeErrorManualAction;
}): Promise<void> {
  const recipients = await getErrorNotifyEmails();
  if (recipients.length === 0) {
    return;
  }

  const branding = await getPlatformBranding();
  const cubeUrl = `${env.NEXT_PUBLIC_APP_URL}/orbit/cubes/${cubeId}`;
  const subject = `[${branding.productName}] Cube error: ${cubeName} (${cubeId.slice(0, 8)})`;

  const html = await renderEmailTemplate(
    createElement(AdminCubeErrorEmail, {
      cubeName,
      cubeId,
      spaceId,
      serverId,
      reason,
      cubeUrl,
      manualAction,
      productName: branding.productName,
      logoUrl: branding.logoUrl,
    })
  );

  const textLines = [
    "Cube Error Alert",
    "",
    `Cube: ${cubeName}`,
    `Cube ID: ${cubeId}`,
    `Space ID: ${spaceId}`,
    `Server ID: ${serverId}`,
    `Reason: ${reason}`,
  ];
  if (manualAction) {
    textLines.push(
      "",
      "Manual action required — nothing has been destroyed automatically.",
      `  Server: ${manualAction.serverHostname}`,
      `  Host path: ${manualAction.hostPath}`,
      `  Disk size: ${manualAction.diskSize}`,
      `  Process: ${manualAction.processState}`,
      "",
      "Inspect (read-only):",
      `  ${manualAction.inspectCommand}`,
      "",
      "Destroy after manual confirmation:",
      `  ${manualAction.destroyCommand}`
    );
  }
  textLines.push("", `View in Orbit: ${cubeUrl}`);
  const text = textLines.join("\n");

  for (const to of recipients) {
    try {
      await enqueueEmail({ to, subject, html, text });
    } catch (err) {
      console.error(
        `[notify-error] failed to enqueue error email to ${to}:`,
        err
      );
    }
  }
}
