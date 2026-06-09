import type * as React from "react";
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
import { BRAND_COLORS } from "@/config/platform";

const fontFamily =
  "'JetBrains Mono', 'Roboto Mono', 'Fira Mono', 'Courier New', monospace";

const styles = {
  body: {
    backgroundColor: "#f5f5f5",
    fontFamily,
    margin: "0",
    padding: "0",
    WebkitTextSizeAdjust: "100%",
  },
  container: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e5e5",
    margin: "40px auto",
    maxWidth: "600px",
    width: "100%",
  },
  header: {
    backgroundColor: "#252525",
    padding: "26px 36px",
  },
  productName: {
    color: "#ffffff",
    fontFamily,
    fontSize: "20px",
    fontWeight: 700,
    letterSpacing: "0.3px",
    margin: "0",
  },
  logo: {
    height: "30px",
    width: "auto",
  },
  content: {
    padding: "36px",
  },
  hr: {
    borderColor: "#e5e5e5",
    borderTop: "1px solid #e5e5e5",
    margin: "0",
  },
  footer: {
    padding: "24px 36px",
  },
  footerText: {
    color: "#8a8a8a",
    fontFamily,
    fontSize: "12px",
    lineHeight: "20px",
    margin: "0",
  },
} as const;

export interface EmailLayoutProps {
  children: React.ReactNode;
  logoUrl?: string | null;
  preview: string;
  productName?: string;
}

export function EmailLayout({
  preview,
  productName = "Krova",
  logoUrl,
  children,
}: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <table cellPadding="0" cellSpacing="0" role="presentation">
              <tr>
                {logoUrl ? (
                  <td style={{ paddingRight: "12px", verticalAlign: "middle" }}>
                    <Img alt={productName} src={logoUrl} style={styles.logo} />
                  </td>
                ) : null}
                <td style={{ verticalAlign: "middle" }}>
                  <p style={styles.productName}>{productName}</p>
                </td>
              </tr>
            </table>
          </Section>

          <Section style={styles.content}>{children}</Section>

          <Hr style={styles.hr} />

          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              &copy; {new Date().getFullYear()} {productName}. All rights
              reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Shared style constants for use in templates
export const emailStyles = {
  fontFamily,
  // Brand accent (Krova teal) — single source of truth from config/platform.ts.
  // Templates reference these instead of hardcoding teal/emerald/green hexes,
  // so a positive/success state can never drift off-brand.
  brandTeal: BRAND_COLORS.teal,
  brandTealTintBg: BRAND_COLORS.tealTintBg,
  brandTealTintBorder: BRAND_COLORS.tealTintBorder,
  brandTealDark: BRAND_COLORS.tealDark,
  heading: {
    color: "#1a1a1a",
    fontFamily,
    fontSize: "21px",
    fontWeight: 700,
    lineHeight: "28px",
    margin: "0 0 18px 0",
  },
  paragraph: {
    color: "#404040",
    fontFamily,
    fontSize: "15px",
    lineHeight: "25px",
    margin: "0 0 16px 0",
  },
  button: {
    backgroundColor: BRAND_COLORS.teal,
    color: "#ffffff",
    display: "inline-block",
    fontFamily,
    fontSize: "15px",
    fontWeight: 600,
    lineHeight: "1",
    padding: "14px 28px",
    textAlign: "center" as const,
    textDecoration: "none",
  },
  link: {
    color: BRAND_COLORS.teal,
    fontFamily,
    fontSize: "15px",
    textDecoration: "underline",
  },
  card: {
    backgroundColor: "#fafafa",
    border: "1px solid #e5e5e5",
    padding: "20px 24px",
    margin: "20px 0",
  },
  cardRow: {
    borderBottom: "1px solid #ebebeb",
    padding: "12px 0",
  },
  cardRowLast: {
    padding: "12px 0",
  },
  cardLabel: {
    color: "#737373",
    fontFamily,
    fontSize: "12px",
    fontWeight: 500,
    letterSpacing: "0.5px",
    margin: "0",
    textTransform: "uppercase" as const,
  },
  cardValue: {
    color: "#1a1a1a",
    fontFamily,
    fontSize: "15px",
    fontWeight: 500,
    lineHeight: "22px",
    margin: "4px 0 0 0",
  },
  badge: {
    display: "inline-block",
    fontFamily,
    fontSize: "12px",
    fontWeight: 500,
    letterSpacing: "0.3px",
    padding: "5px 12px",
  },
  muted: {
    color: "#8a8a8a",
    fontFamily,
    fontSize: "12px",
    lineHeight: "20px",
    margin: "16px 0 0 0",
  },
  fallbackLink: {
    color: "#8a8a8a",
    fontFamily,
    fontSize: "12px",
    lineHeight: "20px",
    margin: "16px 0 0 0",
    wordBreak: "break-all" as const,
  },
} as const;
