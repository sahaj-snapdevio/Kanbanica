import type { ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "react-email";
import { PRODUCT_NAME } from "@/config/platform";

export const emailStyles = {
  body: {
    backgroundColor: "#f6f4ef",
    color: "#171717",
    fontFamily:
      'Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  button: {
    backgroundColor: "#111111",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 700,
    padding: "12px 18px",
    textDecoration: "none",
  },
  container: {
    backgroundColor: "#ffffff",
    border: "1px solid #ded8cc",
    borderRadius: "10px",
    margin: "40px auto",
    maxWidth: "560px",
    padding: "32px",
  },
  fallbackLink: {
    color: "#5c554a",
    fontSize: "12px",
    lineHeight: "20px",
  },
  heading: {
    fontSize: "24px",
    fontWeight: 800,
    letterSpacing: "0",
    lineHeight: "32px",
    margin: "0 0 16px",
  },
  link: { color: "#006d5b" },
  muted: {
    color: "#6b665d",
    fontSize: "13px",
    lineHeight: "22px",
  },
  paragraph: {
    color: "#2c2a26",
    fontSize: "15px",
    lineHeight: "24px",
  },
};

export function EmailLayout({
  children,
  logoUrl,
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
          <Section style={{ marginBottom: "24px" }}>
            {logoUrl ? (
              <Img alt={productName} height="32" src={logoUrl} />
            ) : (
              <Text style={{ fontWeight: 900, letterSpacing: "0" }}>
                {productName}
              </Text>
            )}
          </Section>
          {children}
        </Container>
      </Body>
    </Html>
  );
}
