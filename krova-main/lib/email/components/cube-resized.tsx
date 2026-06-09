import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface CubeResizedEmailProps {
  after: { vcpus: number; ramMb: number; diskLimitGb: number };
  before: { vcpus: number; ramMb: number; diskLimitGb: number };
  cubeId: string;
  cubeName: string;
  cubeUrl: string;
  isLive: boolean;
  logoUrl?: string | null;
  productName?: string;
  spaceName: string;
  userName: string;
}

function formatSpec(spec: {
  vcpus: number;
  ramMb: number;
  diskLimitGb: number;
}) {
  return `${spec.vcpus} vCPU, ${spec.ramMb} MB RAM, ${spec.diskLimitGb} GB disk`;
}

export function CubeResizedEmail({
  userName,
  spaceName,
  cubeName,
  cubeId,
  cubeUrl,
  before,
  after,
  isLive,
  productName = "Krova",
  logoUrl,
}: CubeResizedEmailProps) {
  const preview = `Cube "${cubeName}" was resized`;
  const accent = emailStyles.brandTeal;

  return (
    <EmailLayout logoUrl={logoUrl} preview={preview} productName={productName}>
      <Section
        style={{
          ...emailStyles.card,
          borderLeft: `3px solid ${accent}`,
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
          Resize Complete
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        Your Cube <strong style={{ color: "#252525" }}>{cubeName}</strong> in
        the <strong style={{ color: "#252525" }}>{spaceName}</strong> workspace
        has been resized {isLive ? "with no downtime" : "with a brief restart"}.
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
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Previous</Text>
          <Text style={emailStyles.cardValue}>{formatSpec(before)}</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>New</Text>
          <Text style={emailStyles.cardValue}>{formatSpec(after)}</Text>
        </div>
      </Section>

      <Section style={{ margin: "24px 0" }}>
        <Button href={cubeUrl} style={emailStyles.button}>
          View Cube
        </Button>
      </Section>
    </EmailLayout>
  );
}
