import {
  CPU_OPTIONS,
  DISK_OPTIONS,
  IMAGE_OPTIONS,
  RAM_OPTIONS,
} from "@/config/platform";
import { requirePermission, requireSpaceMember } from "@/lib/api/auth-helpers";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
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
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";
import { validateName } from "@/lib/validators";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const { membership } = await requireSpaceMember(request, spaceId);

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

    const rates = getCreditRates();
    const tiers = getCreditRateTiers();
    const cubesWithCost = cubeRows.map((cube) => ({
      ...cube,
      costPerHour: rates
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
        : 0,
    }));

    return Response.json({
      cubes: cubesWithCost,
      pagination: paginationMeta(totalCount, { page, limit }),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/spaces/[spaceId]/cubes error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
  if (limited) {
    return limited;
  }

  try {
    const { spaceId } = await params;
    const { membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.create");

    const body = await request.json();
    const { vcpus, ramMb, diskGb, imageId, sshPublicKey } = body;

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

    const trimmedName = validateName(body.name);
    if (!trimmedName) {
      return Response.json(
        { error: "name is required and must be 1–64 printable characters" },
        { status: 400 }
      );
    }

    if (!isValidRangeValue(vcpus, CPU_OPTIONS)) {
      return Response.json(
        { error: `vcpus must be in range ${describeRange(CPU_OPTIONS)}` },
        { status: 400 }
      );
    }
    if (!isValidRangeValue(ramMb, RAM_OPTIONS)) {
      return Response.json(
        { error: `ramMb must be in range ${describeRange(RAM_OPTIONS)}` },
        { status: 400 }
      );
    }
    const allowedImages = IMAGE_OPTIONS.map((img) => img.value);
    if (!imageId || !allowedImages.includes(imageId)) {
      return Response.json(
        { error: `imageId must be one of: ${allowedImages.join(", ")}` },
        { status: 400 }
      );
    }
    if (!isValidRangeValue(diskGb, DISK_OPTIONS)) {
      return Response.json(
        { error: `diskGb must be in range ${describeRange(DISK_OPTIONS)}` },
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
        sshPublicKey,
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

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.create",
      category: "cube",
      actorType: "user",
      actorId: membership.userId,
      entityType: "cube",
      entityId: cube.id,
      spaceId,
      description: `Created cube "${trimmedName}"`,
      metadata: {
        cubeId: cube.id,
        name: trimmedName,
        vcpus,
        ramMb,
        diskLimitGb,
        imageId,
        serverId: cube.serverId,
        hourlyCost,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json(
      {
        cube: {
          ...cube,
          costPerHour: Number.parseFloat(hourlyCost.toFixed(4)),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/spaces/[spaceId]/cubes error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
