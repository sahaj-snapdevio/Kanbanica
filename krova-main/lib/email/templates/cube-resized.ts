import { createElement } from "react";
import { CubeResizedEmail } from "@/lib/email/components/cube-resized";
import { getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface CubeResizedEmailOptions {
  after: { vcpus: number; ramMb: number; diskLimitGb: number };
  before: { vcpus: number; ramMb: number; diskLimitGb: number };
  cubeId: string;
  cubeName: string;
  cubeUrl: string;
  isLive: boolean;
  productName?: string;
  spaceName: string;
  userName: string;
}

function formatSpec(spec: {
  vcpus: number;
  ramMb: number;
  diskLimitGb: number;
}) {
  return `${spec.vcpus} vCPU, ${spec.ramMb} MB RAM, ${spec.diskLimitGb} GB disk`;
}

export async function cubeResizedEmailTemplate({
  userName,
  spaceName,
  cubeName,
  cubeId,
  cubeUrl,
  before,
  after,
  isLive,
  productName,
}: CubeResizedEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const html = await renderEmailTemplate(
    createElement(CubeResizedEmail, {
      userName,
      spaceName,
      cubeName,
      cubeId,
      cubeUrl,
      before,
      after,
      isLive,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text = `Hi ${userName},

Your Cube "${cubeName}" in ${spaceName} has been resized ${isLive ? "with no downtime" : "with a brief restart"}.

Previous: ${formatSpec(before)}
New: ${formatSpec(after)}

Cube ID: ${cubeId}

View the Cube: ${cubeUrl}`;

  return { html, text };
}
