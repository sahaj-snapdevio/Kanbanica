import { Button, Link, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface VerifyEmailEmailProps {
  logoUrl?: string | null;
  newEmail: string;
  productName?: string;
  verificationUrl: string;
}

export function VerifyEmailEmail({
  newEmail,
  verificationUrl,
  productName = "Krova",
  logoUrl,
}: VerifyEmailEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={"Verify your new email address"}
      productName={productName}
    >
      <Text style={emailStyles.heading}>Verify your email</Text>

      <Text style={emailStyles.paragraph}>
        Confirm that you want to change your email address to{" "}
        <strong style={{ color: "#252525" }}>{newEmail}</strong>.
      </Text>

      <Section style={{ margin: "24px 0" }}>
        <Button href={verificationUrl} style={emailStyles.button}>
          Verify Email
        </Button>
      </Section>

      <Text style={emailStyles.muted}>
        This link expires in 1 hour and can only be used once.
      </Text>

      <Text style={emailStyles.fallbackLink}>
        If the button doesn&apos;t work, copy and paste this link into your
        browser:{" "}
        <Link href={verificationUrl} style={emailStyles.link}>
          {verificationUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
