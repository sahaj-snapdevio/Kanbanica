import { Button, Link, Section, Text } from "react-email";
import { PRODUCT_NAME } from "@/config/platform";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export function WorkspaceInviteEmail({
  inviterName,
  workspaceName,
  inviteUrl,
  productName = PRODUCT_NAME,
}: {
  inviterName: string;
  workspaceName: string;
  inviteUrl: string;
  productName?: string;
}) {
  return (
    <EmailLayout
      preview={`${inviterName} invited you to ${workspaceName} on ${productName}`}
      productName={productName}
    >
      <Text style={emailStyles.heading}>You&rsquo;re invited!</Text>
      <Text style={emailStyles.paragraph}>
        <strong style={{ color: "#111827" }}>{inviterName}</strong> has invited
        you to join the <strong style={{ color: "#111827" }}>{workspaceName}</strong>{" "}
        workspace on {productName}.
      </Text>
      <Section style={{ margin: "24px 0" }}>
        <Button href={inviteUrl} style={emailStyles.button}>
          Accept Invitation
        </Button>
      </Section>
      <Text style={emailStyles.muted}>
        This invitation expires in 7 days. If you did not expect this invite,
        you can ignore this email.
      </Text>
      <Text style={emailStyles.fallbackLink}>
        If the button does not work, paste this link into your browser:{" "}
        <Link href={inviteUrl} style={emailStyles.link}>
          {inviteUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
