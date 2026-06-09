import { eq } from "drizzle-orm";
import { CubeDetailConnectTab } from "@/components/cube-detail-connect-tab";
import * as schema from "@/db/schema";
import { loadCubeContext } from "@/lib/cubes/load-cube-context";
import { db } from "@/lib/db";
import { serverConnectDomain } from "@/lib/server/server-hostnames";

export const dynamic = "force-dynamic";

export default async function CubeConnectTabPage({
  params,
}: {
  params: Promise<{ spaceId: string; cubeId: string }>;
}) {
  const { spaceId, cubeId } = await params;
  const ctx = await loadCubeContext(spaceId, cubeId);

  const tcpMappings = await db
    .select()
    .from(schema.tcpPortMappings)
    .where(eq(schema.tcpPortMappings.cubeId, cubeId));

  const sshMapping = tcpMappings.find((m) => m.isSsh && m.status === "active");
  const sshHostPort = sshMapping?.hostPort ?? null;
  const sshDisabled = tcpMappings.some(
    (m) => m.isSsh && m.status === "disabled"
  );

  const sshCommand =
    ctx.server && sshHostPort
      ? `ssh root@${serverConnectDomain(ctx.server.hostname)} -p ${sshHostPort}`
      : null;
  const sshTunnelExample =
    ctx.server && sshHostPort
      ? `ssh -L 3000:localhost:3000 root@${serverConnectDomain(ctx.server.hostname)} -p ${sshHostPort}`
      : null;

  return (
    <CubeDetailConnectTab
      currentStatus={ctx.cube.status}
      sshCommand={sshCommand}
      sshDisabled={sshDisabled}
      sshTunnelExample={sshTunnelExample}
    />
  );
}
