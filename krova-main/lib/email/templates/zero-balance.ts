import { createElement } from "react";
import { ZeroBalanceEmail } from "@/lib/email/components/zero-balance";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface ZeroBalanceEmailOptions {
  /** Free plans get the "Choose a Plan" CTA; paid plans get "Add Credits". */
  isFreePlan: boolean;
  pausedCubeCount: number;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  userName: string;
}

export async function zeroBalanceEmailTemplate({
  userName,
  spaceName,
  pausedCubeCount,
  spaceUrl,
  isFreePlan,
  productName,
}: ZeroBalanceEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(ZeroBalanceEmail, {
      userName,
      spaceName,
      pausedCubeCount,
      spaceUrl,
      isFreePlan,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const cubeWord = pausedCubeCount === 1 ? "Cube" : "Cubes";
  const ctaLine = isFreePlan
    ? `Choose a plan at: ${spaceUrl}?plan=open`
    : `Add credits at: ${spaceUrl}?topup=open`;

  // When count > 0: running cubes were just auto-paused.
  // When count == 0: only sleeping cubes / backups remain — there were no
  // running cubes to pause, but the balance is gone and storage charges
  // keep accruing. The header + body must reflect both cases accurately,
  // otherwise the customer reads "0 Cubes have been put to sleep" and
  // ignores the email.
  const header =
    pausedCubeCount > 0
      ? `URGENT: Cubes put to sleep for ${spaceName}.`
      : `URGENT: ${spaceName} credit balance exhausted.`;
  const body =
    pausedCubeCount > 0
      ? `The credit balance has reached $0 and ${pausedCubeCount} ${cubeWord} have been automatically put to sleep.

Your Cubes will resume automatically once credits are added.`
      : `The credit balance for ${spaceName} has reached $0. No Cubes were running, but storage charges (sleep storage and/or backups) continue to accrue against the now-empty balance.

Add credits to clear the unfunded charges and keep your storage intact.`;

  const text = `Hi ${userName},

${header}

${body}

${ctaLine}`;

  return { html, text };
}
