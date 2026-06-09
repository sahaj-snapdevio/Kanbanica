import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface OveragePastDueEmailProps {
  logoUrl?: string | null;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  userName: string;
}

export function OveragePastDueEmail({
  userName,
  spaceName,
  spaceUrl,
  productName = "Krova",
  logoUrl,
}: OveragePastDueEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Overage paused for ${spaceName} — card payment failed`}
      productName={productName}
    >
      <Section
        style={{
          ...emailStyles.card,
          borderLeft: "3px solid #dc2626",
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
          Overage Paused — Payment Failed
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        Card payment failed for{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong> — overage is
        paused until your subscription returns to active. Cubes will sleep if
        your prepaid credit runs out.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
      </Section>

      <Section style={{ margin: "24px 0" }}>
        <Button href={spaceUrl} style={emailStyles.button}>
          Update Payment Method
        </Button>
      </Section>
    </EmailLayout>
  );
}
