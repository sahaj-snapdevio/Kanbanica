"use client";

import { DomainMappings } from "@/components/domain-mappings";
import { TcpMappings } from "@/components/tcp-mappings";
import type { CubeStatusValue } from "@/db/schema/types";

interface CubeDetailNetworkingTabProps {
  canManage: boolean;
  cubeId: string;
  cubeStatus: CubeStatusValue;
  domainMappings: {
    id: string;
    cubeId: string;
    domain: string;
    port: number | null;
    status: "pending" | "active" | "stopping";
    cloudflareStatus: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  serverDomain: string;
  spaceId: string;
  tcpMappings: {
    id: string;
    cubeId: string;
    cubePort: number;
    hostPort: number;
    label: string | null;
    isSsh: boolean;
    status: "pending" | "active" | "stopping" | "failed" | "disabled";
    createdAt: string;
    updatedAt: string;
    whitelistedIps: { id: string; cidr: string }[];
  }[];
}

export function CubeDetailNetworkingTab({
  domainMappings,
  tcpMappings,
  cubeId,
  spaceId,
  serverDomain,
  canManage,
  cubeStatus,
}: CubeDetailNetworkingTabProps) {
  return (
    <>
      <DomainMappings
        canManage={canManage}
        cubeId={cubeId}
        cubeStatus={cubeStatus}
        mappings={domainMappings}
        spaceId={spaceId}
      />
      <TcpMappings
        canManage={canManage}
        cubeId={cubeId}
        cubeStatus={cubeStatus}
        mappings={tcpMappings}
        serverDomain={serverDomain}
        spaceId={spaceId}
      />
    </>
  );
}
