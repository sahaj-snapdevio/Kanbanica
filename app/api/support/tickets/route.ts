import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, count, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { supportTicket } from "@/db/schema";
import { createTicket } from "@/lib/support/tickets";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const status = searchParams.get("status") ?? "";
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(supportTicket.userId, session.user.id)];
  if (status && ["OPEN", "IN_PROGRESS", "CLOSED"].includes(status)) {
    conditions.push(eq(supportTicket.status, status as "OPEN" | "IN_PROGRESS" | "CLOSED"));
  }
  const where = and(...conditions);

  const [tickets, [totalRow]] = await Promise.all([
    db
      .select({
        id: supportTicket.id,
        ticketNumber: supportTicket.ticketNumber,
        subject: supportTicket.subject,
        status: supportTicket.status,
        category: supportTicket.category,
        createdAt: supportTicket.createdAt,
        updatedAt: supportTicket.updatedAt,
        closedAt: supportTicket.closedAt,
      })
      .from(supportTicket)
      .where(where)
      .orderBy(desc(supportTicket.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(supportTicket).where(where),
  ]);

  return NextResponse.json({ tickets, total: totalRow.count, page, pageSize });
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { subject, body: messageBody, category } = body as Record<string, string>;

  if (!subject || subject.length < 5 || subject.length > 200) {
    return NextResponse.json({ error: "Subject must be between 5 and 200 characters" }, { status: 400 });
  }
  if (!messageBody || messageBody.length < 20 || messageBody.length > 5000) {
    return NextResponse.json({ error: "Message must be between 20 and 5000 characters" }, { status: 400 });
  }
  const validCategories = ["GENERAL", "TASKS", "BILLING", "TECHNICAL", "OTHER"];
  const cat = (category?.toUpperCase() ?? "GENERAL") as "GENERAL" | "TASKS" | "BILLING" | "TECHNICAL" | "OTHER";
  if (!validCategories.includes(cat)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const result = await createTicket({
    userId: session.user.id,
    userEmail: session.user.email,
    subject,
    body: messageBody,
    category: cat,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ticket: result.ticket }, { status: 201 });
}
