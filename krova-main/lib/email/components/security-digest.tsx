import { Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";
import type { CheckResult } from "@/lib/security/version-check";

export interface SecurityDigestEmailProps {
  behind: CheckResult[];
  errors: CheckResult[];
  logoUrl?: string | null;
  ok: CheckResult[];
  productName?: string;
  scanDate: string;
  vulnerable: CheckResult[];
}

export function SecurityDigestEmail({
  scanDate,
  vulnerable,
  behind,
  ok,
  errors,
  productName = "Krova",
  logoUrl,
}: SecurityDigestEmailProps) {
  const totalChecks =
    vulnerable.length + behind.length + ok.length + errors.length;
  const headline =
    vulnerable.length > 0
      ? `${vulnerable.length} component${vulnerable.length === 1 ? "" : "s"} affected by published advisories`
      : behind.length > 0
        ? `${behind.length} component${behind.length === 1 ? "" : "s"} behind upstream — no known CVEs`
        : "All pinned versions up to date";
  const preview = `Weekly security scan · ${scanDate} · ${headline}`;

  return (
    <EmailLayout logoUrl={logoUrl} preview={preview} productName={productName}>
      <Text style={emailStyles.heading}>Weekly security digest</Text>
      <Text style={emailStyles.paragraph}>
        Scan run on <strong>{scanDate}</strong>. Checked {totalChecks} pinned
        components against upstream releases and GitHub Security Advisories.
      </Text>

      {vulnerable.length > 0 ? (
        <Bucket
          accent="#dc2626"
          accentBg="#fef2f2"
          accentBorder="#fecaca"
          rows={vulnerable}
          title="Act now — advisory affects your pinned version"
        />
      ) : null}

      {behind.length > 0 ? (
        <Bucket
          accent="#ca8a04"
          accentBg="#fefce8"
          accentBorder="#fef08a"
          rows={behind}
          title="Behind upstream — review when convenient"
        />
      ) : null}

      {ok.length > 0 ? (
        <Bucket
          accent={emailStyles.brandTeal}
          accentBg={emailStyles.brandTealTintBg}
          accentBorder={emailStyles.brandTealTintBorder}
          rows={ok}
          title="Up to date"
        />
      ) : null}

      {errors.length > 0 ? (
        <Bucket
          accent="#525252"
          accentBg="#fafafa"
          accentBorder="#e5e5e5"
          rows={errors}
          title="Could not check — upstream source unavailable"
        />
      ) : null}

      <Text style={emailStyles.muted}>
        This scan checks pinned third-party components only (kernel,
        Firecracker, Caddy, Railpack, Nixpacks, Pack, plus npm-pinned packages).
        Distro-managed packages on rootfs and host are not yet included.
      </Text>
    </EmailLayout>
  );
}

function Bucket({
  title,
  accent,
  accentBg,
  accentBorder,
  rows,
}: {
  title: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
  rows: CheckResult[];
}) {
  return (
    <Section style={{ margin: "0 0 24px 0" }}>
      <Section
        style={{
          ...emailStyles.card,
          backgroundColor: accentBg,
          border: `1px solid ${accentBorder}`,
          borderLeft: `3px solid ${accent}`,
          margin: "0 0 12px 0",
        }}
      >
        <Text
          style={{
            ...emailStyles.cardLabel,
            color: accent,
            margin: "0",
          }}
        >
          {title} · {rows.length}
        </Text>
      </Section>

      {rows.map((row) => (
        <Section
          key={row.name}
          style={{
            ...emailStyles.card,
            margin: "0 0 8px 0",
          }}
        >
          <div style={emailStyles.cardRow}>
            <Text style={emailStyles.cardLabel}>{row.name}</Text>
            <Text style={emailStyles.cardValue}>
              {row.current}
              {row.latest && row.latest !== row.current
                ? ` → latest ${row.latest}`
                : ""}
            </Text>
          </div>

          {row.advisories.map((adv) => (
            <div key={adv.ghsaId} style={emailStyles.cardRow}>
              <Text style={emailStyles.cardLabel}>
                {adv.severity.toUpperCase()} · {adv.ghsaId}
              </Text>
              <Text style={emailStyles.cardValue}>{adv.summary}</Text>
              <Text style={emailStyles.muted}>
                Vulnerable: {adv.vulnerableRange}
                {adv.patchedVersion
                  ? ` · Patched in ${adv.patchedVersion}`
                  : ""}
              </Text>
              <Text
                style={{ ...emailStyles.fallbackLink, margin: "4px 0 0 0" }}
              >
                {adv.url}
              </Text>
            </div>
          ))}

          {row.error ? (
            <div style={emailStyles.cardRowLast}>
              <Text style={{ ...emailStyles.muted, margin: "0" }}>
                Error: {row.error}
              </Text>
            </div>
          ) : (
            <div style={emailStyles.cardRowLast}>
              <Text style={emailStyles.cardLabel}>Pinned at</Text>
              <Text style={emailStyles.cardValue}>{row.pinnedAt}</Text>
            </div>
          )}
        </Section>
      ))}
    </Section>
  );
}
