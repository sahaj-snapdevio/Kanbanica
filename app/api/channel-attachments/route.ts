import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createId } from "@paralleldrive/cuid2";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { channelMessageAttachment } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { storage } from "@/lib/storage";
import { getWorkspaceMembership } from "@/lib/permissions";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_MIME_PREFIXES = [
  "image/",
  "video/",
  "audio/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats",
  "application/vnd.ms-excel",
  "application/zip",
  "application/x-zip",
  "text/",
];

function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 60 attachment uploads per user per minute.
  const limit = rateLimit(`channel-attachment:${session.user.id}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const workspaceId = formData.get("workspaceId") as string | null;

  if (!file || !workspaceId) {
    return NextResponse.json({ error: "File and workspaceId required" }, { status: 400 });
  }

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 25MB)" }, { status: 400 });
  }

  if (!isAllowedMime(file.type)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() ?? "bin";
  const key = `channels/${workspaceId}/${createId()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await storage.upload(key, buffer, { contentType: file.type });

  const attachmentId = createId();
  await db.insert(channelMessageAttachment).values({
    id: attachmentId,
    messageId: "pending", // Will be updated when message is sent
    uploadedBy: session.user.id,
    fileName: file.name,
    fileUrl: key,
    fileSize: file.size,
    mimeType: file.type,
    createdAt: new Date(),
  });

  return NextResponse.json({
    id: attachmentId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    url: `/api/files/${key}`,
  });
}
