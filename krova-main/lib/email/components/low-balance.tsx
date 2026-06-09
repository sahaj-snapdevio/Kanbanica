import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface LowBalanceEmailProps {
  currentBalance: string;
  /** Free plans get the "Choose a Plan" CTA; paid plans get "Add Credits". */
  isFreePlan: boolean;
  logoUrl?: string | null;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  userName: string;
}

export function LowBalanceEmail({
  userName,
  spaceName,
  currentBalance,
  spaceUrl,
  isFreePlan,
  productName = "Krova",
  logoUrl,
}: LowBalanceEmailProps) {
  const ctaLabel = isFreePlan ? "Choose a Plan" : "Add Credits";
  const ctaHref = isFreePlan
    ? `${spaceUrl}?plan=open`
    : `${spaceUrl}?topup=open`;

  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Low balance warning for ${spaceName}: $${currentBalance} remaining`}
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
          Low Balance Warning
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        The credit balance for{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong> is running
        low. Add credits before your balance is depleted.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Current Balance</Text>
          <Text style={{ ...emailStyles.cardValue, color: "#f97316" }}>
            ${currentBalance}
          </Text>
        </div>
      </Section>

      <Text style={emailStyles.paragraph}>
        When the balance reaches $0, all running Cubes will be automatically put
        to sleep.
      </Text>

      <Section style={{ margin: "24px 0" }}>
        <Button href={ctaHref} style={emailStyles.button}>
          {ctaLabel}
        </Button>
      </Section>
    </EmailLayout>
  );
}
