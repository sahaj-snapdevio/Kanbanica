import { createElement } from "react";
import { Section, Text } from "react-email";
import { PRODUCT_NAME } from "@/config/platform";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";
import { renderEmailTemplate } from "@/lib/email/renderer";

function SupportTicketCreatedEmail({
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
    <EmailLayout preview={`Your support ticket ${ticketNumber} has been received`} productName={productName}>
      <Text style={emailStyles.heading}>We received your support request</Text>
      <Text style={emailStyles.paragraph}>
        Hi {userEmail}, your ticket <strong style={{ color: "#171717" }}>{ticketNumber}</strong> has been submitted
        successfully.
      </Text>
      <Section style={{ background: "#f5f5f5", borderRadius: "8px", padding: "16px", margin: "16px 0" }}>
        <Text style={{ ...emailStyles.paragraph, margin: 0 }}>Subject: {subject}</Text>
      </Section>
      <Text style={emailStyles.paragraph}>
        Our support team will review your request and respond as soon as possible.
      </Text>
      <Text style={emailStyles.muted}>You can view your ticket status in Settings → Support.</Text>
    </EmailLayout>
  );
}

export async function supportTicketCreatedTemplate({
  userEmail,
  ticketNumber,
  subject,
}: {
  userEmail: string;
  ticketNumber: string;
  subject: string;
}) {
  const html = await renderEmailTemplate(
    createElement(SupportTicketCreatedEmail, { userEmail, ticketNumber, subject, productName: PRODUCT_NAME }),
  );

  const text = `We received your support request

Ticket: ${ticketNumber}
Subject: ${subject}

Our support team will review your request and get back to you soon.

You can view your ticket status in Settings → Support.`;

  return { html, text };
}
