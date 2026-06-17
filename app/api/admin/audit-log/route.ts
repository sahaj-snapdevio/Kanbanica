import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { auditLogs } from "@/db/schema";
import { ilike, and, count, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const search = searchParams.get("search") ?? "";
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const conditions = search ? [ilike(auditLogs.action, `%${search}%`)] : [];
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [logs, [totalRow]] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(auditLogs).where(where),
  ]);

  return NextResponse.json({ logs, total: totalRow.count, page, pageSize });
}
