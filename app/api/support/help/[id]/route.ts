import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { helpArticle } from "@/db/schema";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Support lookup by id or slug
  const article = await db
    .select()
    .from(helpArticle)
    .where(
      and(
        eq(helpArticle.isPublished, true),
        or(eq(helpArticle.id, id), eq(helpArticle.slug, id)),
      ),
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ article });
}
