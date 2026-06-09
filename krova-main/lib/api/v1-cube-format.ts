/**
 * Shared response formatters for the public v1 API.
 *
 * Every v1 resource is serialized through one of these so the wire shape is
 * consistent (camelCase keys, internal columns omitted) and never a raw DB row.
 */

type CubeRow = {
  id: string;
  name: string;
  status: string;
  vcpus: number;
  ramMb: number;
  diskLimitGb: number;
  imageId: string;
  createdAt: Date;
  updatedAt: Date;
};

type CubeExtras = {
  publicIp?: string | null;
  costPerHour?: number;
  serverDomain?: string | null;
};

/** Public v1 shape for a cube. */
export function formatCube(cube: CubeRow, extras: CubeExtras = {}) {
  return {
    id: cube.id,
    name: cube.name,
    state: cube.status,
    publicIpv4: extras.publicIp ?? null,
    resources: {
      vcpu: cube.vcpus,
      ramGb: cube.ramMb / 1024,
      diskGb: cube.diskLimitGb,
    },
    image: cube.imageId,
    costPerHour: extras.costPerHour ?? 0,
    createdAt: cube.createdAt,
    updatedAt: cube.updatedAt,
    ...(extras.serverDomain === undefined
      ? {}
      : { serverDomain: extras.serverDomain }),
  };
}

type DomainRow = {
  id: string;
  cubeId: string;
  domain: string;
  port: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Public v1 shape for a domain mapping — internal columns omitted. */
export function formatDomain(row: DomainRow) {
  return {
    id: row.id,
    cubeId: row.cubeId,
    domain: row.domain,
    port: row.port,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type TcpMappingRow = {
  id: string;
  cubeId: string;
  cubePort: number;
  hostPort: number;
  label: string | null;
  status: string;
  isSsh: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Public v1 shape for a TCP port mapping — internal columns (allocatedPortId) omitted. */
export function formatTcpMapping(
  row: TcpMappingRow,
  whitelistedIps: { id: string; cidr: string }[]
) {
  return {
    id: row.id,
    cubeId: row.cubeId,
    cubePort: row.cubePort,
    hostPort: row.hostPort,
    label: row.label,
    status: row.status,
    isSsh: row.isSsh,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    whitelistedIps,
  };
}
