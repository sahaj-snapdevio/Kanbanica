import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface WebhookAutoDisabledEmailProps {
  failures: number;
  logoUrl?: string | null;
  productName?: string;
  settingsUrl: string;
  spaceName: string;
  url: string;
  userName: string;
}

export function WebhookAutoDisabledEmail({
  userName,
  spaceName,
  url,
  failures,
  settingsUrl,
  productName = "Krova",
  logoUrl,
}: WebhookAutoDisabledEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Webhook disabled for ${spaceName} after ${failures} failures`}
      productName={productName}
    >
      <Section
        style={{
          ...emailStyles.card,
          borderLeft: "3px solid #ef4444",
          margin: "0 0 24px 0",
        }}
      >
        <Text
          style={{
            ...emailStyles.badge,
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            margin: "0 0 4px 0",
          }}
        >
          Webhook Disabled
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        We auto-disabled an outbound webhook for{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong> after{" "}
        {failures} consecutive failed deliveries. Future events will not be
        delivered to this endpoint until you fix the receiver and re-enable it
        from your dashboard.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Endpoint</Text>
          <Text style={{ ...emailStyles.cardValue, fontFamily: "monospace" }}>
            {url}
          </Text>
        </div>
      </Section>

      <Section style={{ margin: "24px 0" }}>
        <Button href={settingsUrl} style={emailStyles.button}>
          Manage Webhooks
        </Button>
      </Section>
    </EmailLayout>
  );
}
