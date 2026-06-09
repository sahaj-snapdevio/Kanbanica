import { Button, Link, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface MagicLinkEmailProps {
  email: string;
  logoUrl?: string | null;
  magicLinkUrl: string;
  productName?: string;
}

export function MagicLinkEmail({
  email,
  magicLinkUrl,
  productName = "Krova",
  logoUrl,
}: MagicLinkEmailProps) {
  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={`Sign in to ${productName}`}
      productName={productName}
    >
      <Text style={emailStyles.heading}>Sign in to {productName}</Text>

      <Text style={emailStyles.paragraph}>
        Use the button below to sign in as{" "}
        <strong style={{ color: "#252525" }}>{email}</strong>.
      </Text>

      <Section style={{ margin: "24px 0" }}>
        <Button href={magicLinkUrl} style={emailStyles.button}>
          Sign In
        </Button>
      </Section>

      <Text style={emailStyles.muted}>
        This link expires in 5 minutes and can only be used once. If you
        don&apos;t see this email, please check your spam or junk folder.
      </Text>

      <Text style={emailStyles.fallbackLink}>
        If the button doesn&apos;t work, copy and paste this link into your
        browser:{" "}
        <Link href={magicLinkUrl} style={emailStyles.link}>
          {magicLinkUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
