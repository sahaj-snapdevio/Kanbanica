import { createElement } from "react";
import { PRODUCT_NAME } from "@/config/platform";
import { EmailChangeEmail } from "@/lib/email/components/email-change";
import { renderEmailTemplate } from "@/lib/email/renderer";

export async function emailChangeTemplate({
  newEmail,
  verifyUrl,
}: {
  newEmail: string;
  verifyUrl: string;
}) {
  const html = await renderEmailTemplate(
    createElement(EmailChangeEmail, {
      newEmail,
      verifyUrl,
      productName: PRODUCT_NAME,
    })
  );

  const text = `Confirm your new email address for ${PRODUCT_NAME}

You requested to change your account email to: ${newEmail}

Click the link below to confirm:
${verifyUrl}

This link expires in 1 hour. If you did not request this change, ignore this email — your account is unchanged.`;

  return { html, text };
}
