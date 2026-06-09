"use client";

import {
  ArrowLeftIcon,
  CaretDownIcon,
  CheckIcon,
  CubeIcon,
  GlobeIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { redeployBackup } from "@/app/actions/backups";
import { ResourceSlider } from "@/components/resource-slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  CPU_OPTIONS,
  DISK_OPTIONS,
  IMAGE_OPTIONS,
  RAM_OPTIONS,
} from "@/config/platform";
import { formatRam, type PlanCubeLimits } from "@/lib/cube-options";
import { isValidSshPublicKey } from "@/lib/validators";

interface CubeRedeployFormProps {
  backup: {
    id: string;
    name: string;
    config: {
      vcpus: number;
      ramMb: number;
      diskLimitGb: number;
      imageId: string;
      regionId: string;
      regionName: string;
      domainMappings: { domain: string; port: number }[];
      tcpMappings: { cubePort: number; label: string | null }[];
    };
  };
  planLimits: PlanCubeLimits;
  regions: { id: string; name: string }[];
  spaceId: string;
}

export function CubeRedeployForm({
  spaceId,
  backup,
  regions,
  planLimits,
}: CubeRedeployFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  // Form fields. vcpus / ramMb default to the backup's saved value
  // clamped to plan (so customer can immediately submit without
  // adjusting). Disk defaults to backup's saved value AND has a hard
  // floor at it (can grow, cannot shrink).
  const [name, setName] = useState(`${backup.name}-redeploy`);
  const [regionId, setRegionId] = useState(
    regions.find((r) => r.id === backup.config.regionId)?.id ??
      regions[0]?.id ??
      ""
  );
  const [vcpus, setVcpus] = useState(
    Math.min(backup.config.vcpus, planLimits.maxVcpus)
  );
  const [ramMb, setRamMb] = useState(
    Math.min(backup.config.ramMb, planLimits.maxRamMb)
  );
  const [diskGb, setDiskGb] = useState(backup.config.diskLimitGb);
  const [sshKeyMode, setSshKeyMode] = useState<"replace" | "keep">("replace");
  const [sshPublicKey, setSshPublicKey] = useState("");

  // Clamp sliders to the lesser of platform range and plan ceiling.
  // Disk floor moves up to the backup's saved size — shrinking would
  // corrupt ext4.
  const cpuRange = useMemo(
    () => ({
      ...CPU_OPTIONS,
      max: Math.min(CPU_OPTIONS.max, planLimits.maxVcpus),
    }),
    [planLimits.maxVcpus]
  );
  const ramRange = useMemo(
    () => ({
      ...RAM_OPTIONS,
      max: Math.min(RAM_OPTIONS.max, planLimits.maxRamMb),
    }),
    [planLimits.maxRamMb]
  );
  const diskRange = useMemo(
    () => ({
      ...DISK_OPTIONS,
      min: Math.max(DISK_OPTIONS.min, backup.config.diskLimitGb),
      max: Math.min(DISK_OPTIONS.max, planLimits.maxDiskGb),
    }),
    [backup.config.diskLimitGb, planLimits.maxDiskGb]
  );

  const selectedRegion = regions.find((r) => r.id === regionId);
  const imageLabel =
    IMAGE_OPTIONS.find((i) => i.value === backup.config.imageId)?.label ??
    backup.config.imageId;

  // Plan oversize: backup's saved Cube is bigger than this plan allows.
  // Customer can still shrink vCPU/RAM to fit, but disk is locked by
  // the backup's saved value so an oversized backup-disk hard-blocks
  // redeployment until the customer upgrades.
  const diskOversize = backup.config.diskLimitGb > planLimits.maxDiskGb;

  function localValidationError(): string | null {
    if (!name.trim()) {
      return "Cube name is required";
    }
    if (!regionId) {
      return "Region is required";
    }
    if (sshKeyMode === "replace") {
      const trimmed = sshPublicKey.trim();
      if (!trimmed) {
        return "SSH public key is required (or switch to 'Keep existing keys')";
      }
      if (!isValidSshPublicKey(trimmed)) {
        return "Invalid SSH public key format";
      }
    }
    if (vcpus > planLimits.maxVcpus) {
      return `vCPU exceeds your plan's maximum (${planLimits.maxVcpus})`;
    }
    if (ramMb > planLimits.maxRamMb) {
      return `RAM exceeds your plan's maximum (${formatRam(planLimits.maxRamMb)})`;
    }
    if (diskGb > planLimits.maxDiskGb) {
      return `Disk exceeds your plan's maximum (${planLimits.maxDiskGb} GB)`;
    }
    if (diskGb < backup.config.diskLimitGb) {
      return `Disk cannot be smaller than the backup's saved disk size (${backup.config.diskLimitGb} GB)`;
    }
    return null;
  }

  // Synchronous double-submit guard: isPending only flips after startTransition
  // begins, so a same-tick double-click could dispatch the redeploy twice → two
  // cubes created from one backup. The ref rejects the 2nd synchronously.
  const submittingRef = useRef(false);
  function onSubmit() {
    const localErr = localValidationError();
    if (localErr) {
      setServerError(localErr);
      return;
    }
    setServerError(null);
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const result = await redeployBackup(spaceId, backup.id, {
          name: name.trim(),
          sshKeyMode,
          sshPublicKey:
            sshKeyMode === "replace" ? sshPublicKey.trim() : undefined,
          regionId,
          vcpus,
          ramMb,
          diskGb,
        });
        if ("error" in result) {
          setServerError(result.error ?? "An unexpected error occurred");
          return;
        }
        toast.success("Redeploying from backup");
        if (result.data?.cubeId) {
          router.push(`/${spaceId}/cubes/${result.data.cubeId}`);
        } else {
          router.refresh();
        }
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          aria-label="Back to backups"
          asChild
          className="shrink-0"
          size="icon"
          variant="outline"
        >
          <Link href={`/${spaceId}/backups`}>
            <ArrowLeftIcon className="size-4" />
          </Link>
        </Button>
        <div className="space-y-1">
          <PageHeaderTitle>Redeploy from Backup</PageHeaderTitle>
          <PageHeaderDescription>
            Create a new Cube from <strong>&ldquo;{backup.name}&rdquo;</strong>{" "}
            with the same disk state. Adjust the configuration below — disk can
            only grow, vCPU and RAM can move freely within your plan.
          </PageHeaderDescription>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Backup details preview */}
          <Card>
            <CardHeader>
              <CardTitle>Backup details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <SummaryRow label="Backup" value={backup.name} />
                <SummaryRow label="Original image" value={imageLabel} />
                <SummaryRow
                  label="Original vCPU"
                  value={`${backup.config.vcpus} vCPU${backup.config.vcpus > 1 ? "s" : ""}`}
                />
                <SummaryRow
                  label="Original RAM"
                  value={formatRam(backup.config.ramMb)}
                />
                <SummaryRow
                  label="Original disk"
                  value={`${backup.config.diskLimitGb} GB`}
                />
                <SummaryRow
                  label="Original region"
                  value={backup.config.regionName}
                />
              </div>
              {(backup.config.domainMappings.length > 0 ||
                backup.config.tcpMappings.length > 0) && (
                <>
                  <Separator className="my-3" />
                  <div className="text-xs text-muted-foreground">
                    Mappings present in the backup will be re-attempted on boot;
                    any that conflict with existing cubes will be skipped (the
                    new cube boots without them — you can re-add manually).
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {diskOversize && (
            <Alert variant="destructive">
              <WarningIcon className="size-4" />
              <AlertDescription>
                The backup&apos;s saved disk size ({backup.config.diskLimitGb}{" "}
                GB) exceeds your {planLimits.planName} plan&apos;s per-Cube disk
                limit ({planLimits.maxDiskGb} GB). Upgrade your plan to redeploy
                this backup — disk cannot be shrunk during redeploy because that
                would corrupt the filesystem.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="redeploy-name">Cube name</Label>
                  <Input
                    disabled={isPending}
                    id="redeploy-name"
                    maxLength={64}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-cube"
                    value={name}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Region</Label>
                  {regions.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild disabled={isPending}>
                        <Button
                          className="w-full justify-between font-normal"
                          type="button"
                          variant="outline"
                        >
                          <span className="flex items-center gap-2">
                            <GlobeIcon className="size-4 text-muted-foreground" />
                            {selectedRegion?.name ?? "Select region"}
                          </span>
                          <CaretDownIcon className="size-4 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                        {regions.map((r) => (
                          <DropdownMenuItem
                            key={r.id}
                            onClick={() => setRegionId(r.id)}
                          >
                            <span className="flex-1">{r.name}</span>
                            {r.id === regionId && (
                              <CheckIcon className="size-4 text-primary" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <div className="flex h-8 items-center rounded-none border border-input px-2.5 text-xs text-muted-foreground">
                      No regions available
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-xs text-muted-foreground">
                Your {planLimits.planName} plan allows up to {cpuRange.max} vCPU
                · {formatRam(ramRange.max)} RAM · {diskRange.max} GB disk per
                Cube. Disk can grow from the backup&apos;s saved{" "}
                {backup.config.diskLimitGb} GB but cannot shrink.
              </p>
              <ResourceSlider
                disabled={isPending}
                formatValue={(v) => `${v} vCPU${v > 1 ? "s" : ""}`}
                id="redeploy-vcpus"
                label="vCPUs"
                onChange={setVcpus}
                range={cpuRange}
                value={vcpus}
              />
              <ResourceSlider
                disabled={isPending}
                formatValue={formatRam}
                id="redeploy-ram"
                label="RAM"
                onChange={setRamMb}
                range={ramRange}
                value={ramMb}
              />
              <ResourceSlider
                disabled={isPending || diskOversize}
                formatValue={(v) => `${v} GB`}
                id="redeploy-disk"
                label="Disk"
                onChange={setDiskGb}
                range={diskRange}
                value={diskGb}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SSH Key</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <RadioGroup
                className="space-y-2"
                disabled={isPending}
                onValueChange={(v) => setSshKeyMode(v as "replace" | "keep")}
                value={sshKeyMode}
              >
                <div className="flex items-start gap-2 rounded-md border p-3">
                  <RadioGroupItem
                    className="mt-0.5"
                    id="redeploy-ssh-replace"
                    value="replace"
                  />
                  <div className="flex-1">
                    <Label
                      className="text-sm font-medium"
                      htmlFor="redeploy-ssh-replace"
                    >
                      Replace SSH keys with a new key
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      We overwrite{" "}
                      <code className="text-xs">
                        /root/.ssh/authorized_keys
                      </code>{" "}
                      inside the redeployed rootfs. Recommended.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-md border p-3">
                  <RadioGroupItem
                    className="mt-0.5"
                    id="redeploy-ssh-keep"
                    value="keep"
                  />
                  <div className="flex-1">
                    <Label
                      className="text-sm font-medium"
                      htmlFor="redeploy-ssh-keep"
                    >
                      Keep existing keys from the backup
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      The rootfs&apos;s existing{" "}
                      <code className="text-xs">authorized_keys</code> remains
                      untouched. Useful when you still have the original
                      Cube&apos;s private key — you can recover access to the
                      source workload without uploading a new key.
                    </p>
                  </div>
                </div>
              </RadioGroup>
              {sshKeyMode === "replace" && (
                <Textarea
                  autoComplete="off"
                  className="min-h-24 font-mono text-xs"
                  disabled={isPending}
                  onChange={(e) => setSshPublicKey(e.target.value)}
                  placeholder="ssh-ed25519 AAAA... user@host"
                  spellCheck={false}
                  value={sshPublicKey}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-20 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CubeIcon className="mr-1 inline size-4" />
                  New cube
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-0">
                <SummaryRow label="Name" value={name || "—"} />
                <SummaryRow
                  label="Region"
                  value={selectedRegion?.name ?? "—"}
                />
                <SummaryRow label="Image" value={imageLabel} />
                <Separator className="my-3" />
                <SummaryRow
                  label="vCPU"
                  value={`${vcpus} vCPU${vcpus > 1 ? "s" : ""}`}
                />
                <SummaryRow label="RAM" value={formatRam(ramMb)} />
                <SummaryRow
                  label="Disk"
                  value={
                    diskGb > backup.config.diskLimitGb
                      ? `${diskGb} GB (+${diskGb - backup.config.diskLimitGb} GB)`
                      : `${diskGb} GB`
                  }
                />
                <SummaryRow
                  label="SSH key"
                  value={
                    sshKeyMode === "replace"
                      ? "Replace with new key"
                      : "Keep existing"
                  }
                />
              </CardContent>
            </Card>

            {serverError && (
              <Alert variant="destructive">
                <WarningIcon className="size-4" />
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full"
              disabled={
                isPending ||
                diskOversize ||
                !!localValidationError() ||
                !regionId
              }
              onClick={onSubmit}
              size="lg"
              type="button"
            >
              {isPending && <Spinner className="size-4" />}
              Redeploy Cube
            </Button>
            <Button
              asChild
              className="w-full"
              disabled={isPending}
              type="button"
              variant="outline"
            >
              <Link href={`/${spaceId}/backups`}>Cancel</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm">{value}</span>
    </div>
  );
}
