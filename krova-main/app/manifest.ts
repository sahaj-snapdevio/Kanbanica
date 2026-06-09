import type { MetadataRoute } from "next";
import { PRODUCT_NAME } from "@/config/platform";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${PRODUCT_NAME} — Hardware-isolated cloud servers`,
    short_name: PRODUCT_NAME,
    description: `${PRODUCT_NAME} runs hardware-isolated microVMs (Cubes) with their own kernel and no public IP — full root SSH, custom domains, billed by the minute.`,
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "portrait-primary",
    categories: ["developer", "productivity", "utilities"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
