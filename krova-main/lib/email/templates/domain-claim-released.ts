import { createElement } from "react";
import { DomainClaimReleasedEmail } from "@/lib/email/components/domain-claim-released";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface DomainClaimReleasedEmailOptions {
  domain: string;
  productName?: string;
  settingsUrl: string;
  spaceName: string;
  userName: string;
}

export async function domainClaimReleasedEmailTemplate({
  userName,
  spaceName,
  domain,
  settingsUrl,
  productName,
}: DomainClaimReleasedEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(DomainClaimReleasedEmail, {
      userName,
      spaceName,
      domain,
      settingsUrl,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text = `Hi ${userName},

The ownership-verification TXT record for ${domain} could no longer be found, so we released ${spaceName}'s lock on it. Other spaces can now claim this domain.

If you still own this domain, re-add the TXT record and verify it again to restore the lock:
${settingsUrl}`;

  return { html, text };
}
