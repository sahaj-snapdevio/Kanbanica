import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { storage } from "@/lib/storage";

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB raw upload limit
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AVATAR_DIMENSION = 256; // resize to 256×256 before storing

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit: 20 avatar uploads per user per minute.
  const limit = rateLimit(`avatar:${session.user.id}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image provided" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, WebP, or GIF images are allowed" }, { status: 400 });
  }
  if (file.size > MAX_AVATAR_SIZE) {
    return NextResponse.json({ error: "Image must be under 2 MB" }, { status: 400 });
  }

  // Delete old avatar
  const [currentUser] = await db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  if (currentUser?.image) {
    try { await storage.delete(currentUser.image); } catch {}
  }

  // Resize + convert to WebP with sharp
  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const processedBuffer = await sharp(rawBuffer)
    .resize(AVATAR_DIMENSION, AVATAR_DIMENSION, { fit: "cover", position: "centre" })
    .webp({ quality: 85 })
    .toBuffer();

  const key = `avatars/${session.user.id}/${crypto.randomUUID()}.webp`;
  await storage.upload(key, processedBuffer, { contentType: "image/webp" });
  await db.update(user).set({ image: key, updatedAt: new Date() }).where(eq(user.id, session.user.id));

  const url = await storage.url(key);
  return NextResponse.json({ url });
}

export async function DELETE(_request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [currentUser] = await db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  if (currentUser?.image) {
    try { await storage.delete(currentUser.image); } catch {}
    await db.update(user).set({ image: null, updatedAt: new Date() }).where(eq(user.id, session.user.id));
  }

  return NextResponse.json({ ok: true });
}
