import { Button, Link, Section, Text } from "react-email";
import { PRODUCT_NAME } from "@/config/platform";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export function EmailChangeEmail({
  newEmail,
  verifyUrl,
  productName = PRODUCT_NAME,
}: {
  newEmail: string;
  verifyUrl: string;
  productName?: string;
}) {
  return (
    <EmailLayout
      preview={`Confirm your new email address for ${productName}`}
      productName={productName}
    >
      <Text style={emailStyles.heading}>Confirm your new email</Text>
      <Text style={emailStyles.paragraph}>
        You requested to change your {productName} account email to{" "}
        <strong style={{ color: "#174D38" }}>{newEmail}</strong>. Click the
        button below to confirm. Your old email stays active until you confirm.
      </Text>
      <Section style={{ margin: "24px 0" }}>
        <Button href={verifyUrl} style={emailStyles.button}>
          Confirm new email
        </Button>
      </Section>
      <Text style={emailStyles.muted}>
        This link expires in 1 hour. If you did not request this change, you can
        safely ignore this email — your account is unchanged.
      </Text>
      <Text style={emailStyles.fallbackLink}>
        If the button does not work, paste this link into your browser:{" "}
        <Link href={verifyUrl} style={emailStyles.link}>
          {verifyUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
