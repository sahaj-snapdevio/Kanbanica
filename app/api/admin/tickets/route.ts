import { and, count, desc, eq, ilike } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { supportTicket, user } from "@/db/schema";
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
  const status = searchParams.get("status") ?? "";
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (search) {
    conditions.push(ilike(supportTicket.subject, `%${search}%`));
  }
  if (status && ["OPEN", "IN_PROGRESS", "CLOSED"].includes(status)) {
    conditions.push(
      eq(supportTicket.status, status as "OPEN" | "IN_PROGRESS" | "CLOSED")
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [tickets, [totalRow]] = await Promise.all([
    db
      .select({
        id: supportTicket.id,
        ticketNumber: supportTicket.ticketNumber,
        subject: supportTicket.subject,
        status: supportTicket.status,
        category: supportTicket.category,
        createdAt: supportTicket.createdAt,
        userId: supportTicket.userId,
        assignedTo: supportTicket.assignedTo,
        userName: user.name,
        userEmail: user.email,
      })
      .from(supportTicket)
      .leftJoin(user, eq(supportTicket.userId, user.id))
      .where(where)
      .orderBy(desc(supportTicket.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(supportTicket).where(where),
  ]);

  return NextResponse.json({ tickets, total: totalRow.count, page, pageSize });
}
