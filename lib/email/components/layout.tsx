import type { ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "react-email";
import { LOGO_PATH, PRODUCT_NAME } from "@/config/platform";
import { env } from "@/lib/env";

// Absolute URL to the same logo the landing page uses. Emails can't resolve
// relative asset paths, so the public asset must be referenced absolutely.
const DEFAULT_LOGO_URL = `${env.NEXT_PUBLIC_APP_URL}${LOGO_PATH}`;

export const emailStyles = {
  body: {
    backgroundColor: "#F9FAFB",
    color: "#111827",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  button: {
    backgroundColor: "#174D38",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 600,
    padding: "12px 24px",
    textDecoration: "none",
  },
  container: {
    backgroundColor: "#ffffff",
    border: "1px solid #E5E7EB",
    borderRadius: "8px",
    margin: "40px auto",
    maxWidth: "560px",
    padding: "40px 32px",
  },
  fallbackLink: {
    color: "#9CA3AF",
    fontSize: "12px",
    lineHeight: "20px",
  },
  heading: {
    color: "#111827",
    fontSize: "24px",
    fontWeight: 700,
    letterSpacing: "0",
    lineHeight: "32px",
    margin: "0 0 12px",
  },
  link: { color: "#174D38" },
  muted: {
    color: "#6B7280",
    fontSize: "13px",
    lineHeight: "22px",
  },
  paragraph: {
    color: "#374151",
    fontSize: "15px",
    lineHeight: "24px",
  },
};

export function EmailLayout({
  children,
  logoUrl = DEFAULT_LOGO_URL,
  preview,
  productName = PRODUCT_NAME,
}: {
  children: ReactNode;
  logoUrl?: string | null;
  preview: string;
  productName?: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={emailStyles.body}>
        <Container style={emailStyles.container}>
          <Section style={{ marginBottom: "32px" }}>
            {logoUrl ? (
              <Img alt={productName} height="32" src={logoUrl} />
            ) : (
              <Text
                style={{
                  color: "#174D38",
                  fontSize: "20px",
                  fontWeight: 700,
                  letterSpacing: "-0.5px",
                  margin: "0",
                }}
              >
                {productName}
              </Text>
            )}
          </Section>
          {children}
          <Hr style={{ borderColor: "#E5E7EB", margin: "32px 0 16px" }} />
          <Text
            style={{
              color: "#9CA3AF",
              fontSize: "12px",
              lineHeight: "18px",
              margin: "0",
            }}
          >
            {productName} · You received this email because an action was
            requested on your account.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
