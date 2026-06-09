import { createElement } from "react";
import { OverageCapHitEmail } from "@/lib/email/components/overage-cap-hit";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface OverageCapHitEmailOptions {
  cap: string;
  pausedCubeCount: number;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  userName: string;
}

export async function overageCapHitEmailTemplate({
  userName,
  spaceName,
  cap,
  pausedCubeCount,
  spaceUrl,
  productName,
}: OverageCapHitEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(OverageCapHitEmail, {
      userName,
      spaceName,
      cap,
      pausedCubeCount,
      spaceUrl,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const cubeWord = pausedCubeCount === 1 ? "Cube" : "Cubes";
  const text = `Hi ${userName},

Cap reached — ${pausedCubeCount} ${cubeWord} paused for ${spaceName}.

Your $${cap} overage cap has been reached. Raise your cap, top up, or wait for next month's period to start.

View billing: ${spaceUrl}`;

  return { html, text };
}
