"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  CaretDownIcon,
  CheckIcon,
  GlobeIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { createCube } from "@/app/actions/cubes";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { type CreditRateTier, getTierMultiplier } from "@/lib/cost-shared";
import type { CubeOptions, PlanCubeLimits } from "@/lib/cube-options";
import { formatRam } from "@/lib/cube-options";
import { isValidSshPublicKey } from "@/lib/validators";

const createCubeSchema = z.object({
  name: z.string().min(1, "Cube name is required"),
  sshPublicKey: z
    .string()
    .min(1, "SSH public key is required")
    .refine(
      isValidSshPublicKey,
      "Invalid SSH key. Must start with ssh-ed25519, ssh-rsa, ecdsa-sha2-*, ssh-dss, or sk-*@openssh.com."
    ),
});

type CreateCubeFormValues = z.infer<typeof createCubeSchema>;

interface RegionOption {
  id: string;
  name: string;
  slug: string;
}

interface CreateCubeFormProps {
  creditRateConfig: {
    vcpuRate: number;
    ramRate: number;
    diskRate: number;
  };
  cubeOptions: CubeOptions;
  /** Space's plan ceilings (plan defaults merged with per-space overrides).
   *  Used to clamp the resource sliders so the picker can't propose a value
   *  the server would reject in `assertCanCreateCubeV2`. */
  planLimits: PlanCubeLimits;
  regions: RegionOption[];
  spaceId: string;
  tiers: CreditRateTier[];
}

