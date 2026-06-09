import { redirect } from "next/navigation";

import { loadCubeContext } from "@/lib/cubes/load-cube-context";

export const dynamic = "force-dynamic";

export default async function CubeDetailRedirectPage({
  params,
}: {
  params: Promise<{ spaceId: string; cubeId: string }>;
}) {
  const { spaceId, cubeId } = await params;
  const ctx = await loadCubeContext(spaceId, cubeId);

  // Deleted cubes have only the Activity tab to look at.
  if (ctx.cube.status === "deleted") {
    redirect(`/${spaceId}/cubes/${cubeId}/activity`);
  }

  redirect(`/${spaceId}/cubes/${cubeId}/connect`);
}
