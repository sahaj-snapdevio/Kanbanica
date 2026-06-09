import { createElement } from "react";
import { CreditGrantedEmail } from "@/lib/email/components/credit-granted";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface CreditGrantedEmailOptions {
  amount: string;
  newBalance: string;
  note?: string;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  userName: string;
}

export async function creditGrantedEmailTemplate({
  userName,
  spaceName,
  amount,
  newBalance,
  note,
  spaceUrl,
  productName,
}: CreditGrantedEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(CreditGrantedEmail, {
      userName,
      spaceName,
      amount,
      newBalance,
      note,
      spaceUrl,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text = `Hi ${userName},

Credits have been added to your ${spaceName} workspace.

Credits Added: $${amount}
New Balance: $${newBalance}${note ? `\nNote: ${note}` : ""}

View billing: ${spaceUrl}`;

  return { html, text };
}
