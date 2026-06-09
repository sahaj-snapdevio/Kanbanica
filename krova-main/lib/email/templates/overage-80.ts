import { createElement } from "react";
import { Overage80Email } from "@/lib/email/components/overage-80";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface Overage80EmailOptions {
  cap: string;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  thisPeriodOverage: string;
  userName: string;
}

export async function overage80EmailTemplate({
  userName,
  spaceName,
  thisPeriodOverage,
  cap,
  spaceUrl,
  productName,
}: Overage80EmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(Overage80Email, {
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

You're nearing your overage cap for ${spaceName} — $${thisPeriodOverage} of $${cap} used. If you hit the cap, your Cubes will be paused until the cap resets next period or you raise it.

View billing: ${spaceUrl}`;

  return { html, text };
}
