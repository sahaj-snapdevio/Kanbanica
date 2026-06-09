"use client";

/**
 * Admin sheet for transferring a Cube to another server within the same
 * region. Capacity preview per candidate matches the eligibility math in
 * `/api/orbit/cubes/[cubeId]/transfer-targets`. Submission enqueues a
 * `cube.transfer` job; live progress streams via the JobLogStream mounted
 * on the orbit cube detail page (channel `private-cube-{cubeId}`).
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { CaretDownIcon } from "@phosphor-icons/react";
import { Fragment, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import useSWR from "swr";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { fetcher } from "@/lib/fetcher";

const schema = z.object({
  destinationServerId: z.string().min(1, "Pick a destination server"),
  confirm: z.literal(true, { message: "Confirm to proceed" }),
});

type FormValues = z.infer<typeof schema>;

interface TransferTarget {
  capacity: {
    cpu: { allocated: number; max: number };
    ram: { allocated: number; max: number };
    disk: { allocated: number; max: number };
  };
  id: string;
  name: string;
  region: string;
}

interface CubeProps {
  diskLimitGb: number;
  id: string;
  name: string;
  ramMb: number;
  vcpus: number;
}

export function CubeTransferSheet({
  cube,
  open,
  onOpenChange,
}: {
  cube: CubeProps;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const { data, isLoading, error } = useSWR<{ servers: TransferTarget[] }>(
    open ? `/api/orbit/cubes/${cube.id}/transfer-targets` : null,
    fetcher
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      destinationServerId: "",
      confirm: undefined as unknown as true,
    },
    mode: "onChange",
  });

  const targets = data?.servers ?? [];
  const selectedId = useWatch({
    control: form.control,
    name: "destinationServerId",
  });
  const selected = targets.find((t) => t.id === selectedId);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const res = await fetch(`/api/orbit/cubes/${cube.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationServerId: values.destinationServerId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        form.setError("root", {
          message:
            typeof body.error === "string"
              ? body.error
              : "Transfer failed to start",
        });
        return;
      }
      toast.success("Transfer started");
      form.reset();
      onOpenChange(false);
    });
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset();
    }
    onOpenChange(next);
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Transfer cube to another server</SheetTitle>
          <SheetDescription>
            Snapshots the rootfs, restores it on the destination, then migrates
            network identity. The cube is offline for several minutes.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form className="space-y-4 px-4 pb-4" onSubmit={onSubmit}>
            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground">Cube</div>
              <div className="font-medium">{cube.name}</div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {cube.vcpus} vCPU · {cube.ramMb} MB RAM · {cube.diskLimitGb} GB
                disk
              </div>
            </div>

            <FormField
              control={form.control}
              name="destinationServerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Destination server</FormLabel>
                  <FormControl>
                    {isLoading ? (
                      <Button
                        className="w-full justify-between font-normal"
                        disabled
                        type="button"
                        variant="outline"
                      >
                        <span className="flex items-center gap-2">
                          <Spinner className="size-3" />
                          Loading targets…
                        </span>
                      </Button>
                    ) : error ? (
                      <Alert variant="destructive">
                        <AlertDescription>
                          {error instanceof Error
                            ? error.message
                            : "Failed to load eligible servers"}
                        </AlertDescription>
                      </Alert>
                    ) : targets.length === 0 ? (
                      <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                        No eligible destination servers in this region. The
                        destination must be active, ready, and have capacity
                        headroom for this cube.
                      </div>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            className="w-full justify-between font-normal"
                            type="button"
                            variant="outline"
                          >
                            <span className="truncate">
                              {selected ? selected.name : "Choose a server"}
                            </span>
                            <CaretDownIcon className="size-4 opacity-50" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                          <DropdownMenuRadioGroup
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            {targets.map((t) => (
                              <Fragment key={t.id}>
                                <DropdownMenuRadioItem
                                  className="flex flex-col items-start gap-1 py-2"
                                  value={t.id}
                                >
                                  <span className="font-medium">{t.name}</span>
                                  <span className="text-xs text-muted-foreground tabular-nums">
                                    {formatCapacity(t.capacity.cpu)} vCPU ·{" "}
                                    {formatCapacityMb(t.capacity.ram)} RAM ·{" "}
                                    {formatCapacity(t.capacity.disk)} GB disk
                                  </span>
                                </DropdownMenuRadioItem>
                              </Fragment>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value === true}
                        id="cube-transfer-confirm"
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true ? true : undefined)
                        }
                      />
                    </FormControl>
                    <Label
                      className="cursor-pointer text-sm leading-snug font-normal"
                      htmlFor="cube-transfer-confirm"
                    >
                      I understand this takes the cube offline for several
                      minutes.
                    </Label>
                  </div>
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

            <div className="flex items-center justify-end gap-2">
              <Button
                disabled={isPending}
                onClick={() => handleOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  !form.formState.isValid || isPending || targets.length === 0
                }
                type="submit"
              >
                {isPending && <Spinner className="size-4" />}
                Start transfer
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

function formatCapacity(c: { allocated: number; max: number }): string {
  return `${formatNumber(c.allocated)}/${formatNumber(c.max)}`;
}

function formatCapacityMb(c: { allocated: number; max: number }): string {
  const allocatedGb = c.allocated / 1024;
  const maxGb = c.max / 1024;
  return `${formatNumber(allocatedGb)}/${formatNumber(maxGb)} GB`;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) {
    return String(n);
  }
  return n.toFixed(1);
}
