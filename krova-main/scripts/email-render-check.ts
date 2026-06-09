#!/usr/bin/env tsx
/**
 * Email render verification harness.
 *
 * Renders every React Email template under `lib/email/components/` to a
 * standalone `.html` file using realistic hardcoded sample props. Intended
 * as a baseline-capture tool for an upcoming React Email migration: run it
 * before the migration, run it again after, and diff the output directories.
 *
 * No database, no env, no platform-branding lookup — each component is
 * rendered directly with literal props so the harness is hermetic.
 *
 * Usage:
 *   pnpm tsx scripts/email-render-check.ts [outDir]
 *
 * Exits non-zero if any component fails to render.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { ReactElement } from "react";
import { createElement } from "react";

if (existsSync(".env")) {
  process.loadEnvFile();
}

import { AdminCubeErrorEmail } from "@/lib/email/components/admin-cube-error";
import { CreditGrantedEmail } from "@/lib/email/components/credit-granted";
import { CubeErrorEmail } from "@/lib/email/components/cube-error";
import { CubeResizedEmail } from "@/lib/email/components/cube-resized";
import { CubeTransferredEmail } from "@/lib/email/components/cube-transferred";
import { InviteEmail } from "@/lib/email/components/invite";
import { LowBalanceEmail } from "@/lib/email/components/low-balance";
import { MagicLinkEmail } from "@/lib/email/components/magic-link";
import { SecurityDigestEmail } from "@/lib/email/components/security-digest";
import { VerifyEmailEmail } from "@/lib/email/components/verify-email";
import { ZeroBalanceEmail } from "@/lib/email/components/zero-balance";
import { renderEmailTemplate } from "@/lib/email/renderer";
import type { CheckResult } from "@/lib/security/version-check";

const PRODUCT_NAME = "Krova";
const LOGO_URL = "https://example.com/logo.png";

// Sample data for the security-digest buckets.
const sampleVulnerable: CheckResult = {
  name: "Caddy",
  pinnedAt: "config/platform.ts CADDY_VERSION",
  current: "2.7.6",
  latest: "2.8.4",
  behind: false,
  advisories: [
    {
      ghsaId: "GHSA-xxxx-yyyy-zzzz",
      summary: "Reverse-proxy header smuggling under certain configs",
      severity: "high",
      vulnerableRange: "< 2.8.0",
      patchedVersion: "2.8.0",
      url: "https://github.com/caddyserver/caddy/security/advisories/GHSA-xxxx-yyyy-zzzz",
    },
  ],
  status: "vulnerable",
  error: null,
  upstreamUrl: "https://github.com/caddyserver/caddy/releases",
};

const sampleBehind: CheckResult = {
  name: "Firecracker",
  pinnedAt: "config/platform.ts FIRECRACKER_VERSION",
  current: "1.10.1",
  latest: "1.11.0",
  behind: true,
  advisories: [],
  status: "behind",
  error: null,
  upstreamUrl: "https://github.com/firecracker-microvm/firecracker/releases",
};

const sampleOk: CheckResult = {
  name: "Linux Kernel 6.1",
  pinnedAt: "setup/images/build-all-images.sh KVER",
  current: "6.1.172",
  latest: "6.1.172",
  behind: false,
  advisories: [],
  status: "ok",
  error: null,
  upstreamUrl: "https://www.kernel.org",
};

const sampleError: CheckResult = {
  name: "Linux Kernel 6.1",
  pinnedAt: "config/platform.ts KERNEL_VERSION",
  current: "6.1.172",
  latest: null,
  behind: false,
  advisories: [],
  status: "error",
  error: "upstream source unavailable (request timed out after 10s)",
  upstreamUrl: null,
};

/**
 * Each entry: the output file name (matching the source `.tsx` file) and a
 * factory that builds the `ReactElement` with realistic sample props.
 *
 * `layout.tsx` (`EmailLayout`) is intentionally excluded — it is a wrapper
 * used by every template, not a standalone email.
 */
