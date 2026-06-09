import { createElement } from "react";
import { Overage50Email } from "@/lib/email/components/overage-50";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface Overage50EmailOptions {
  cap: string;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  thisPeriodOverage: string;
  userName: string;
}

export async function overage50EmailTemplate({
  userName,
  spaceName,
  thisPeriodOverage,
  cap,
  spaceUrl,
  productName,
}: Overage50EmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(Overage50Email, {
      userName,
      spaceName,
      thisPeriodOverage,
      cap,
      spaceUrl,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text = `Hi ${userName},

You've used half your $${cap} overage budget for ${spaceName} — $${thisPeriodOverage} so far. Adjust your cap or top up to stay ahead.

View billing: ${spaceUrl}`;

  return { html, text };
}
