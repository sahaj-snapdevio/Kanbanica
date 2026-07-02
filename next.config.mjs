import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server (.next/standalone) for lean production/Docker images.
  output: "standalone",
  turbopack: {
    root: resolve(__dirname),
  },
  transpilePackages: ["@emoji-mart/react"],
};

export default nextConfig;
