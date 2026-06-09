import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const regionRows = await db.select().from(schema.regions);

    return Response.json({ regions: regionRows });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/regions error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin(request);

    const body = await request.json();
    const { name, slug } = body;

    if (!name || !slug) {
      return Response.json(
        { error: "Missing required fields: name, slug" },
        { status: 400 }
      );
    }

    // Validate slug format (lowercase alphanumeric + hyphens)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return Response.json(
        {
          error:
            "Slug must be lowercase alphanumeric with hyphens (e.g. us-east-1)",
        },
        { status: 400 }
      );
    }

    // Check for duplicate slug
    const [existing] = await db
      .select({ id: schema.regions.id })
      .from(schema.regions)
      .where(eq(schema.regions.slug, slug))
      .limit(1);

    if (existing) {
      return Response.json(
        { error: "A region with this slug already exists" },
        { status: 409 }
      );
    }

    const [region] = await db
      .insert(schema.regions)
      .values({ name, slug })
      .returning();

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "region.create",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "region",
      entityId: region.id,
      description: `Admin created region "${name}" (${slug})`,
      metadata: { name, slug },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ region }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/regions error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAdmin(request);

    const body = await request.json();
    const { id, name, slug } = body;

    if (!id) {
      return Response.json({ error: "Missing region id" }, { status: 400 });
    }

    // Validate slug format outside transaction
    if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return Response.json(
        { error: "Slug must be lowercase alphanumeric with hyphens" },
        { status: 400 }
      );
    }

    // Use a transaction with FOR UPDATE to prevent TOCTOU race on slug uniqueness
    const txResult = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.regions)
        .where(eq(schema.regions.id, id))
        .for("update")
        .limit(1);

      if (!existing) {
        return { error: "Region not found", status: 404 } as const;
      }

      if (slug && slug !== existing.slug) {
        const [dup] = await tx
          .select({ id: schema.regions.id })
          .from(schema.regions)
          .where(eq(schema.regions.slug, slug))
          .limit(1);
        if (dup && dup.id !== id) {
          return {
            error: "A region with this slug already exists",
            status: 409,
          } as const;
        }
      }

      const [updated] = await tx
        .update(schema.regions)
        .set({
          ...(name !== undefined && { name }),
          ...(slug !== undefined && { slug }),
          updatedAt: new Date(),
        })
        .where(eq(schema.regions.id, id))
        .returning();

      return { region: updated } as const;
    });

    if ("error" in txResult) {
      return Response.json(
        { error: txResult.error },
        { status: txResult.status }
      );
    }

    const updated = txResult.region;

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "region.update",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "region",
      entityId: id,
      description: `Admin updated region "${updated.name}"`,
      metadata: { name, slug },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ region: updated });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("PATCH /api/orbit/regions error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json({ error: "Missing region id" }, { status: 400 });
    }

    // Check if any servers reference this region
    const [serverRef] = await db
      .select({ id: schema.servers.id })
      .from(schema.servers)
      .where(eq(schema.servers.regionId, id))
      .limit(1);

    if (serverRef) {
      return Response.json(
        { error: "Cannot delete region — servers are still assigned to it" },
        { status: 409 }
      );
    }

    const [deleted] = await db
      .delete(schema.regions)
      .where(eq(schema.regions.id, id))
      .returning();

    if (!deleted) {
      return Response.json({ error: "Region not found" }, { status: 404 });
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "region.delete",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "region",
      entityId: id,
      description: `Admin deleted region "${deleted.name}"`,
      metadata: { name: deleted.name, slug: deleted.slug },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("DELETE /api/orbit/regions error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
