import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface SnapshotExportReadyEmailProps {
  cubeName: string;
  downloadUrl: string;
  expiresAtLabel: string;
  logoUrl?: string | null;
  productName?: string;
  sizeMb: string;
  snapshotName: string;
  spaceName: string;
}

export function SnapshotExportReadyEmail({
  userName,
  spaceName,
  snapshotName,
  cubeName,
  downloadUrl,
  expiresAtLabel,
  sizeMb,
  productName = "Krova",
  logoUrl,
}: SnapshotExportReadyEmailProps & { userName: string }) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Your snapshot "${snapshotName}" is ready to download`}
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
          Snapshot ready
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        Your snapshot{" "}
        <strong style={{ color: "#252525" }}>{snapshotName}</strong> of cube{" "}
        <strong style={{ color: "#252525" }}>{cubeName}</strong> in{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong> has been
        packaged as a portable <code>.cube</code> archive and is ready to
        download.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Snapshot</Text>
          <Text style={emailStyles.cardValue}>{snapshotName}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Archive size</Text>
          <Text style={emailStyles.cardValue}>{sizeMb} MB</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Link expires</Text>
          <Text style={emailStyles.cardValue}>{expiresAtLabel}</Text>
        </div>
      </Section>

      <Section style={{ margin: "24px 0" }}>
        <Button href={downloadUrl} style={emailStyles.button}>
          Download snapshot
        </Button>
      </Section>

      <Text style={emailStyles.muted}>
        This link is valid for 24 hours. After it expires, the archive is
        deleted from our servers — request a new export from the dashboard if
        you need it again. You can re-import the <code>.cube</code> as a new
        cube via the &quot;Import Cube&quot; flow in any space.
      </Text>
    </EmailLayout>
  );
}
