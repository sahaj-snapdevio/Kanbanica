import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { workspace, user } from "@/db/schema";
import { eq, ilike, and, count, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const search = searchParams.get("search") ?? "";
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const conditions = search ? [ilike(workspace.name, `%${search}%`)] : [];
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [workspaces, [totalRow]] = await Promise.all([
    db
      .select({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        status: workspace.status,
        createdAt: workspace.createdAt,
        createdBy: workspace.createdBy,
        ownerEmail: user.email,
        ownerName: user.name,
      })
      .from(workspace)
      .leftJoin(user, eq(workspace.createdBy, user.id))
      .where(where)
      .orderBy(desc(workspace.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(workspace).where(where),
  ]);

  return NextResponse.json({ workspaces, total: totalRow.count, page, pageSize });
}
