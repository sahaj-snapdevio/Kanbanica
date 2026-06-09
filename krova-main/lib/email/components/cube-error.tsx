import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface CubeErrorEmailProps {
  cubeId: string;
  cubeName: string;
  cubeUrl: string;
  logoUrl?: string | null;
  productName?: string;
  reason: string;
  spaceName: string;
  userName: string;
}

export function CubeErrorEmail({
  userName,
  spaceName,
  cubeName,
  cubeId,
  reason,
  cubeUrl,
  productName = "Krova",
  logoUrl,
}: CubeErrorEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Cube "${cubeName}" failed to start`}
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
          Provisioning Failed
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        Your Cube <strong style={{ color: "#252525" }}>{cubeName}</strong> in
        the <strong style={{ color: "#252525" }}>{spaceName}</strong> workspace
        failed to start.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Cube Name</Text>
          <Text style={emailStyles.cardValue}>{cubeName}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Cube ID</Text>
          <Text
            style={{
              ...emailStyles.cardValue,
              fontSize: "13px",
              color: "#6e6e6e",
            }}
          >
            {cubeId}
          </Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Error</Text>
          <Text style={{ ...emailStyles.cardValue, color: "#dc2626" }}>
            {reason}
          </Text>
        </div>
      </Section>

      <Text style={emailStyles.paragraph}>
        You can delete this Cube and create a new one, or contact support if the
        issue persists.
      </Text>

      <Section style={{ margin: "24px 0" }}>
        <Button href={cubeUrl} style={emailStyles.button}>
          View Cube
        </Button>
      </Section>
    </EmailLayout>
  );
}
