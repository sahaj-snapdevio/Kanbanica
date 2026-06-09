import { eq, inArray } from "drizzle-orm";
import {
  CPU_OPTIONS,
  DISK_OPTIONS,
  IMAGE_OPTIONS,
  RAM_OPTIONS,
} from "@/config/platform";
import * as schema from "@/db/schema";
import { requirePermission } from "@/lib/api/auth-helpers";
import { withIdempotency } from "@/lib/api/idempotency";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { requireV1ApiKey } from "@/lib/api/v1-auth";
import { formatCube } from "@/lib/api/v1-cube-format";
import { audit, extractRequestContext } from "@/lib/audit";
import {
  calculateHourlyCost,
  getCreditRates,
  getCreditRateTiers,
  getTierMultiplier,
} from "@/lib/cost";
import {
  createCubeAction,
  listCubesAction,
} from "@/lib/cube-actions/cube-list-create";
import { describeRange, isValidRangeValue } from "@/lib/cube-options";
import { db } from "@/lib/db";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";
import { isValidSshPublicKey, validateName } from "@/lib/validators";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildCubeSummary } from "@/lib/webhook-payloads";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);

    if (!membership.isOwner) {
      await requirePermission(membership, "cube.view");
    }

    const url = new URL(request.url);
    const { page, limit, offset } = parsePagination(url);

    const { cubes: cubeRows, totalCount } = await listCubesAction({
      spaceId,
      membership,
      page,
      limit,
      offset,
    });

    const serverIds = [...new Set(cubeRows.map((c) => c.serverId))];
    const serverRows =
      serverIds.length > 0
        ? await db
            .select({
              id: schema.servers.id,
              publicIp: schema.servers.publicIp,
            })
            .from(schema.servers)
            .where(inArray(schema.servers.id, serverIds))
        : [];
    const serverMap = Object.fromEntries(
      serverRows.map((s) => [s.id, s.publicIp])
    );

    const rates = getCreditRates();
    const tiers = getCreditRateTiers();
    const cubesWithCost = cubeRows.map((cube) => {
      const costPerHour = rates
        ? Number.parseFloat(
            calculateHourlyCost(
              {
                vcpus: cube.vcpus,
                ramMb: cube.ramMb,
                diskLimitGb: cube.diskLimitGb,
              },
              rates,
              getTierMultiplier(cube.vcpus, tiers)
            ).toFixed(4)
          )
        : 0;
      return formatCube(cube, {
        publicIp: serverMap[cube.serverId] ?? null,
        costPerHour,
      });
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.list",
      category: "cube",
      actorType: "user",
      actorId: apiKeyId,
      actorEmail: null,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: "Listed cubes via API key",
      metadata: { page, limit, apiKeyId, totalCount },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      cubes: cubesWithCost,
      pagination: paginationMeta(totalCount, { page, limit }),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/v1/spaces/[spaceId]/cubes error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
    if (limited) {
      return limited;
    }
    const { spaceId } = await params;
    const { membership, apiKeyId } = await requireV1ApiKey(request, spaceId);
    await requirePermission(membership, "cube.create");

    const idempotencyKey = request.headers.get("idempotency-key");
    return await withIdempotency(idempotencyKey, spaceId, async () => {
      const body = await request.json();

      const rawName: unknown = body.name;
      const rawImageId: unknown = body.image;
      const rawSshPublicKey: unknown = body.sshPublicKey;
      const rawVcpus: unknown = body.resources?.vcpu;
      const rawRamMb: unknown =
        body.resources?.ramGb == null
          ? undefined
          : Math.round(body.resources.ramGb * 1024);
      const rawDiskGb: unknown = body.resources?.diskGb;
      const rawRegion: unknown = body.region;
      const rawUserData: unknown = body.userData ?? null;

      let regionId: string | undefined;
      if (rawRegion && typeof rawRegion === "string") {
        const [regionRow] = await db
          .select({ id: schema.regions.id })
          .from(schema.regions)
          .where(eq(schema.regions.slug, rawRegion))
          .limit(1);
        if (!regionRow) {
          return Response.json(
            { error: `Unknown region: ${rawRegion}` },
            { status: 400 }
          );
        }
        regionId = regionRow.id;
      }

      const vcpus = rawVcpus as number;
      const ramMb = rawRamMb as number;
      const diskGb = rawDiskGb as number;
      const imageId = rawImageId as string;
      const sshPublicKey = rawSshPublicKey;

      if (
        !sshPublicKey ||
        typeof sshPublicKey !== "string" ||
        !sshPublicKey.trim()
      ) {
        return Response.json(
          { error: "sshPublicKey is required" },
          { status: 400 }
        );
      }
      const trimmedSshKey = sshPublicKey.trim();
      if (!isValidSshPublicKey(trimmedSshKey)) {
        return Response.json(
          {
            error:
              "Invalid sshPublicKey format. Must start with ssh-ed25519, ssh-rsa, ecdsa-sha2-*, ssh-dss, or sk-*@openssh.com.",
          },
          { status: 400 }
        );
      }

      let userData: string | null = null;
      if (rawUserData !== null && rawUserData !== undefined) {
        if (typeof rawUserData !== "string") {
          return Response.json(
            { error: "userData must be a string" },
            { status: 400 }
          );
        }
        if (rawUserData.length > 16 * 1024) {
          return Response.json(
            { error: "userData must be 16 KB or less" },
            { status: 400 }
          );
        }
        userData = rawUserData;
      }

      const trimmedName = validateName(rawName);
      if (!trimmedName) {
        return Response.json(
          { error: "name is required and must be 1–64 printable characters" },
          { status: 400 }
        );
      }

      if (!isValidRangeValue(vcpus, CPU_OPTIONS)) {
        return Response.json(
          {
            error: `resources.vcpu must be in range ${describeRange(CPU_OPTIONS)}`,
          },
          { status: 400 }
        );
      }
      if (!isValidRangeValue(ramMb, RAM_OPTIONS)) {
        return Response.json(
          {
            error: `resources.ramGb must be ${describeRange(RAM_OPTIONS)} MB (e.g. 1 = 1 GB)`,
          },
          { status: 400 }
        );
      }
      const allowedImages = IMAGE_OPTIONS.map((img) => img.value);
      if (!imageId || !allowedImages.includes(imageId)) {
        return Response.json(
          { error: `image must be one of: ${allowedImages.join(", ")}` },
          { status: 400 }
        );
      }
      if (!isValidRangeValue(diskGb, DISK_OPTIONS)) {
        return Response.json(
          {
            error: `resources.diskGb must be in range ${describeRange(DISK_OPTIONS)}`,
          },
          { status: 400 }
        );
      }

      const rates = getCreditRates();
      const postTiers = getCreditRateTiers();
      const diskLimitGb = diskGb;
      const postMultiplier = getTierMultiplier(vcpus, postTiers);
      const hourlyCost = calculateHourlyCost(
        { vcpus, ramMb, diskLimitGb },
        rates,
        postMultiplier
      );

      const result = await createCubeAction(
        {
          spaceId,
          name: trimmedName,
          vcpus,
          ramMb,
          diskGb,
          imageId,
          sshPublicKey: trimmedSshKey,
          regionId,
          userData,
        },
        { hourlyCost }
      );

      if (!result.ok) {
        return Response.json(
          { error: result.error, ...(result.errorMeta ?? {}) },
          { status: result.status }
        );
      }

      const { cube } = result.data;

      dispatchWebhookEvent(spaceId, "cube.created", {
        cube: buildCubeSummary(cube),
        source: { type: "api_v1" },
      });

      const reqCtx = extractRequestContext(request.headers);
      audit({
        action: "cube.create",
        category: "cube",
        actorType: "user",
        actorId: apiKeyId,
        actorEmail: null,
        entityType: "cube",
        entityId: cube.id,
        spaceId,
        description: `Created cube "${cube.name}" via API key`,
        metadata: { cubeName: cube.name, serverId: cube.serverId, apiKeyId },
        source: "api",
        ...reqCtx,
      });

      const [server] = await db
        .select({ publicIp: schema.servers.publicIp })
        .from(schema.servers)
        .where(eq(schema.servers.id, cube.serverId))
        .limit(1);

      return Response.json(
        {
          cube: formatCube(cube, {
            publicIp: server?.publicIp ?? null,
            costPerHour: Number.parseFloat(hourlyCost.toFixed(4)),
          }),
        },
        { status: 201 }
      );
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/v1/spaces/[spaceId]/cubes error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
