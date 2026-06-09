import { CUBE_IMAGES } from "@/config/platform";

export async function GET() {
  const images = CUBE_IMAGES.map((img) => ({
    id: img.id,
    name: img.label,
    version: img.version,
    description: `${img.label} (${img.family === "debian" ? "Debian-based" : "RHEL-based"})`,
  }));

  return Response.json({ images });
}
