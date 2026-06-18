import { createId } from "@paralleldrive/cuid2";
import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { helpArticle } from "@/db/schema";
import { audit } from "@/lib/audit";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function createHelpArticle({
  title,
  slug,
  category,
  body,
  authorId,
  authorEmail,
}: {
  title: string;
  slug?: string;
  category: string;
  body: unknown;
  authorId: string;
  authorEmail: string;
}) {
  const finalSlug = slug?.trim() || slugify(title);

  // Check for slug collision
  const existing = await db
    .select({ id: helpArticle.id })
    .from(helpArticle)
    .where(eq(helpArticle.slug, finalSlug))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (existing) return { error: "Slug already in use", status: 409 } as const;

  const id = createId();
  const now = new Date();

  const [article] = await db
    .insert(helpArticle)
    .values({
      id,
      title,
      slug: finalSlug,
      category,
      body: body as Record<string, unknown>,
      isPublished: false,
      authorId,
      orderIndex: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  void audit({
    action: "article.created",
    actorId: authorId,
    actorEmail: authorEmail,
    entityType: "help_article",
    entityId: id,
    description: `Admin created help article "${title}"`,
  });

  return { article };
}

export async function updateHelpArticle({
  id,
  updates,
  authorId,
  authorEmail,
}: {
  id: string;
  updates: { title?: string; slug?: string; category?: string; body?: unknown; isPublished?: boolean };
  authorId: string;
  authorEmail: string;
}) {
  const existing = await db
    .select({ id: helpArticle.id, slug: helpArticle.slug, isPublished: helpArticle.isPublished })
    .from(helpArticle)
    .where(eq(helpArticle.id, id))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!existing) return { error: "Not found", status: 404 } as const;

  if (updates.slug && updates.slug !== existing.slug) {
    const slugConflict = await db
      .select({ id: helpArticle.id })
      .from(helpArticle)
      .where(and(eq(helpArticle.slug, updates.slug), eq(helpArticle.id, id)))
      .limit(1)
      .then((r) => r[0] ?? null);
    // Check if slug is used by another article
    const otherSlug = await db
      .select({ id: helpArticle.id })
      .from(helpArticle)
      .where(eq(helpArticle.slug, updates.slug))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (otherSlug && otherSlug.id !== id) return { error: "Slug already in use", status: 409 } as const;
  }

  const now = new Date();
  const isPublishing = updates.isPublished === true && !existing.isPublished;

  const [article] = await db
    .update(helpArticle)
    .set({
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.slug !== undefined && { slug: updates.slug }),
      ...(updates.category !== undefined && { category: updates.category }),
      ...(updates.body !== undefined && { body: updates.body as Record<string, unknown> }),
      ...(updates.isPublished !== undefined && {
        isPublished: updates.isPublished,
        publishedAt: isPublishing ? now : undefined,
      }),
      updatedAt: now,
    })
    .where(eq(helpArticle.id, id))
    .returning();

  if (isPublishing) {
    void audit({
      action: "article.published",
      actorId: authorId,
      actorEmail: authorEmail,
      entityType: "help_article",
      entityId: id,
      description: `Admin published help article "${article.title}"`,
    });
  }

  return { article };
}

export async function deleteHelpArticle({
  id,
  authorId,
  authorEmail,
}: {
  id: string;
  authorId: string;
  authorEmail: string;
}) {
  const existing = await db
    .select({ id: helpArticle.id, title: helpArticle.title })
    .from(helpArticle)
    .where(eq(helpArticle.id, id))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!existing) return { error: "Not found", status: 404 } as const;

  await db.delete(helpArticle).where(eq(helpArticle.id, id));

  void audit({
    action: "article.deleted",
    actorId: authorId,
    actorEmail: authorEmail,
    entityType: "help_article",
    entityId: id,
    description: `Admin deleted help article "${existing.title}"`,
  });

  return { ok: true };
}
