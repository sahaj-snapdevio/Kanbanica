import { Section, Text } from "react-email";

import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface AdminSpaceDeletedEmailProps {
  backupCount: number;
  backupTotalGb: number;
  creditBalanceUsd: string;
  cubeCount: number;
  cubeNames: string[];
  domainCount: number;
  domainHostnames: string[];
  initiatorLabel: string;
  logoUrl?: string | null;
  memberCount: number;
  memberEmails: string[];
  orphanUsersDeleted: string[];
  ownerLabel: string;
  planLabel: string;
  productName?: string;
  snapshotCount: number;
  snapshotTotalGb: number;
  spaceCreatedAt: string;
  spaceId: string;
  spaceName: string;
  subscriptionStatus: string | null;
  totalDiskGb: number;
  totalRamGb: number;
  totalVcpus: number;
}

const summarizeList = (items: string[], cap = 25): string => {
  if (items.length === 0) {
    return "None";
  }
  if (items.length <= cap) {
    return items.join(", ");
  }
  const head = items.slice(0, cap).join(", ");
  return `${head} (+${items.length - cap} more)`;
};

export function AdminSpaceDeletedEmail({
  spaceName,
  spaceId,
  ownerLabel,
  planLabel,
  subscriptionStatus,
  spaceCreatedAt,
  creditBalanceUsd,
  cubeCount,
  totalVcpus,
  totalRamGb,
  totalDiskGb,
  cubeNames,
  snapshotCount,
  snapshotTotalGb,
  backupCount,
  backupTotalGb,
  domainCount,
  domainHostnames,
  memberCount,
  memberEmails,
  orphanUsersDeleted,
  initiatorLabel,
  productName,
  logoUrl,
}: AdminSpaceDeletedEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Space deleted: ${spaceName}`}
      productName={productName}
    >
      <Section
        style={{
          ...emailStyles.card,
          borderLeft: "3px solid #6e6e6e",
          margin: "0 0 24px 0",
        }}
      >
        <Text
          style={{
            ...emailStyles.badge,
            backgroundColor: "#f4f4f5",
            border: "1px solid #e4e4e7",
            color: "#3f3f46",
            margin: "0 0 4px 0",
          }}
        >
          Space Deleted
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Space removed</Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Space</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
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
          <Text style={emailStyles.cardLabel}>Owner</Text>
          <Text style={emailStyles.cardValue}>{ownerLabel}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Plan</Text>
          <Text style={emailStyles.cardValue}>{planLabel}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Subscription</Text>
          <Text style={emailStyles.cardValue}>{subscriptionStatus ?? "—"}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Created</Text>
          <Text style={emailStyles.cardValue}>{spaceCreatedAt}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Credit forfeited</Text>
          <Text style={emailStyles.cardValue}>${creditBalanceUsd}</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Deleted by</Text>
          <Text style={emailStyles.cardValue}>{initiatorLabel}</Text>
        </div>
      </Section>

      <Text style={emailStyles.heading}>Cubes ({cubeCount})</Text>
      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Total vCPUs</Text>
          <Text style={emailStyles.cardValue}>{totalVcpus}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Total RAM</Text>
          <Text style={emailStyles.cardValue}>{totalRamGb} GB</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Total disk</Text>
          <Text style={emailStyles.cardValue}>{totalDiskGb} GB</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Names</Text>
          <Text style={emailStyles.cardValue}>{summarizeList(cubeNames)}</Text>
        </div>
      </Section>

      <Text style={emailStyles.heading}>Storage</Text>
      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Snapshots</Text>
          <Text style={emailStyles.cardValue}>
            {snapshotCount} ({snapshotTotalGb} GB)
          </Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Backups</Text>
          <Text style={emailStyles.cardValue}>
            {backupCount} ({backupTotalGb} GB)
          </Text>
        </div>
      </Section>

      <Text style={emailStyles.heading}>Domains ({domainCount})</Text>
      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Hostnames</Text>
          <Text style={emailStyles.cardValue}>
            {summarizeList(domainHostnames)}
          </Text>
        </div>
      </Section>

      <Text style={emailStyles.heading}>Members ({memberCount})</Text>
      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Affected</Text>
          <Text style={emailStyles.cardValue}>
            {summarizeList(memberEmails)}
          </Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Orphan accounts deleted</Text>
          <Text style={emailStyles.cardValue}>
            {summarizeList(orphanUsersDeleted)}
          </Text>
        </div>
      </Section>
    </EmailLayout>
  );
}
