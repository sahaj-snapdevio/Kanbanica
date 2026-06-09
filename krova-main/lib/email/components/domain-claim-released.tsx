import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface DomainClaimReleasedEmailProps {
  domain: string;
  logoUrl?: string | null;
  productName?: string;
  settingsUrl: string;
  spaceName: string;
  userName: string;
}

export function DomainClaimReleasedEmail({
  userName,
  spaceName,
  domain,
  settingsUrl,
  productName = "Krova",
  logoUrl,
}: DomainClaimReleasedEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Domain lock released for ${domain}`}
      productName={productName}
    >
      <Section
        style={{
          ...emailStyles.card,
          borderLeft: "3px solid #f59e0b",
          margin: "0 0 24px 0",
        }}
      >
        <Text
          style={{
            ...emailStyles.badge,
            backgroundColor: "#fffbeb",
            border: "1px solid #fde68a",
            color: "#b45309",
            margin: "0 0 4px 0",
          }}
        >
          Domain Lock Released
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        The ownership-verification TXT record for{" "}
        <strong style={{ color: "#252525" }}>{domain}</strong> could no longer
        be found, so we released{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong>'s lock on it.
        Other spaces can now claim this domain.
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Domain</Text>
          <Text style={{ ...emailStyles.cardValue, fontFamily: "monospace" }}>
            {domain}
          </Text>
        </div>
      </Section>

      <Text style={emailStyles.paragraph}>
        If you still own this domain, re-add the TXT record and verify it again
        to restore the lock.
      </Text>

      <Section style={{ margin: "24px 0" }}>
        <Button href={settingsUrl} style={emailStyles.button}>
          Manage Domains
        </Button>
      </Section>
    </EmailLayout>
  );
}
