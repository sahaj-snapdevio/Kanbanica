import { asc, desc } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { helpArticle } from "@/db/schema";
import { getAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { createHelpArticle } from "@/lib/support/help-articles";

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const articles = await db
    .select()
    .from(helpArticle)
    .orderBy(
      asc(helpArticle.category),
      asc(helpArticle.orderIndex),
      desc(helpArticle.createdAt)
    );

  return NextResponse.json({ articles });
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    title,
    slug,
    category,
    body: articleBody,
  } = body as Record<string, unknown>;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!category || typeof category !== "string" || !category.trim()) {
    return NextResponse.json(
      { error: "Category is required" },
      { status: 400 }
    );
  }
  if (!articleBody) {
    return NextResponse.json({ error: "Body is required" }, { status: 400 });
  }

  const result = await createHelpArticle({
    title: title.trim(),
    slug: typeof slug === "string" ? slug : undefined,
    category: category.trim(),
    body: articleBody,
    authorId: session.user.id,
    authorEmail: session.user.email,
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({ article: result.article }, { status: 201 });
}
