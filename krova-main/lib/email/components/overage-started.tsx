import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface OverageStartedEmailProps {
  cap: string;
  logoUrl?: string | null;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  thisPeriodOverage: string;
  userName: string;
}

export function OverageStartedEmail({
  userName,
  spaceName,
  thisPeriodOverage,
  cap,
  spaceUrl,
  productName = "Krova",
  logoUrl,
}: OverageStartedEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Postpaid overage started for ${spaceName} — $${thisPeriodOverage} of $${cap} this period`}
      productName={productName}
    >
      <Section
        style={{
          ...emailStyles.card,
          borderLeft: "3px solid #2563eb",
          margin: "0 0 24px 0",
        }}
      >
        <Text
          style={{
            ...emailStyles.badge,
            backgroundColor: "#eff6ff",
            border: "1px solid #bfdbfe",
            color: "#1d4ed8",
            margin: "0 0 4px 0",
          }}
        >
          Overage Started
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        You&apos;ve started using postpaid overage for{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong>. Your Cubes
        keep running; the extra usage is billed on your next invoice.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>This Period</Text>
          <Text style={emailStyles.cardValue}>
            ${thisPeriodOverage} of ${cap}
          </Text>
        </div>
      </Section>

      <Section style={{ margin: "24px 0" }}>
        <Button href={spaceUrl} style={emailStyles.button}>
          View Billing
        </Button>
      </Section>
    </EmailLayout>
  );
}