export function CreateCubeForm({
  spaceId,
  creditRateConfig,
  cubeOptions,
  planLimits,
  regions,
  tiers,
}: CreateCubeFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<CreateCubeFormValues>({
    resolver: zodResolver(createCubeSchema),
    defaultValues: { name: "", sshPublicKey: "" },
    mode: "onChange",
  });

  // Clamp each slider's max to `min(global config max, plan ceiling)` so the
  // picker mirrors what `assertCanCreateCubeV2` will accept. The plan can
  // grant LESS than the global range but never more, so the lower wins.
  const cpuRange = useMemo(
    () => ({
      ...cubeOptions.cpuOptions,
      max: Math.min(cubeOptions.cpuOptions.max, planLimits.maxVcpus),
    }),
    [cubeOptions.cpuOptions, planLimits.maxVcpus]
  );
  const ramRange = useMemo(
    () => ({
      ...cubeOptions.ramOptions,
      max: Math.min(cubeOptions.ramOptions.max, planLimits.maxRamMb),
    }),
    [cubeOptions.ramOptions, planLimits.maxRamMb]
  );
  const diskRange = useMemo(
    () => ({
      ...cubeOptions.diskOptions,
      max: Math.min(cubeOptions.diskOptions.max, planLimits.maxDiskGb),
    }),
    [cubeOptions.diskOptions, planLimits.maxDiskGb]
  );

  // Initial values: each slider starts at the global range minimum since
  // the picker is monotonic (user drags up to add resources). The clamped
  // ranges above prevent any drag past the plan's per-Cube ceiling. The
  // `diskRange.max` clamp on the disk default keeps the historical
  // "default to 10 GB unless the plan caps lower" behavior intact.
  const [vcpus, setVcpus] = useState(cpuRange.min);
  const [ramMb, setRamMb] = useState(ramRange.min);
  const [diskGb, setDiskGb] = useState(Math.min(10, diskRange.max));
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const [imageId, setImageId] = useState(
    cubeOptions.imageOptions[0]?.value ?? ""
  );

  const multiplier = getTierMultiplier(vcpus, tiers);
  const activeTier = tiers.find(
    (t) => vcpus >= t.minVcpus && (t.maxVcpus === null || vcpus <= t.maxVcpus)
  );
  const cpuCost = vcpus * creditRateConfig.vcpuRate * multiplier;
  const ramCost = (ramMb / 1024) * creditRateConfig.ramRate * multiplier;
  const diskCost = diskGb * creditRateConfig.diskRate * multiplier;
  const hourlyCost = cpuCost + ramCost + diskCost;
  const monthlyCost = hourlyCost * 730;

  const selectedImageLabel =
    cubeOptions.imageOptions.find((img) => img.value === imageId)?.label ??
    "Select image";

  function onSubmit(values: CreateCubeFormValues) {
    startTransition(async () => {
      const result = await createCube(spaceId, {
        name: values.name.trim(),
        vcpus,
        ramMb,
        diskGb,
        imageId,
        regionId,
        sshPublicKey: values.sshPublicKey.trim(),
      });

      if ("error" in result && result.error) {
        form.setError("root", { message: result.error });
        return;
      }

      if ("success" in result && result.data) {
        toast.success("Cube created successfully");
        router.push(`/${spaceId}/cubes/${result.data.id}`);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
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
          <PageHeaderTitle>Create Cube</PageHeaderTitle>
          <PageHeaderDescription>
            Configure a lightweight micro VM with full SSH access.
          </PageHeaderDescription>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left column — form */}
            <div className="space-y-6 lg:col-span-2">
              {/* Name + Region row */}
              <Card>
                <CardContent className="pt-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input
                              disabled={isPending}
                              placeholder="my-cube"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormItem>
                      <FormLabel>Region</FormLabel>
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
                                {regions.find((r) => r.id === regionId)?.name ??
                                  "Select region"}
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
                    </FormItem>
                  </div>
                </CardContent>
              </Card>

              {/* Resources */}
              <Card>
                <CardHeader>
                  <CardTitle>Resources</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <p className="text-xs text-muted-foreground">
                    Your {planLimits.planName} plan allows up to {cpuRange.max}{" "}
                    vCPU · {formatRam(ramRange.max)} RAM · {diskRange.max} GB
                    disk per Cube. Upgrade your plan for larger Cubes.
                  </p>
                  <ResourceSlider
                    disabled={isPending}
                    formatValue={(v) => `${v} vCPU${v > 1 ? "s" : ""}`}
                    id="vcpus"
                    label="vCPUs"
                    onChange={setVcpus}
                    range={cpuRange}
                    value={vcpus}
                  />

                  <ResourceSlider
                    disabled={isPending}
                    formatValue={formatRam}
                    id="ram"
                    label="RAM"
                    onChange={setRamMb}
                    range={ramRange}
                    value={ramMb}
                  />

                  <ResourceSlider
                    disabled={isPending}
                    formatValue={(v) => `${v} GB`}
                    id="disk"
                    label="Disk"
                    onChange={setDiskGb}
                    range={diskRange}
                    value={diskGb}
                  />
                </CardContent>
              </Card>

              {/* Image */}
              <Card>
                <CardHeader>
                  <CardTitle>Image</CardTitle>
                </CardHeader>
                <CardContent>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild disabled={isPending}>
                      <Button
                        className="w-full justify-between font-normal"
                        type="button"
                        variant="outline"
                      >
                        {selectedImageLabel}
                        <CaretDownIcon className="size-4 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                      {cubeOptions.imageOptions.map((img) => (
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
                </CardContent>
              </Card>

              {/* SSH Key */}
              <Card>
                <CardHeader>
                  <CardTitle>SSH Key</CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="sshPublicKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Public Key</FormLabel>
                        <FormControl>
                          <Textarea
                            autoComplete="off"
                            className="min-h-24 font-mono text-xs"
                            disabled={isPending}
                            placeholder="ssh-ed25519 AAAA... user@host"
                            spellCheck={false}
                            {...field}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Paste the contents of your public key file (e.g.{" "}
                          <code className="font-mono">
                            ~/.ssh/id_ed25519.pub
                          </code>
                          ). It will be installed in the Cube&apos;s{" "}
                          <code className="font-mono">
                            /root/.ssh/authorized_keys
                          </code>{" "}
                          at boot. Don&apos;t have one? Run{" "}
                          <code className="font-mono">
                            ssh-keygen -t ed25519
                          </code>{" "}
                          in your terminal.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                    <SummaryRow
                      label="Region"
                      value={
                        regions.find((r) => r.id === regionId)?.name ?? "—"
                      }
                    />
                    <SummaryRow label="Image" value={selectedImageLabel} />

                    <Separator className="my-3" />

                    {multiplier < 1 && activeTier && (
                      <div className="mb-2 rounded-md bg-primary/10 px-3 py-2 text-sm">
                        <span className="font-medium text-primary">
                          {activeTier.label ?? "Volume Discount"}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          — {Math.round((1 - multiplier) * 100)}% off all rates
                        </span>
                      </div>
                    )}

                    <div className="space-y-0">
                      <ChargeRow
                        cost={cpuCost}
                        label={`${vcpus} vCPU${vcpus > 1 ? "s" : ""}`}
                        rate={`$${(creditRateConfig.vcpuRate * multiplier).toFixed(4)}/vCPU/hr`}
                      />
                      <ChargeRow
                        cost={ramCost}
                        label={`${formatRam(ramMb)} RAM`}
                        rate={`$${(creditRateConfig.ramRate * multiplier).toFixed(4)}/GB/hr`}
                      />
                      <ChargeRow
                        cost={diskCost}
                        label={`${diskGb} GB disk`}
                        rate={`$${(creditRateConfig.diskRate * multiplier).toFixed(4)}/GB/hr`}
                      />
                    </div>

                    <Separator className="my-3" />

                    <div className="space-y-1.5 py-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Hourly</span>
                        <span className="font-medium tabular-nums">
                          ${hourlyCost.toFixed(4)}/hr
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Daily est.
                        </span>
                        <span className="tabular-nums">
                          ${(hourlyCost * 24).toFixed(2)}/day
                        </span>
                      </div>
                      <div className="flex justify-between text-sm font-semibold">
                        <span>Monthly est.</span>
                        <span className="tabular-nums">
                          ${monthlyCost.toFixed(2)}/mo
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {form.formState.errors.root && (
                  <Alert variant="destructive">
                    <WarningIcon className="size-4" />
                    <AlertDescription>
                      {form.formState.errors.root.message}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  className="w-full"
                  disabled={!form.formState.isValid || !regionId || isPending}
                  size="lg"
                  type="submit"
                >
                  {isPending && <Spinner className="size-4" />}
                  Create Cube
                </Button>
                <Button
                  asChild
                  className="w-full"
                  disabled={isPending}
                  type="button"
                  variant="outline"
                >
                  <Link href={`/${spaceId}/cubes`}>Cancel</Link>
                </Button>
              </div>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function ChargeRow({
  label,
  rate,
  cost,
}: {
  label: string;
  rate: string;
  cost: number;
}) {
  return (
    <div className="border-b py-2.5 last:border-0">
      <div className="flex items-baseline justify-between">
        <span className="text-sm">{label}</span>
        <span className="text-sm font-medium tabular-nums">
          ${cost.toFixed(4)}/hr
        </span>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">{rate}</span>
      </div>
    </div>
  );
}
