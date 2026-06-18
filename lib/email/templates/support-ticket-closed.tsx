import { createElement } from "react";
import { Text } from "react-email";
import { PRODUCT_NAME } from "@/config/platform";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";
import { renderEmailTemplate } from "@/lib/email/renderer";

function SupportTicketClosedEmail({
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
    <EmailLayout preview={`Your ticket ${ticketNumber} has been closed`} productName={productName}>
      <Text style={emailStyles.heading}>Your ticket has been closed</Text>
      <Text style={emailStyles.paragraph}>
        Hi {userEmail}, your support ticket{" "}
        <strong style={{ color: "#171717" }}>{ticketNumber}</strong> ({subject}) has been automatically closed due to 14
        days of inactivity.
      </Text>
      <Text style={emailStyles.paragraph}>
        If you still need help, you can reply to this ticket to reopen it, or create a new ticket.
      </Text>
      <Text style={emailStyles.muted}>Manage your tickets in Settings → Support.</Text>
    </EmailLayout>
  );
}

export async function supportTicketClosedTemplate({
  userEmail,
  ticketNumber,
  subject,
}: {
  userEmail: string;
  ticketNumber: string;
  subject: string;
}) {
  const html = await renderEmailTemplate(
    createElement(SupportTicketClosedEmail, { userEmail, ticketNumber, subject, productName: PRODUCT_NAME }),
  );

  const text = `Your ticket has been closed

Ticket: ${ticketNumber}
Subject: ${subject}

Your ticket was automatically closed due to 14 days of inactivity.

If you still need help, reply to this ticket to reopen it, or submit a new request.`;

  return { html, text };
}