const templates: { file: string; element: () => ReactElement }[] = [
  {
    file: "magic-link",
    element: () =>
      createElement(MagicLinkEmail, {
        email: "ada@example.com",
        magicLinkUrl:
          "https://app.krova.cloud/auth/magic?token=sample-token-abc123",
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "verify-email",
    element: () =>
      createElement(VerifyEmailEmail, {
        newEmail: "ada.new@example.com",
        verificationUrl:
          "https://app.krova.cloud/auth/verify?token=sample-token-def456",
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "invite",
    element: () =>
      createElement(InviteEmail, {
        invitedByName: "Grace Hopper",
        spaceName: "Mainframe Crew",
        inviteUrl: "https://app.krova.cloud/invite/sample-invite-ghi789",
        permissions: ["cube.create", "cube.delete", "billing.view"],
        expiryStr: "May 25, 2026",
        permissionLabels: {
          "cube.create": "Create Cubes",
          "cube.delete": "Delete Cubes",
          "billing.view": "View Billing",
        },
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "cube-error",
    element: () =>
      createElement(CubeErrorEmail, {
        userName: "Ada",
        spaceName: "Mainframe Crew",
        cubeName: "analytics-worker",
        cubeId: "cube_abc123def456",
        reason: "Firecracker InstanceStart timed out after 90s",
        cubeUrl: "https://app.krova.cloud/space_xyz/cubes/cube_abc123def456",
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "admin-cube-error",
    element: () =>
      createElement(AdminCubeErrorEmail, {
        cubeName: "analytics-worker",
        cubeId: "cube_abc123def456",
        spaceId: "space_xyz789",
        serverId: "server_banana01",
        reason: "Firecracker InstanceStart timed out after 90s",
        cubeUrl: "https://app.krova.cloud/orbit/cubes/cube_abc123def456",
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "admin-cube-error-orphan",
    element: () =>
      createElement(AdminCubeErrorEmail, {
        cubeName: "fuk6g7nbqydv31302xz2wa2m",
        cubeId: "fuk6g7nbqydv31302xz2wa2m",
        spaceId: "unknown",
        serverId: "xljzu6odfpojdavgvg9pyasj",
        reason:
          "Orphaned VM detected on mango (DB status: deleted) — manual cleanup required",
        cubeUrl: "https://app.krova.cloud/orbit/cubes/fuk6g7nbqydv31302xz2wa2m",
        manualAction: {
          serverHostname: "mango",
          hostPath: "/var/lib/krova/cubes/fuk6g7nbqydv31302xz2wa2m",
          diskSize: "12G",
          processState: "stopped",
          inspectCommand:
            "pnpm cube:inspect fuk6g7nbqydv31302xz2wa2m --server xljzu6odfpojdavgvg9pyasj",
          destroyCommand:
            "pnpm cube:inspect fuk6g7nbqydv31302xz2wa2m --server xljzu6odfpojdavgvg9pyasj --destroy",
        },
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "cube-transferred",
    element: () =>
      createElement(CubeTransferredEmail, {
        userName: "Ada",
        spaceName: "Mainframe Crew",
        cubeName: "analytics-worker",
        cubeId: "cube_abc123def456",
        cubeUrl: "https://app.krova.cloud/space_xyz/cubes/cube_abc123def456",
        outcome: "success",
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "cube-resized",
    element: () =>
      createElement(CubeResizedEmail, {
        userName: "Ada",
        spaceName: "Mainframe Crew",
        cubeName: "analytics-worker",
        cubeId: "cube_abc123def456",
        cubeUrl: "https://app.krova.cloud/space_xyz/cubes/cube_abc123def456",
        before: { vcpus: 2, ramMb: 4096, diskLimitGb: 40 },
        after: { vcpus: 4, ramMb: 8192, diskLimitGb: 80 },
        isLive: true,
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "credit-granted",
    element: () =>
      createElement(CreditGrantedEmail, {
        userName: "Ada",
        spaceName: "Mainframe Crew",
        amount: "50.0000",
        newBalance: "127.5000",
        note: "Goodwill credit for the May 4 incident.",
        spaceUrl: "https://app.krova.cloud/space_xyz/billing",
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "low-balance",
    element: () =>
      createElement(LowBalanceEmail, {
        userName: "Ada",
        spaceName: "Mainframe Crew",
        currentBalance: "4.2500",
        spaceUrl: "https://app.krova.cloud/space_xyz/billing",
        isFreePlan: false,
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "zero-balance",
    element: () =>
      createElement(ZeroBalanceEmail, {
        userName: "Ada",
        spaceName: "Mainframe Crew",
        pausedCubeCount: 3,
        spaceUrl: "https://app.krova.cloud/space_xyz/billing",
        isFreePlan: true,
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    // Storage-only zero-balance variant (pausedCubeCount=0) — fires when the
    // backup-storage or sleep-storage pass drains a space with no running
    // cubes. The template switches header + body wording for this case.
    file: "zero-balance-storage-only",
    element: () =>
      createElement(ZeroBalanceEmail, {
        userName: "Ada",
        spaceName: "Mainframe Crew",
        pausedCubeCount: 0,
        spaceUrl: "https://app.krova.cloud/space_xyz/billing",
        isFreePlan: false,
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
  {
    file: "security-digest",
    element: () =>
      createElement(SecurityDigestEmail, {
        scanDate: "May 18, 2026",
        vulnerable: [sampleVulnerable],
        behind: [sampleBehind],
        ok: [sampleOk],
        errors: [sampleError],
        productName: PRODUCT_NAME,
        logoUrl: LOGO_URL,
      }),
  },
];

async function main() {
  const outDir = process.argv[2] ?? "./email-render-out";

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  console.log(`Rendering ${templates.length} email templates to ${outDir}\n`);

  let failed = 0;

  for (const { file, element } of templates) {
    try {
      const html = await renderEmailTemplate(element());
      const outPath = join(outDir, `${file}.html`);
      writeFileSync(outPath, html, "utf8");
      console.log(`  OK     ${file}.html (${html.length} bytes)`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED ${file}.html — ${message}`);
    }
  }

  const ok = templates.length - failed;
  console.log(`\n${ok}/${templates.length} rendered OK, ${failed} failed.`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
