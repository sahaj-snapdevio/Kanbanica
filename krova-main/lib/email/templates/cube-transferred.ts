import { createElement } from "react";
import { CubeTransferredEmail } from "@/lib/email/components/cube-transferred";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface CubeTransferredEmailOptions {
  cubeId: string;
  cubeName: string;
  cubeUrl: string;
  /**
   * Internal-only. Not rendered in customer-facing copy — kept on the options
   * shape so callers can pass the underlying error for log/audit correlation
   * without a separate side channel.
   */
  failureReason?: string;
  outcome: "success" | "failure";
  productName?: string;
  spaceName: string;
  userName: string;
}

export async function cubeTransferredEmailTemplate({
  userName,
  spaceName,
  cubeName,
  cubeId,
  cubeUrl,
  outcome,
  productName,
}: CubeTransferredEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(CubeTransferredEmail, {
      userName,
      spaceName,
      cubeName,
      cubeId,
      cubeUrl,
      outcome,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text =
    outcome === "success"
      ? `Hi ${userName},

Your Cube "${cubeName}" in ${spaceName} was migrated to a new server.

No action is needed on your end — your custom domains, TCP port forwards, and SSH access continue to work as before.

Cube ID: ${cubeId}

View the Cube: ${cubeUrl}`
      : `Hi ${userName},

We tried to migrate your Cube "${cubeName}" in ${spaceName} to a new server, but the migration did not complete.

Your Cube remains on its original server and is unaffected. Our engineering team has been notified and will look into it.

Cube ID: ${cubeId}

View the Cube: ${cubeUrl}`;

  return { html, text };
}
