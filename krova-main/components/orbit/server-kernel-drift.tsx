/**
 * Server-side kernel drift summary card. Shows on the admin server detail
 * page, surfaces:
 *   - The kernel version currently sitting on /var/lib/krova/images/vmlinux
 *   - The latest version available in `platform_images` (if newer, the
 *     server itself is behind — operator should click "Update Images")
 *   - A breakdown of how many Cubes on this server are on each kernel
 *     version, with a link to cold-restart any that are outdated
 *
 * Server component — receives data fetched on the page.
 */

import {
  CheckCircleIcon,
  CpuIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatImageVersion, isImageVersionOutdated } from "@/lib/version";

interface CubeKernelVersionStat {
  bootedKernelVersion: number | null;
  cubeId: string;
  cubeName: string;
  spaceId: string;
  status: string;
}

interface ServerKernelDriftProps {
  /** All non-deleted cubes on this server, with their booted kernel minors. */
  cubes: CubeKernelVersionStat[];
  /** Minor of the latest kernel version in platform_images (or null if no row). */
  latestKernelVersion: number | null;
  /** Minor of the version currently on disk on this server (or null if never synced). */
  serverCurrentKernelVersion: number | null;
}

export function ServerKernelDrift({
  serverCurrentKernelVersion,
  latestKernelVersion,
  cubes,
}: ServerKernelDriftProps) {
  // If neither side has a value, versioning isn't populated (no images built
  // OR server never synced). Caller passes null in that case.
  if (serverCurrentKernelVersion == null && latestKernelVersion == null) {
    return null;
  }

  const serverBehind = isImageVersionOutdated(
    serverCurrentKernelVersion,
    latestKernelVersion
  );
  const serverLabel = formatImageVersion(serverCurrentKernelVersion);
  const latestLabel = formatImageVersion(latestKernelVersion);

  // Group cubes by version.
  const byVersion = new Map<number | "unknown", CubeKernelVersionStat[]>();
  for (const c of cubes) {
    const key = c.bootedKernelVersion ?? "unknown";
    const list = byVersion.get(key) ?? [];
    list.push(c);
    byVersion.set(key, list);
  }
  const sortedKeys = Array.from(byVersion.keys()).sort((a, b) => {
    if (a === "unknown") {
      return 1;
    }
    if (b === "unknown") {
      return -1;
    }
    return (b as number) - (a as number);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CpuIcon className="size-5" />
          Kernel Drift
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Server vs latest */}
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">On disk on this server</div>
              <div className="text-xs text-muted-foreground">
                /var/lib/krova/images/vmlinux
              </div>
            </div>
            <div className="flex items-center gap-2">
              {serverBehind ? (
                <Badge
                  className="bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  variant="secondary"
                >
                  <WarningCircleIcon className="size-3.5" weight="fill" />v
                  {serverLabel} · latest v{latestLabel}
                </Badge>
              ) : serverLabel == null ? (
                <Badge variant="secondary">not synced yet</Badge>
              ) : (
                <Badge
                  className="bg-green-500/10 text-green-600 dark:text-green-400"
                  variant="secondary"
                >
                  <CheckCircleIcon className="size-3.5" weight="fill" />v
                  {serverLabel} (latest)
                </Badge>
              )}
            </div>
          </div>
          {serverBehind && (
            <p className="mt-2 text-xs text-muted-foreground">
              Click <span className="font-medium">Update Images</span> in the
              header to push v{latestLabel} onto this box. Existing Cubes keep
              running v{serverLabel} until each one cold-restarts.
            </p>
          )}
        </div>

        {/* Cube kernel distribution */}
        {cubes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active Cubes on this server.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Cubes by kernel version ({cubes.length} total)
            </div>
            <ul className="divide-y divide-border rounded-md border">
              {sortedKeys.map((key) => {
                const list = byVersion.get(key) ?? [];
                const isOutdated =
                  typeof key === "number" &&
                  isImageVersionOutdated(key, serverCurrentKernelVersion);
                const versionLabel =
                  key === "unknown" ? "unknown" : `v${formatImageVersion(key)}`;
                return (
                  <li
                    className="flex items-center gap-3 p-3 text-sm"
                    key={String(key)}
                  >
                    <Badge
                      className={
                        isOutdated
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          : key === "unknown"
                            ? ""
                            : "bg-green-500/10 text-green-600 dark:text-green-400"
                      }
                      variant="secondary"
                    >
                      Kernel {versionLabel}
                    </Badge>
                    <span className="text-muted-foreground">
                      {list.length} cube{list.length === 1 ? "" : "s"}
                    </span>
                    <span className="ml-auto flex flex-wrap gap-1">
                      {list.slice(0, 5).map((c) => (
                        <Link
                          className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                          href={`/orbit/cubes/${c.cubeId}`}
                          key={c.cubeId}
                        >
                          {c.cubeName}
                        </Link>
                      ))}
                      {list.length > 5 && (
                        <span className="text-xs text-muted-foreground">
                          +{list.length - 5} more
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {sortedKeys.some(
              (k) =>
                typeof k === "number" &&
                isImageVersionOutdated(k, serverCurrentKernelVersion)
            ) && (
              <p className="text-xs text-muted-foreground">
                Outdated Cubes can be cold-restarted from each Cube&apos;s
                detail page. State is preserved — only the kernel changes.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
