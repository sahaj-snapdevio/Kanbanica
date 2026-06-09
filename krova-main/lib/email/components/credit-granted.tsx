import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface CreditGrantedEmailProps {
  amount: string;
  logoUrl?: string | null;
  newBalance: string;
  note?: string;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  userName: string;
}

export function CreditGrantedEmail({
  userName,
  spaceName,
  amount,
  newBalance,
  note,
  spaceUrl,
  productName = "Krova",
  logoUrl,
}: CreditGrantedEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`$${amount} credits added to ${spaceName}`}
      productName={productName}
    >
      <Section
        style={{
          ...emailStyles.card,
          borderLeft: `3px solid ${emailStyles.brandTeal}`,
          margin: "0 0 24px 0",
        }}
      >
        <Text
          style={{
            ...emailStyles.badge,
            backgroundColor: emailStyles.brandTealTintBg,
            border: `1px solid ${emailStyles.brandTealTintBorder}`,
            color: emailStyles.brandTealDark,
            margin: "0 0 4px 0",
          }}
        >
          Credits Added
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        Credits have been added to your{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong> workspace.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Credits Added</Text>
          <Text
            style={{ ...emailStyles.cardValue, color: emailStyles.brandTeal }}
          >
            +${amount}
          </Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>New Balance</Text>
          <Text style={{ ...emailStyles.cardValue, fontWeight: 700 }}>
            ${newBalance}
          </Text>
        </div>
      </Section>

      {note && (
        <Text
          style={{
            ...emailStyles.paragraph,
            fontStyle: "italic",
            color: "#6e6e6e",
          }}
        >
          Note: {note}
        </Text>
      )}

      <Section style={{ margin: "24px 0" }}>
        <Button href={spaceUrl} style={emailStyles.button}>
          View Billing
        </Button>
      </Section>

      <Text style={emailStyles.muted}>
        Credits are consumed hourly based on vCPU and RAM usage.
      </Text>
    </EmailLayout>
  );
}
