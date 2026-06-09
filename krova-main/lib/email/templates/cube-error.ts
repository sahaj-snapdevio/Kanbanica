import { createElement } from "react";
import { CubeErrorEmail } from "@/lib/email/components/cube-error";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface CubeErrorEmailOptions {
  cubeId: string;
  cubeName: string;
  cubeUrl: string;
  productName?: string;
  reason: string;
  spaceName: string;
  userName: string;
}

export async function cubeErrorEmailTemplate({
  userName,
  spaceName,
  cubeName,
  cubeId,
  reason,
  cubeUrl,
  productName,
}: CubeErrorEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(CubeErrorEmail, {
      userName,
      spaceName,
      cubeName,
      cubeId,
      reason,
      cubeUrl,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text = `Hi ${userName},

Cube "${cubeName}" failed to start in ${spaceName}.

Cube ID: ${cubeId}
Error: ${reason}

View the Cube: ${cubeUrl}

If this issue persists, please contact your platform administrator.`;

  return { html, text };
}
