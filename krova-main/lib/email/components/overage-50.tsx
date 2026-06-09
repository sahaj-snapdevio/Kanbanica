import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface Overage50EmailProps {
  cap: string;
  logoUrl?: string | null;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  thisPeriodOverage: string;
  userName: string;
}

export function Overage50Email({
  userName,
  spaceName,
  thisPeriodOverage,
  cap,
  spaceUrl,
  productName = "Krova",
  logoUrl,
}: Overage50EmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Overage at 50% for ${spaceName} — $${thisPeriodOverage} of $${cap} used`}
      productName={productName}
    >
      <Section
        style={{
          ...emailStyles.card,
          borderLeft: "3px solid #eab308",
          margin: "0 0 24px 0",
        }}
      >
        <Text
          style={{
            ...emailStyles.badge,
            backgroundColor: "#fefce8",
            border: "1px solid #fde68a",
            color: "#a16207",
            margin: "0 0 4px 0",
          }}
        >
          Overage at 50%
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        You&apos;ve used half your ${cap} overage budget for{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong> — $
        {thisPeriodOverage} so far. Adjust your cap or top up to stay ahead.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>This Period</Text>
          <Text style={{ ...emailStyles.cardValue, color: "#a16207" }}>
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
