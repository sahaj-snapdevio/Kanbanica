import { createElement } from "react";
import { WebhookAutoDisabledEmail } from "@/lib/email/components/webhook-auto-disabled";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface WebhookAutoDisabledEmailOptions {
  failures: number;
  productName?: string;
  settingsUrl: string;
  spaceName: string;
  url: string;
  userName: string;
}

export async function webhookAutoDisabledEmailTemplate({
  userName,
  spaceName,
  url,
  failures,
  settingsUrl,
  productName,
}: WebhookAutoDisabledEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(WebhookAutoDisabledEmail, {
      userName,
      spaceName,
      url,
      failures,
      settingsUrl,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text = `Hi ${userName},

We auto-disabled an outbound webhook for ${spaceName} after ${failures} consecutive failed deliveries.

Endpoint: ${url}

Future events will not be delivered until you fix the receiver and re-enable from:
${settingsUrl}`;

  return { html, text };
}
