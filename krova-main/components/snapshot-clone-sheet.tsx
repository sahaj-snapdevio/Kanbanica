"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { cloneSnapshotToNewCube } from "@/app/actions/snapshots";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { PlanCubeLimits } from "@/lib/cube-options";

interface Props {
  cubeId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  planLimits: PlanCubeLimits;
  regions: { id: string; name: string }[];
  snapshotId: string;
  /** Pre-fills resource defaults so customer can submit without changes. */
  sourceCube: {
    diskLimitGb: number;
    ramMb: number;
    vcpus: number;
  };
  spaceId: string;
}

export function SnapshotCloneSheet({
  open,
  onOpenChange,
  spaceId,
  cubeId,
  snapshotId,
  sourceCube,
  regions,
  planLimits,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Disk: cannot shrink below source (ext4 corruption); cap at plan max.
  const schema = z.object({
    name: z.string().trim().min(1, "Name is required").max(64),
    regionId: z.string().min(1, "Region is required"),
    vcpus: z
      .number()
      .int()
      .min(1)
      .max(planLimits.maxVcpus, `Plan max is ${planLimits.maxVcpus} vCPU`),
    ramMb: z
      .number()
      .int()
      .min(512)
      .max(
        planLimits.maxRamMb,
        `Plan max is ${(planLimits.maxRamMb / 1024).toFixed(0)} GB RAM`
      ),
    diskLimitGb: z
      .number()
      .int()
      .min(
        sourceCube.diskLimitGb,
        `Disk cannot shrink below the source's ${sourceCube.diskLimitGb} GB`
      )
      .max(planLimits.maxDiskGb, `Plan max is ${planLimits.maxDiskGb} GB disk`),
    sshPublicKey: z
      .string()
      .trim()
      .min(20, "Paste a valid SSH public key")
      .max(4096),
  });
  type Values = z.infer<typeof schema>;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      name: "",
      regionId: regions[0]?.id ?? "",
      vcpus: Math.min(sourceCube.vcpus, planLimits.maxVcpus),
      ramMb: Math.min(sourceCube.ramMb, planLimits.maxRamMb),
      diskLimitGb: Math.min(
        Math.max(sourceCube.diskLimitGb, sourceCube.diskLimitGb),
        planLimits.maxDiskGb
      ),
      sshPublicKey: "",
    },
  });

  // Synchronous double-submit guard: isPending only flips after startTransition
  // begins, so a same-tick double-click (or Enter+click) could dispatch the
  // clone twice → two cubes provisioned. The ref rejects the 2nd synchronously.
  const submittingRef = useRef(false);
  function onSubmit(values: Values) {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const result = await cloneSnapshotToNewCube(
          spaceId,
          cubeId,
          snapshotId,
          values
        );
        if ("error" in result) {
          form.setError("root", { message: result.error });
          return;
        }
        toast.success("Cloning — your new cube is provisioning.");
        onOpenChange(false);
        router.push(`/${spaceId}/cubes/${result.data.cubeId}`);
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Clone snapshot to new cube</SheetTitle>
          <SheetDescription>
            Spins up a fresh cube from this snapshot. Disk can grow but never
            shrink below {sourceCube.diskLimitGb} GB. The new cube starts with a
            blank network: no custom domains, no TCP port mappings (only SSH).
            Add them after the cube boots.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="mt-4 space-y-4 px-4 pb-6"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New cube name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="regionId"
              render={({ field }) => {
                const selected = regions.find((r) => r.id === field.value);
                return (
                  <FormItem>
                    <FormLabel>Region</FormLabel>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="w-full justify-between"
                          type="button"
                          variant="outline"
                        >
                          {selected?.name ?? "Select region"}
                          <CaretDownIcon className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                        {regions.map((r) => (
                          <DropdownMenuItem
                            key={r.id}
                            onSelect={() => field.onChange(r.id)}
                          >
                            {r.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="vcpus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>vCPUs</FormLabel>
                  <FormControl>
                    <Input
                      max={planLimits.maxVcpus}
                      min={1}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      type="number"
                      value={field.value}
                    />
                  </FormControl>
                  <FormDescription>
                    1 – {planLimits.maxVcpus} (plan max)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ramMb"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RAM (MB)</FormLabel>
                  <FormControl>
                    <Input
                      max={planLimits.maxRamMb}
                      min={512}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      step={512}
                      type="number"
                      value={field.value}
                    />
                  </FormControl>
                  <FormDescription>
                    Up to {(planLimits.maxRamMb / 1024).toFixed(0)} GB (plan
                    max)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="diskLimitGb"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Disk (GB)</FormLabel>
                  <FormControl>
                    <Input
                      max={planLimits.maxDiskGb}
                      min={sourceCube.diskLimitGb}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      type="number"
                      value={field.value}
                    />
                  </FormControl>
                  <FormDescription>
                    {sourceCube.diskLimitGb} – {planLimits.maxDiskGb} GB (can
                    grow, cannot shrink)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sshPublicKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SSH public key</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="ssh-ed25519 AAAA…"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Overwrites the source cube&apos;s authorized_keys in the new
                    cube.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}
            <Button
              className="w-full"
              disabled={!form.formState.isValid || isPending}
              type="submit"
            >
              {isPending && <Spinner className="size-4" />}
              Clone to new cube
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
