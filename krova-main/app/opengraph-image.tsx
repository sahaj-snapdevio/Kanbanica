import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { PRODUCT_NAME } from "@/config/platform";

export const alt = `${PRODUCT_NAME} — On-demand Cloud Cubes`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logoBuffer = await readFile(join(process.cwd(), "public/logo.png"));
  const logoDataUrl = `data:image/png;base64,${logoBuffer.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background:
          "linear-gradient(135deg, #0a0a0a 0%, #18181b 60%, #0f172a 100%)",
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/** biome-ignore lint/performance/noImgElement: required for ImageResponse */}
        {/** biome-ignore lint/a11y/useAltText: alt prop is at the route level */}
        <img height={64} src={logoDataUrl} width={99} />
        <span
          style={{
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: -1,
          }}
        >
          {PRODUCT_NAME}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            fontSize: 88,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          <span>Your own kernel.&nbsp;</span>
          <span style={{ color: "#2dd4bf" }}>No public IP.</span>
        </div>
        <div
          style={{
            fontSize: 30,
            lineHeight: 1.35,
            color: "#cbd5e1",
            maxWidth: 980,
            display: "flex",
          }}
        >
          Hardware-isolated microVMs with their own kernel —
          Cloudflare-protected, full root SSH, less than half the price of the
          big VPS providers.
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 22,
          color: "#94a3b8",
          borderTop: "1px solid #27272a",
          paddingTop: 24,
        }}
      >
        <span style={{ display: "flex" }}>
          Own kernel · No public IP · Cloudflare-protected
        </span>
        <span style={{ display: "flex", color: "#2dd4bf", fontWeight: 600 }}>
          krova.cloud
        </span>
      </div>
    </div>,
    { ...size }
  );
}
