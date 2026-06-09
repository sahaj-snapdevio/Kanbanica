import { createElement } from "react";
import { SecurityDigestEmail } from "@/lib/email/components/security-digest";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";
import type { CheckResult } from "@/lib/security/version-check";

export interface SecurityDigestEmailOptions {
  behind: CheckResult[];
  errors: CheckResult[];
  ok: CheckResult[];
  productName?: string;
  scanDate: string;
  vulnerable: CheckResult[];
}

export async function securityDigestEmailTemplate({
  scanDate,
  vulnerable,
  behind,
  ok,
  errors,
  productName,
}: SecurityDigestEmailOptions): Promise<{ html: string; text: string }> {
  const branding = getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(SecurityDigestEmail, {
      scanDate,
      vulnerable,
      behind,
      ok,
      errors,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const lines: string[] = [];
  lines.push(`${name} weekly security digest — ${scanDate}`);
  lines.push("");

  if (vulnerable.length > 0) {
    lines.push(
      `ACT NOW — ${vulnerable.length} component(s) with active advisories:`
    );
    for (const r of vulnerable) {
      lines.push(`  · ${r.name} ${r.current} (latest ${r.latest ?? "?"})`);
      for (const adv of r.advisories) {
        lines.push(
          `      ${adv.severity.toUpperCase()} ${adv.ghsaId}: ${adv.summary}`
        );
        lines.push(
          `        Vulnerable: ${adv.vulnerableRange}${
            adv.patchedVersion ? ` · Patched in ${adv.patchedVersion}` : ""
          }`
        );
        lines.push(`        ${adv.url}`);
      }
      lines.push(`      Pinned at: ${r.pinnedAt}`);
    }
    lines.push("");
  }

  if (behind.length > 0) {
    lines.push(`Behind upstream — ${behind.length} component(s):`);
    for (const r of behind) {
      lines.push(
        `  · ${r.name} ${r.current} → latest ${r.latest ?? "?"} (${r.pinnedAt})`
      );
    }
    lines.push("");
  }

  if (ok.length > 0) {
    lines.push(`Up to date — ${ok.length} component(s):`);
    for (const r of ok) {
      lines.push(`  · ${r.name} ${r.current}`);
    }
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push(`Could not check — ${errors.length} component(s):`);
    for (const r of errors) {
      lines.push(`  · ${r.name}: ${r.error}`);
    }
  }

  return { html, text: lines.join("\n") };
}
