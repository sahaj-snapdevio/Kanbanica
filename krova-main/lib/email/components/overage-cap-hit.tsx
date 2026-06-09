import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface OverageCapHitEmailProps {
  cap: string;
  logoUrl?: string | null;
  pausedCubeCount: number;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  userName: string;
}

export function OverageCapHitEmail({
  userName,
  spaceName,
  cap,
  pausedCubeCount,
  spaceUrl,
  productName = "Krova",
  logoUrl,
}: OverageCapHitEmailProps) {
  const cubeWord = pausedCubeCount === 1 ? "Cube" : "Cubes";

  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Overage cap reached for ${spaceName} — Cubes paused`}
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
          Cap Reached — Cubes Paused
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        Your ${cap} overage cap for{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong> has been
        reached. {pausedCubeCount} {cubeWord}{" "}
        {pausedCubeCount === 1 ? "has" : "have"} been automatically put to
        sleep. Raise your cap, top up, or wait for next month&apos;s period to
        start.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Sleeping Cubes</Text>
          <Text style={{ ...emailStyles.cardValue, color: "#dc2626" }}>
            {pausedCubeCount}
          </Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Cap</Text>
          <Text style={{ ...emailStyles.cardValue, color: "#dc2626" }}>
            ${cap}
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
