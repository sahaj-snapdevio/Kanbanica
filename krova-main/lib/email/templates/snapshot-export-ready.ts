import { createElement } from "react";
import { SnapshotExportReadyEmail } from "@/lib/email/components/snapshot-export-ready";
import { formatEmailDateUtc, getPlatformBranding } from "@/lib/email/helpers";
import { renderEmailTemplate } from "@/lib/email/renderer";

export interface SnapshotExportReadyEmailOptions {
  cubeName: string;
  downloadUrl: string;
  expiresAt: Date;
  productName?: string;
  sizeBytes: number;
  snapshotName: string;
  spaceName: string;
  userName: string;
}

export async function snapshotExportReadyTemplate({
  userName,
  spaceName,
  snapshotName,
  cubeName,
  downloadUrl,
  expiresAt,
  sizeBytes,
  productName,
}: SnapshotExportReadyEmailOptions): Promise<{ html: string; text: string }> {
  const branding = await getPlatformBranding();
  const name = productName ?? branding.productName;

  const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);
  const expiresAtLabel = formatEmailDateUtc(expiresAt);

  const html = await renderEmailTemplate(
    createElement(SnapshotExportReadyEmail, {
      userName,
      spaceName,
      snapshotName,
      cubeName,
      downloadUrl,
      expiresAtLabel,
      sizeMb,
      productName: name,
      logoUrl: branding.logoUrl,
    })
  );

  const text = `Hi ${userName},

Your snapshot "${snapshotName}" of cube "${cubeName}" in ${spaceName} is ready to download.
Archive size: ${sizeMb} MB

Download: ${downloadUrl}

This link expires on ${expiresAtLabel}.
After 24 hours, the archive is deleted from our servers — request a new export from the dashboard if you need it again.

You can re-import the .cube as a new cube via the "Import Cube" flow in any space.

— ${name}`;

  return { html, text };
}
