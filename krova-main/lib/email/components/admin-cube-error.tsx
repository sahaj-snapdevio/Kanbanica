import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface AdminCubeErrorManualAction {
  destroyCommand: string;
  diskSize: string;
  hostPath: string;
  inspectCommand: string;
  processState: string;
  serverHostname: string;
}

export interface AdminCubeErrorEmailProps {
  cubeId: string;
  cubeName: string;
  cubeUrl: string;
  logoUrl?: string | null;
  manualAction?: AdminCubeErrorManualAction;
  productName?: string;
  reason: string;
  serverId: string;
  spaceId: string;
}

export function AdminCubeErrorEmail({
  cubeName,
  cubeId,
  spaceId,
  serverId,
  reason,
  cubeUrl,
  manualAction,
  productName,
  logoUrl,
}: AdminCubeErrorEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Cube error: ${cubeName}`}
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
          Cube Error Alert
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Cube Error</Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Cube</Text>
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
          <Text style={emailStyles.cardLabel}>Space ID</Text>
          <Text
            style={{
              ...emailStyles.cardValue,
              fontSize: "13px",
              color: "#6e6e6e",
            }}
          >
            {spaceId}
          </Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Server ID</Text>
          <Text
            style={{
              ...emailStyles.cardValue,
              fontSize: "13px",
              color: "#6e6e6e",
            }}
          >
            {serverId}
          </Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Reason</Text>
          <Text style={{ ...emailStyles.cardValue, color: "#dc2626" }}>
            {reason}
          </Text>
        </div>
      </Section>

      {manualAction ? (
        <Section
          style={{
            ...emailStyles.card,
            borderLeft: "3px solid #2563eb",
            margin: "24px 0 0 0",
          }}
        >
          <Text
            style={{
              ...emailStyles.badge,
              backgroundColor: "#eff6ff",
              border: "1px solid #bfdbfe",
              color: "#1d4ed8",
              margin: "0 0 12px 0",
            }}
          >
            Manual action required — nothing destroyed automatically
          </Text>

          <div style={emailStyles.cardRow}>
            <Text style={emailStyles.cardLabel}>Server</Text>
            <Text style={emailStyles.cardValue}>
              {manualAction.serverHostname}
            </Text>
          </div>
          <div style={emailStyles.cardRow}>
            <Text style={emailStyles.cardLabel}>Host path</Text>
            <Text
              style={{
                ...emailStyles.cardValue,
                fontFamily: "ui-monospace, monospace",
                fontSize: "13px",
              }}
            >
              {manualAction.hostPath}
            </Text>
          </div>
          <div style={emailStyles.cardRow}>
            <Text style={emailStyles.cardLabel}>Disk size</Text>
            <Text style={emailStyles.cardValue}>{manualAction.diskSize}</Text>
          </div>
          <div style={emailStyles.cardRowLast}>
            <Text style={emailStyles.cardLabel}>Process</Text>
            <Text style={emailStyles.cardValue}>
              {manualAction.processState}
            </Text>
          </div>

          <Text
            style={{
              ...emailStyles.cardLabel,
              margin: "16px 0 4px 0",
            }}
          >
            Inspect (read-only):
          </Text>
          <Text
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "13px",
              backgroundColor: "#f3f4f6",
              padding: "8px 10px",
              borderRadius: "4px",
              margin: "0 0 12px 0",
            }}
          >
            {manualAction.inspectCommand}
          </Text>

          <Text
            style={{
              ...emailStyles.cardLabel,
              margin: "0 0 4px 0",
            }}
          >
            Destroy after manual confirmation:
          </Text>
          <Text
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "13px",
              backgroundColor: "#f3f4f6",
              padding: "8px 10px",
              borderRadius: "4px",
              margin: 0,
            }}
          >
            {manualAction.destroyCommand}
          </Text>
        </Section>
      ) : null}

      <Section style={{ margin: "24px 0" }}>
        <Button href={cubeUrl} style={emailStyles.button}>
          View in Orbit
        </Button>
      </Section>
    </EmailLayout>
  );
}
