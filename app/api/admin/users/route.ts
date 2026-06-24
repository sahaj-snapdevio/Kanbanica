import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { user } from "@/db/schema";
import { getAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1"));
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "all";
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (search) {
    conditions.push(
      or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))
    );
  }
  if (status === "active") {
    conditions.push(eq(user.banned, false));
  }
  if (status === "banned") {
    conditions.push(eq(user.banned, true));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [users, [totalRow]] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        banned: user.banned,
        banReason: user.banReason,
        role: user.role,
        createdAt: user.createdAt,
        image: user.image,
      })
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(user).where(where),
  ]);

  return NextResponse.json({ users, total: totalRow.count, page, pageSize });
}
