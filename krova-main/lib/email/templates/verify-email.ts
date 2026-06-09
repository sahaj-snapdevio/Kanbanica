import { createElement } from "react";
import { VerifyEmailEmail } from "@/lib/email/components/verify-email";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface VerifyEmailOptions {
  newEmail: string;
  productName?: string;
  verificationUrl: string;
}

export async function verifyEmailTemplate({
  newEmail,
  verificationUrl,
  productName,
}: VerifyEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(VerifyEmailEmail, {
      newEmail,
      verificationUrl,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text = `Verify your new email

Click the link below to confirm changing your email to ${newEmail}:
${verificationUrl}

This link expires in 1 hour and can only be used once.

If you did not request this change, you can safely ignore this email.`;

  return { html, text };
}
