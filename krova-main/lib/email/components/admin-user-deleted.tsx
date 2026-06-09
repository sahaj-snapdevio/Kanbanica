import { Section, Text } from "react-email";

import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface AdminUserDeletedEmailProps {
  accountCreatedAt: string;
  emailVerified: boolean;
  initiatorLabel: string;
  lastSignedInAt: string | null;
  logoUrl?: string | null;
  membershipsRemoved: { spaceId: string; spaceName: string }[];
  productName?: string;
  reason: string | null;
  role: string | null;
  userEmail: string;
  userId: string;
  userName: string;
}

export function AdminUserDeletedEmail({
  userEmail,
  userName,
  userId,
  accountCreatedAt,
  lastSignedInAt,
  role,
  emailVerified,
  membershipsRemoved,
  initiatorLabel,
  reason,
  productName,
  logoUrl,
}: AdminUserDeletedEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`User deleted: ${userEmail}`}
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
          User Deleted
        </Text>
      </Section>

      <Text style={emailStyles.heading}>User account removed</Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Email</Text>
          <Text style={emailStyles.cardValue}>{userEmail}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Name</Text>
          <Text style={emailStyles.cardValue}>{userName}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>User ID</Text>
          <Text
            style={{
              ...emailStyles.cardValue,
              fontSize: "13px",
              color: "#6e6e6e",
            }}
          >
            {userId}
          </Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Account age</Text>
          <Text style={emailStyles.cardValue}>{accountCreatedAt}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Last sign-in</Text>
          <Text style={emailStyles.cardValue}>{lastSignedInAt ?? "Never"}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Role</Text>
          <Text style={emailStyles.cardValue}>{role ?? "user"}</Text>
        </div>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Email verified</Text>
          <Text style={emailStyles.cardValue}>
            {emailVerified ? "Yes" : "No"}
          </Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Deleted by</Text>
          <Text style={emailStyles.cardValue}>{initiatorLabel}</Text>
        </div>
      </Section>

      <Text style={emailStyles.heading}>
        Memberships removed ({membershipsRemoved.length})
      </Text>
      {membershipsRemoved.length === 0 ? (
        <Section style={emailStyles.card}>
          <Text style={emailStyles.cardValue}>None</Text>
        </Section>
      ) : (
        <Section style={emailStyles.card}>
          {membershipsRemoved.map((m, i) => (
            <div
              key={m.spaceId}
              style={
                i === membershipsRemoved.length - 1
                  ? emailStyles.cardRowLast
                  : emailStyles.cardRow
              }
            >
              <Text style={emailStyles.cardLabel}>{m.spaceName}</Text>
              <Text
                style={{
                  ...emailStyles.cardValue,
                  fontSize: "13px",
                  color: "#6e6e6e",
                }}
              >
                {m.spaceId}
              </Text>
            </div>
          ))}
        </Section>
      )}

      {reason ? (
        <>
          <Text style={emailStyles.heading}>Reason</Text>
          <Section style={emailStyles.card}>
            <Text style={emailStyles.cardValue}>{reason}</Text>
          </Section>
        </>
      ) : null}
    </EmailLayout>
  );
}
