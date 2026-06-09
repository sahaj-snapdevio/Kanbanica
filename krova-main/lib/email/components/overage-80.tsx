import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface Overage80EmailProps {
  cap: string;
  logoUrl?: string | null;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  thisPeriodOverage: string;
  userName: string;
}

export function Overage80Email({
  userName,
  spaceName,
  thisPeriodOverage,
  cap,
  spaceUrl,
  productName = "Krova",
  logoUrl,
}: Overage80EmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Overage at 80% for ${spaceName} — $${thisPeriodOverage} of $${cap} used`}
      productName={productName}
    >
      <Section
        style={{
          ...emailStyles.card,
          borderLeft: "3px solid #f97316",
          margin: "0 0 24px 0",
        }}
      >
        <Text
          style={{
            ...emailStyles.badge,
            backgroundColor: "#fff7ed",
            border: "1px solid #fed7aa",
            color: "#c2410c",
            margin: "0 0 4px 0",
          }}
        >
          Overage at 80%
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        You&apos;re nearing your overage cap for{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong> — $
        {thisPeriodOverage} of ${cap} used. If you hit the cap, your Cubes will
        be paused until the cap resets next period or you raise it.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>This Period</Text>
          <Text style={{ ...emailStyles.cardValue, color: "#c2410c" }}>
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
