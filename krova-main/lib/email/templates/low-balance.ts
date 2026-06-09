import { createElement } from "react";
import { LowBalanceEmail } from "@/lib/email/components/low-balance";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface LowBalanceEmailOptions {
  currentBalance: string;
  /** Free plans get the "Choose a Plan" CTA; paid plans get "Add Credits". */
  isFreePlan: boolean;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  userName: string;
}

export async function lowBalanceEmailTemplate({
  userName,
  spaceName,
  currentBalance,
  spaceUrl,
  isFreePlan,
  productName,
}: LowBalanceEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(LowBalanceEmail, {
      userName,
      spaceName,
      currentBalance,
      spaceUrl,
      isFreePlan,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const ctaLine = isFreePlan
    ? `Choose a plan at: ${spaceUrl}?plan=open`
    : `Add credits at: ${spaceUrl}?topup=open`;

  const text = `Hi ${userName},

Low credit balance warning for ${spaceName}.

Current balance: $${currentBalance}

When the balance reaches $0, all running Cubes will be automatically put to sleep.

${ctaLine}`;

  return { html, text };
}
