import { createElement } from "react";
import { OverageStartedEmail } from "@/lib/email/components/overage-started";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface OverageStartedEmailOptions {
  cap: string;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  thisPeriodOverage: string;
  userName: string;
}

export async function overageStartedEmailTemplate({
  userName,
  spaceName,
  thisPeriodOverage,
  cap,
  spaceUrl,
  productName,
}: OverageStartedEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(OverageStartedEmail, {
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

You've started using postpaid overage for ${spaceName}. $${thisPeriodOverage} this period of your $${cap} cap. Cubes keep running; the extra is billed on your next invoice.

View billing: ${spaceUrl}`;

  return { html, text };
}
