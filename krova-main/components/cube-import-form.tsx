"use client";

import {
  ArrowLeftIcon,
  CaretDownIcon,
  CheckIcon,
  CloudArrowUpIcon,
  FileArrowUpIcon,
  GlobeIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  cancelCubeImport,
  completeCubeImport,
  getCubeImportStatus,
  initiateCubeImport,
} from "@/app/actions/cube-import";
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
import { formatBytes } from "@/lib/format";
import {
  type ClientPreviewManifest,
  parseCubeManifestFromFile,
} from "@/lib/storage/cube-archive/client-manifest";
import { isValidSshPublicKey } from "@/lib/validators";

interface CubeImportFormProps {
  planLimits: PlanCubeLimits;
  regions: { id: string; name: string; slug: string }[];
  spaceId: string;
}

type Stage =
  | "select"
  | "configuring"
  | "uploading"
  | "finalizing"
  | "provisioning";

interface UploadProgress {
  bytesUploaded: number;
  completedParts: number;
  totalBytes: number;
  totalParts: number;
}

const PART_UPLOAD_PARALLELISM = 4;
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 800; // 40 min at 3s intervals

export function CubeImportForm({
  spaceId,
  regions,
  planLimits,
}: CubeImportFormProps) {
  const router = useRouter();

  // Stage machine — gates what the page renders.
  const [stage, setStage] = useState<Stage>("select");
  const [file, setFile] = useState<File | null>(null);
  const [manifest, setManifest] = useState<ClientPreviewManifest | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, startParseTransition] = useTransition();

  // Form fields
  const [name, setName] = useState("");
  const [sshKeyMode, setSshKeyMode] = useState<"replace" | "keep">("replace");
  const [sshPublicKey, setSshPublicKey] = useState("");
  const [regionId, setRegionId] = useState<string>("");
  const [vcpus, setVcpus] = useState(CPU_OPTIONS.min);
  const [ramMb, setRamMb] = useState(RAM_OPTIONS.min);
  const [diskGb, setDiskGb] = useState(DISK_OPTIONS.min);
  const [imageId, setImageId] = useState<string>(IMAGE_OPTIONS[0]?.value ?? "");
  const [userData, setUserData] = useState<string>("");

  // Upload + provisioning state
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [provisionStatus, setProvisionStatus] = useState<string | null>(null);

  // Synchronous double-submit guard. React's setState is async, so two
  // rapid clicks on Import could both pass the stage gate and spawn
  // duplicate initiate calls. The ref check is set/read synchronously.
  const submittingRef = useRef(false);

  // Clamp sliders to the lesser of platform range and plan ceiling.
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
  // Disk slider extra constraint: imported disk can only GROW from the
  // manifest's diskLimitGb (shrinking ext4 would corrupt). When a manifest
  // is loaded, the floor moves up to its diskLimitGb. If that floor would
  // exceed the plan's max, the form is hard-blocked further down (see
  // `diskOversize`).
  const diskRange = useMemo(() => {
    const planMax = Math.min(DISK_OPTIONS.max, planLimits.maxDiskGb);
    const manifestFloor = manifest?.config.diskLimitGb ?? DISK_OPTIONS.min;
    const min = Math.max(DISK_OPTIONS.min, manifestFloor);
    // Clamp min ≤ max so the ResourceSlider never sees an inverted
    // range (which would render unusably). When the manifest's disk
    // overshoots the plan, the actual block is the diskOversize gate
    // on the submit button.
    return {
      ...DISK_OPTIONS,
      min: Math.min(min, planMax),
      max: planMax,
    };
  }, [manifest, planLimits.maxDiskGb]);

  // Manifest's disk floor exceeds the plan's max — customer cannot
  // import this cube without upgrading their plan. Show a clear
  // hard-block error rather than letting the slider misbehave.
  const diskOversize =
    !!manifest && manifest.config.diskLimitGb > planLimits.maxDiskGb;

  const selectedRegion = regions.find((r) => r.id === regionId);
  const selectedImage = IMAGE_OPTIONS.find((i) => i.value === imageId);

  function resetAll() {
    setStage("select");
    setFile(null);
    setManifest(null);
    setParseError(null);
    setName("");
    setSshKeyMode("replace");
    setSshPublicKey("");
    setRegionId("");
    setVcpus(CPU_OPTIONS.min);
    setRamMb(RAM_OPTIONS.min);
    setDiskGb(DISK_OPTIONS.min);
    setImageId(IMAGE_OPTIONS[0]?.value ?? "");
    setUserData("");
    setSubmitError(null);
    setProgress(null);
    setImportId(null);
    setProvisionStatus(null);
  }

  function handleFile(f: File) {
    setParseError(null);
    setManifest(null);
    setFile(f);
    if (!f.name.toLowerCase().endsWith(".cube")) {
      setParseError("Selected file does not end in .cube");
      return;
    }
    startParseTransition(async () => {
      try {
        const parsed = await parseCubeManifestFromFile(f);
        setManifest(parsed);
        // Pre-populate the form from the manifest, clamped to plan
        // limits where applicable.
        setName(`${parsed.source.cubeName}-imported`);
        setVcpus(Math.min(parsed.config.vcpus, planLimits.maxVcpus));
        setRamMb(Math.min(parsed.config.ramMb, planLimits.maxRamMb));
        setDiskGb(
          Math.max(
            parsed.config.diskLimitGb,
            Math.min(parsed.config.diskLimitGb, planLimits.maxDiskGb)
          )
        );
        // Use manifest's imageId if still supported, else default to
        // the first option — the customer can change it.
        const supported = IMAGE_OPTIONS.some(
          (i) => i.value === parsed.config.imageId
        );
        setImageId(
          supported ? parsed.config.imageId : (IMAGE_OPTIONS[0]?.value ?? "")
        );
        setUserData(parsed.config.userData ?? "");
        // Default region to first available.
        if (regions[0]) {
          setRegionId(regions[0].id);
        }
        setStage("configuring");
      } catch (err) {
        setParseError(
          err instanceof Error
            ? err.message
            : "Could not read the archive's manifest"
        );
      }
    });
  }

  function localValidationError(): string | null {
    if (!file || !manifest) {
      return "No file selected";
    }
    if (!name.trim()) {
      return "Cube name is required";
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
    if (diskGb < manifest.config.diskLimitGb) {
      return `Disk cannot be smaller than the archive's disk size (${manifest.config.diskLimitGb} GB)`;
    }
    return null;
  }

  async function uploadParts(
    f: File,
    parts: { partNumber: number; url: string }[],
    chunkSizeBytes: number,
    onProgress: (delta: number) => void
  ): Promise<{ partNumber: number; etag: string }[]> {
    const results: ({ partNumber: number; etag: string } | undefined)[] =
      new Array(parts.length);
    let cursor = 0;

    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= parts.length) {
          return;
        }
        const part = parts[idx];
        const start = (part.partNumber - 1) * chunkSizeBytes;
        const end = Math.min(start + chunkSizeBytes, f.size);
        const blob = f.slice(start, end);
        const resp = await fetch(part.url, { method: "PUT", body: blob });
        if (!resp.ok) {
          throw new Error(
            `Part ${part.partNumber} upload failed: HTTP ${resp.status}`
          );
        }
        const etag = resp.headers.get("etag") ?? resp.headers.get("ETag");
        if (!etag) {
          throw new Error(
            `Part ${part.partNumber} upload returned no ETag header (S3 bucket may be missing CORS ExposeHeaders: ["ETag"])`
          );
        }
        results[idx] = {
          partNumber: part.partNumber,
          etag: etag.replace(/"/g, ""),
        };
        onProgress(end - start);
      }
    }

    const workers = Array.from(
      { length: Math.min(PART_UPLOAD_PARALLELISM, parts.length) },
      () => worker()
    );
    await Promise.all(workers);

    const out = results.filter(
      (r): r is { partNumber: number; etag: string } => r !== undefined
    );
    if (out.length !== parts.length) {
      throw new Error("Some parts failed to upload");
    }
    return out;
  }

  async function submit() {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    try {
      await submitInner();
    } finally {
      submittingRef.current = false;
    }
  }

  async function submitInner() {
    setSubmitError(null);
    const localErr = localValidationError();
    if (localErr) {
      setSubmitError(localErr);
      return;
    }
    if (!file || !manifest) {
      return;
    }

    // Resolve region slug for the server action — initiateCubeImport
    // takes the slug (matches the public REST API shape).
    const regionSlug = regions.find((r) => r.id === regionId)?.slug ?? null;

    setStage("uploading");
    setProgress({
      completedParts: 0,
      totalParts: 0,
      bytesUploaded: 0,
      totalBytes: file.size,
    });

    const initResult = await initiateCubeImport(spaceId, {
      name: name.trim(),
      fileSizeBytes: file.size,
      sshKeyMode,
      sshPublicKey: sshKeyMode === "replace" ? sshPublicKey.trim() : null,
      region: regionSlug,
      vcpusOverride: vcpus === manifest.config.vcpus ? null : vcpus,
      ramMbOverride: ramMb === manifest.config.ramMb ? null : ramMb,
      diskGbOverride: diskGb === manifest.config.diskLimitGb ? null : diskGb,
      userData: userData.trim() || null,
      expectedConfig: {
        vcpus: manifest.config.vcpus,
        ramMb: manifest.config.ramMb,
        diskLimitGb: manifest.config.diskLimitGb,
      },
    });
    if ("error" in initResult) {
      setSubmitError(initResult.error);
      setStage("configuring");
      return;
    }
    const init = initResult.data;
    setImportId(init.importId);
    setProgress({
      completedParts: 0,
      totalParts: init.parts.length,
      bytesUploaded: 0,
      totalBytes: file.size,
    });

    let parts: { partNumber: number; etag: string }[];
    try {
      parts = await uploadParts(
        file,
        init.parts,
        init.chunkSizeBytes,
        (delta) => {
          setProgress((p) =>
            p
              ? {
                  ...p,
                  completedParts: p.completedParts + 1,
                  bytesUploaded: Math.min(
                    p.bytesUploaded + delta,
                    p.totalBytes
                  ),
                }
              : null
          );
        }
      );
    } catch (err) {
      await cancelCubeImport(spaceId, init.importId).catch(() => {});
      setSubmitError(err instanceof Error ? err.message : String(err));
      setStage("configuring");
      return;
    }

    setStage("finalizing");
    const completeResult = await completeCubeImport(spaceId, init.importId, {
      parts,
      config: {
        vcpus,
        ramMb,
        diskLimitGb: diskGb,
        imageId,
        userData: userData.trim() || null,
      },
    });
    if ("error" in completeResult) {
      setSubmitError(completeResult.error);
      setStage("configuring");
      return;
    }
    const cubeId = completeResult.data.cubeId;
    setStage("provisioning");
    setProvisionStatus("provisioning");

    // Bounded polling — see CLAUDE.md for the trade-offs vs. an
    // open-ended loop.
    const targetCubeUrl = `/${spaceId}/cubes/${cubeId}`;
    let consecutiveErrors = 0;
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const statusResult = await getCubeImportStatus(spaceId, init.importId);
      if ("error" in statusResult) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          setSubmitError(
            `Polling for import status keeps failing: ${statusResult.error}`
          );
          setStage("configuring");
          return;
        }
        continue;
      }
      consecutiveErrors = 0;
      setProvisionStatus(statusResult.data.status);
      if (statusResult.data.status === "complete") {
        toast.success("Cube imported successfully");
        router.push(targetCubeUrl);
        return;
      }
      if (
        statusResult.data.status === "failed" ||
        statusResult.data.status === "expired"
      ) {
        setSubmitError(
          statusResult.data.error ?? "Import failed during provisioning"
        );
        setStage("configuring");
        return;
      }
    }
    setSubmitError(
      "Import is taking longer than expected. Check the cube list — provisioning may still complete in the background."
    );
    setStage("configuring");
  }

  async function handleCancelUpload() {
    if (!importId) {
      return;
    }
    await cancelCubeImport(spaceId, importId).catch(() => {});
    resetAll();
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          aria-label="Back to cubes"
          asChild
          className="shrink-0"
          size="icon"
          variant="outline"
        >
          <Link href={`/${spaceId}/cubes`}>
            <ArrowLeftIcon className="size-4" />
          </Link>
        </Button>
        <div className="space-y-1">
          <PageHeaderTitle>Import Cube</PageHeaderTitle>
          <PageHeaderDescription>
            Provision a new cube from a <code>.cube</code> archive you
            previously exported.
          </PageHeaderDescription>
        </div>
      </div>

      {stage === "select" && (
        <FilePickerCard
          error={parseError}
          file={file}
          onFile={handleFile}
          onReset={resetAll}
          parsing={parsing}
        />
      )}

      {(stage === "uploading" || stage === "finalizing") && progress && (
        <UploadingView
          file={file}
          finalizing={stage === "finalizing"}
          manifest={manifest}
          onCancel={handleCancelUpload}
          progress={progress}
        />
      )}

      {stage === "provisioning" && (
        <ProvisioningView
          file={file}
          manifest={manifest}
          status={provisionStatus}
        />
      )}

      {stage === "configuring" && manifest && file && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left column — form */}
          <div className="space-y-6 lg:col-span-2">
            <ArchivePreviewCard file={file} manifest={manifest} />

            {diskOversize && (
              <Alert variant="destructive">
                <WarningIcon className="size-4" />
                <AlertDescription>
                  The archive&apos;s disk size ({manifest.config.diskLimitGb}{" "}
                  GB) exceeds your {planLimits.planName} plan&apos;s per-Cube
                  disk limit ({planLimits.maxDiskGb} GB). Disk cannot be shrunk
                  during import — upgrade your plan to import this cube.
                </AlertDescription>
              </Alert>
            )}

            <Card>
              <CardContent className="pt-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="import-name">Name</Label>
                    <Input
                      id="import-name"
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
                        <DropdownMenuTrigger asChild>
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
                  Your {planLimits.planName} plan allows up to {cpuRange.max}{" "}
                  vCPU · {formatRam(ramRange.max)} RAM · {diskRange.max} GB disk
                  per Cube. Disk can grow from the archive&apos;s{" "}
                  {manifest.config.diskLimitGb} GB but cannot shrink (would
                  corrupt the filesystem).
                </p>
                <ResourceSlider
                  formatValue={(v) => `${v} vCPU${v > 1 ? "s" : ""}`}
                  id="import-vcpus"
                  label="vCPUs"
                  onChange={setVcpus}
                  range={cpuRange}
                  value={vcpus}
                />
                <ResourceSlider
                  formatValue={formatRam}
                  id="import-ram"
                  label="RAM"
                  onChange={setRamMb}
                  range={ramRange}
                  value={ramMb}
                />
                <ResourceSlider
                  disabled={diskOversize}
                  formatValue={(v) => `${v} GB`}
                  id="import-disk"
                  label="Disk"
                  onChange={setDiskGb}
                  range={diskRange}
                  value={diskGb}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Image</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="w-full justify-between font-normal"
                      type="button"
                      variant="outline"
                    >
                      {selectedImage?.label ?? "Select image"}
                      <CaretDownIcon className="size-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                    {IMAGE_OPTIONS.map((img) => (
                      <DropdownMenuItem
                        key={img.value}
                        onClick={() => setImageId(img.value)}
                      >
                        <span className="flex-1">{img.label}</span>
                        {img.value === imageId && (
                          <CheckIcon className="size-4 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {!IMAGE_OPTIONS.some(
                  (i) => i.value === manifest.config.imageId
                ) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    The archive references an image (
                    <code>{manifest.config.imageId}</code>) that is no longer
                    offered. Pick a current image — the rootfs itself is what
                    boots, this only labels the cube.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>SSH Key</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <RadioGroup
                  className="space-y-2"
                  onValueChange={(v) => setSshKeyMode(v as "replace" | "keep")}
                  value={sshKeyMode}
                >
                  <div className="flex items-start gap-2 rounded-md border p-3">
                    <RadioGroupItem
                      className="mt-0.5"
                      id="ssh-replace"
                      value="replace"
                    />
                    <div className="flex-1">
                      <Label
                        className="text-sm font-medium"
                        htmlFor="ssh-replace"
                      >
                        Replace SSH keys with a new key
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        We overwrite{" "}
                        <code className="text-xs">
                          /root/.ssh/authorized_keys
                        </code>{" "}
                        inside the imported rootfs. Recommended for most
                        imports.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 rounded-md border p-3">
                    <RadioGroupItem
                      className="mt-0.5"
                      id="ssh-keep"
                      value="keep"
                    />
                    <div className="flex-1">
                      <Label className="text-sm font-medium" htmlFor="ssh-keep">
                        Keep existing keys from the archive
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        The rootfs&apos;s existing{" "}
                        <code className="text-xs">authorized_keys</code> remains
                        untouched. You must have the matching private key on
                        hand — Krova cannot recover access if you don&apos;t.
                      </p>
                    </div>
                  </div>
                </RadioGroup>
                {sshKeyMode === "replace" && (
                  <Textarea
                    autoComplete="off"
                    className="min-h-24 font-mono text-xs"
                    onChange={(e) => setSshPublicKey(e.target.value)}
                    placeholder="ssh-ed25519 AAAA... user@host"
                    spellCheck={false}
                    value={sshPublicKey}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  cloud-init user_data{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    optional
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  className="font-mono text-xs"
                  maxLength={16 * 1024}
                  onChange={(e) => setUserData(e.target.value)}
                  placeholder="#cloud-config&#10;# (optional)"
                  rows={4}
                  value={userData}
                />
                <p className="text-xs text-muted-foreground">
                  Stored as metadata on the new cube row. The imported
                  rootfs&apos;s existing cloud-init state is preserved;
                  user_data is not re-applied on boot.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Right column — summary + actions */}
          <div className="lg:col-span-1">
            <div className="sticky top-20 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-0">
                  <SummaryRow label="Source" value={manifest.source.cubeName} />
                  <SummaryRow
                    label="Archive size"
                    value={formatBytes(file.size)}
                  />
                  <SummaryRow
                    label="Region"
                    value={selectedRegion?.name ?? "—"}
                  />
                  <SummaryRow
                    label="Image"
                    value={selectedImage?.label ?? "—"}
                  />
                  <Separator className="my-3" />
                  <SummaryRow
                    label="vCPU"
                    value={`${vcpus} vCPU${vcpus > 1 ? "s" : ""}`}
                  />
                  <SummaryRow label="RAM" value={formatRam(ramMb)} />
                  <SummaryRow label="Disk" value={`${diskGb} GB`} />
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

              {submitError && (
                <Alert variant="destructive">
                  <WarningIcon className="size-4" />
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              )}

              <Button
                className="w-full"
                disabled={diskOversize || !!localValidationError() || !regionId}
                onClick={submit}
                size="lg"
                type="button"
              >
                <CloudArrowUpIcon className="size-4" />
                Import Cube
              </Button>
              <Button
                className="w-full"
                onClick={resetAll}
                type="button"
                variant="outline"
              >
                Pick a different file
              </Button>
              <Button asChild className="w-full" type="button" variant="ghost">
                <Link href={`/${spaceId}/cubes`}>Cancel</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function FilePickerCard({
  file,
  onFile,
  parsing,
  error,
  onReset,
}: {
  file: File | null;
  onFile: (f: File) => void;
  parsing: boolean;
  error: string | null;
  onReset: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Select a .cube archive</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline">
            <label className="cursor-pointer">
              <FileArrowUpIcon className="size-4" />
              Choose file
              <input
                accept=".cube"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    onFile(f);
                  }
                }}
                type="file"
              />
            </label>
          </Button>
          {file && (
            <span className="text-xs text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
            </span>
          )}
          {file && (
            <Button onClick={onReset} size="sm" variant="ghost">
              Reset
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          We read the first ~64 KB of the file locally to extract the archive
          manifest. No data leaves your machine until you click{" "}
          <strong>Import Cube</strong>.
        </p>
        {parsing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Reading manifest…
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <WarningIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function ArchivePreviewCard({
  file,
  manifest,
}: {
  file: File;
  manifest: ClientPreviewManifest;
}) {
  const imageLabel =
    IMAGE_OPTIONS.find((i) => i.value === manifest.config.imageId)?.label ??
    manifest.config.imageId;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Archive details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <SummaryRow label="Filename" value={file.name} />
          <SummaryRow label="Archive size" value={formatBytes(file.size)} />
          <SummaryRow label="Format" value={manifest.format} />
          <SummaryRow label="Source cube" value={manifest.source.cubeName} />
          <SummaryRow
            label="Exported"
            value={new Date(manifest.exportedAt).toLocaleString()}
          />
          <SummaryRow label="Original image" value={imageLabel} />
          <SummaryRow
            label="Original vCPU"
            value={String(manifest.config.vcpus)}
          />
          <SummaryRow
            label="Original RAM"
            value={formatRam(manifest.config.ramMb)}
          />
          <SummaryRow
            label="Original disk"
            value={`${manifest.config.diskLimitGb} GB`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function UploadingView({
  file,
  manifest,
  progress,
  finalizing,
  onCancel,
}: {
  file: File | null;
  manifest: ClientPreviewManifest | null;
  progress: UploadProgress;
  finalizing: boolean;
  onCancel: () => void;
}) {
  const pct =
    progress.totalBytes > 0
      ? Math.min(
          100,
          Math.round((progress.bytesUploaded / progress.totalBytes) * 100)
        )
      : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {finalizing ? "Finalizing upload…" : "Uploading archive…"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {file && manifest && (
          <div className="text-sm text-muted-foreground">
            {file.name} · {formatBytes(file.size)} →{" "}
            <strong>{manifest.source.cubeName}</strong>
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {finalizing ? "Assembling parts on S3…" : "Streaming to S3"}
            </span>
            <span className="font-mono tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(progress.bytesUploaded)} of{" "}
            {formatBytes(progress.totalBytes)}
            {progress.totalParts > 0 &&
              ` · part ${progress.completedParts} / ${progress.totalParts}`}
          </div>
        </div>
        {!finalizing && (
          <p className="text-xs text-muted-foreground">
            Upload is going directly from your browser to S3 storage. Do not
            close this tab.
          </p>
        )}
        <Button
          disabled={finalizing}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel upload
        </Button>
      </CardContent>
    </Card>
  );
}

function ProvisioningView({
  file,
  manifest,
  status,
}: {
  file: File | null;
  manifest: ClientPreviewManifest | null;
  status: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Provisioning the new cube…</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {file && manifest && (
          <div className="text-sm text-muted-foreground">
            {file.name} · {formatBytes(file.size)} →{" "}
            <strong>{manifest.source.cubeName}</strong>
          </div>
        )}
        <Alert>
          <Spinner className="size-4" />
          <AlertDescription>
            Upload complete — the worker is decompressing the rootfs and booting
            your cube. This can take a few minutes for larger images.{" "}
            <span className="text-muted-foreground">
              Status: <strong>{status ?? "provisioning"}</strong>
            </span>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
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
