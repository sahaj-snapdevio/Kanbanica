import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["ssh2"],
  allowedDevOrigins: ["rohit-krova.shopify.xx.kg"],
  turbopack: {
    root: resolve(__dirname),
  },
};

export default nextConfig;
