import { createElement } from "react";
import { Text } from "react-email";
import { PRODUCT_NAME } from "@/config/platform";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";
import { renderEmailTemplate } from "@/lib/email/renderer";

function SupportTicketReplyEmail({
  userEmail,
  ticketNumber,
  subject,
  productName,
}: {
  userEmail: string;
  ticketNumber: string;
  subject: string;
  productName: string;
}) {
  return (
    <EmailLayout
      preview={`New reply on your ticket ${ticketNumber}`}
      productName={productName}
    >
      <Text style={emailStyles.heading}>You have a new reply</Text>
      <Text style={emailStyles.paragraph}>
        Hi {userEmail}, our support team has replied to your ticket{" "}
        <strong style={{ color: "#171717" }}>{ticketNumber}</strong>.
      </Text>
      <Text style={{ ...emailStyles.paragraph, fontStyle: "italic" }}>
        Subject: {subject}
      </Text>
      <Text style={emailStyles.paragraph}>
        Sign in to your account to view the reply and respond.
      </Text>
      <Text style={emailStyles.muted}>
        You can manage your tickets in Settings → Support.
      </Text>
    </EmailLayout>
  );
}

export async function supportTicketReplyTemplate({
  userEmail,
  ticketNumber,
  subject,
}: {
  userEmail: string;
  ticketNumber: string;
  subject: string;
}) {
  const html = await renderEmailTemplate(
    createElement(SupportTicketReplyEmail, {
      userEmail,
      ticketNumber,
      subject,
      productName: PRODUCT_NAME,
    })
  );

  const text = `You have a new reply on your support ticket

Ticket: ${ticketNumber}
Subject: ${subject}

Sign in to your account to view the reply and respond.`;

  return { html, text };
}
