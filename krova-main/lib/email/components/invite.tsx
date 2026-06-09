import { Button, Link, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface InviteEmailProps {
  expiryStr: string;
  invitedByName: string;
  inviteUrl: string;
  logoUrl?: string | null;
  permissionLabels: Record<string, string>;
  permissions: string[];
  productName?: string;
  spaceName: string;
}

export function InviteEmail({
  invitedByName,
  spaceName,
  inviteUrl,
  permissions,
  expiryStr,
  permissionLabels,
  productName = "Krova",
  logoUrl,
}: InviteEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`${invitedByName} invited you to ${spaceName}`}
      productName={productName}
    >
      <Text style={emailStyles.heading}>You&apos;ve been invited</Text>

      <Text style={emailStyles.paragraph}>
        <strong style={{ color: "#252525" }}>{invitedByName}</strong> has
        invited you to join the{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong> workspace on{" "}
        {productName}.
      </Text>

      {permissions.length > 0 && (
        <Section style={emailStyles.card}>
          <Text style={emailStyles.cardLabel}>Permissions</Text>
          <Text style={{ ...emailStyles.cardValue, marginTop: "8px" }}>
            {permissions.map((p, i) => (
              <span key={p}>
                <span
                  style={{
                    ...emailStyles.badge,
                    backgroundColor: emailStyles.brandTealTintBg,
                    border: `1px solid ${emailStyles.brandTealTintBorder}`,
                    color: emailStyles.brandTeal,
                  }}
                >
                  {permissionLabels[p] ?? p}
                </span>
                {i < permissions.length - 1 && " "}
              </span>
            ))}
          </Text>
        </Section>
      )}

      <Section style={{ margin: "24px 0" }}>
        <Button href={inviteUrl} style={emailStyles.button}>
          Accept Invitation
        </Button>
      </Section>

      <Text style={emailStyles.muted}>
        This invitation expires on {expiryStr}.
      </Text>

      <Text style={emailStyles.fallbackLink}>
        If the button doesn&apos;t work, copy and paste this link:{" "}
        <Link href={inviteUrl} style={emailStyles.link}>
          {inviteUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
