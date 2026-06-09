import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface CubeTransferredEmailProps {
  cubeId: string;
  cubeName: string;
  cubeUrl: string;
  logoUrl?: string | null;
  outcome: "success" | "failure";
  productName?: string;
  spaceName: string;
  userName: string;
}

export function CubeTransferredEmail({
  userName,
  spaceName,
  cubeName,
  cubeId,
  cubeUrl,
  outcome,
  productName = "Krova",
  logoUrl,
}: CubeTransferredEmailProps) {
  const isSuccess = outcome === "success";
  const preview = isSuccess
    ? `Cube "${cubeName}" was migrated to a new server`
    : `Cube "${cubeName}" migration did not complete`;

  const badgeLabel = isSuccess ? "Migration Complete" : "Migration Failed";
  const badgeBg = isSuccess ? emailStyles.brandTealTintBg : "#fef2f2";
  const badgeBorder = isSuccess ? emailStyles.brandTealTintBorder : "#fecaca";
  const badgeColor = isSuccess ? emailStyles.brandTealDark : "#b91c1c";
  const accent = isSuccess ? emailStyles.brandTeal : "#dc2626";

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
            backgroundColor: badgeBg,
            border: `1px solid ${badgeBorder}`,
            color: badgeColor,
            margin: "0 0 4px 0",
          }}
        >
          {badgeLabel}
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      {isSuccess ? (
        <>
          <Text style={emailStyles.paragraph}>
            Your Cube <strong style={{ color: "#252525" }}>{cubeName}</strong>{" "}
            in the <strong style={{ color: "#252525" }}>{spaceName}</strong>{" "}
            workspace was migrated to a new server.
          </Text>
          <Text style={emailStyles.paragraph}>
            No action is needed on your end — your custom domains, TCP port
            forwards, and SSH access continue to work as before.
          </Text>
        </>
      ) : (
        <>
          <Text style={emailStyles.paragraph}>
            We tried to migrate your Cube{" "}
            <strong style={{ color: "#252525" }}>{cubeName}</strong> in the{" "}
            <strong style={{ color: "#252525" }}>{spaceName}</strong> workspace
            to a new server, but the migration did not complete.
          </Text>
          <Text style={emailStyles.paragraph}>
            Your Cube remains on its original server and is unaffected. Our
            engineering team has been notified and will look into it.
          </Text>
        </>
      )}

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
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
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
