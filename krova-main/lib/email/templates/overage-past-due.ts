import { createElement } from "react";
import { OveragePastDueEmail } from "@/lib/email/components/overage-past-due";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface OveragePastDueEmailOptions {
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  userName: string;
}

export async function overagePastDueEmailTemplate({
  userName,
  spaceName,
  spaceUrl,
  productName,
}: OveragePastDueEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(OveragePastDueEmail, {
      userName,
      spaceName,
      spaceUrl,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text = `Hi ${userName},

Card payment failed for ${spaceName} — overage is paused until your subscription returns to active. Cubes will sleep if your prepaid credit runs out.

Update your payment method: ${spaceUrl}`;

  return { html, text };
}
