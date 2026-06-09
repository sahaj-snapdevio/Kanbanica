import { createElement } from "react";
import { MagicLinkEmail } from "@/lib/email/components/magic-link";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface MagicLinkOptions {
  email: string;
  magicLinkUrl: string;
  productName?: string;
}

export async function magicLinkTemplate({
  email,
  magicLinkUrl,
  productName,
}: MagicLinkOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(MagicLinkEmail, {
      email,
      magicLinkUrl,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text = `Sign in to ${name}

Use the link below to sign in to your ${name} account:
${magicLinkUrl}

This link expires in 5 minutes and can only be used once.

If you did not request this link, you can safely ignore this email.`;

  return { html, text };
}
