import { and, asc, eq, ilike } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { helpArticle } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const category = searchParams.get("category") ?? "";
  const search = searchParams.get("search") ?? "";

  const conditions = [eq(helpArticle.isPublished, true)];
  if (category) {
    conditions.push(eq(helpArticle.category, category));
  }
  if (search) {
    conditions.push(ilike(helpArticle.title, `%${search}%`));
  }

  const articles = await db
    .select({
      id: helpArticle.id,
      title: helpArticle.title,
      slug: helpArticle.slug,
      category: helpArticle.category,
      orderIndex: helpArticle.orderIndex,
      publishedAt: helpArticle.publishedAt,
    })
    .from(helpArticle)
    .where(and(...conditions))
    .orderBy(
      asc(helpArticle.category),
      asc(helpArticle.orderIndex),
      asc(helpArticle.title)
    );

  return NextResponse.json({ articles });
}
