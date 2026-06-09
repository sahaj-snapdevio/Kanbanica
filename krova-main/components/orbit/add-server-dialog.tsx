"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CaretDownIcon, InfoIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
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
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useMutation } from "@/hooks/use-mutation";

const positiveNum = z.number().min(1, "Must be at least 1");

const addServerSchema = z.object({
  hostname: z
    .string()
    .trim()
    .min(1, "Hostname is required")
    .max(63, "Max 63 characters")
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
      "Lowercase letters, digits and hyphens only (a valid DNS label)"
    ),
  publicIp: z.string().min(1, "Public IP is required"),
  regionId: z.string().min(1, "Region is required"),
  sshKeyId: z.string().min(1, "SSH key is required"),
  maxCpuOvercommit: positiveNum,
  maxRamOvercommit: positiveNum,
});

type AddServerValues = z.infer<typeof addServerSchema>;

interface AddServerSheetProps {
  regions: { id: string; name: string; slug: string }[];
  sshKeys: { id: string; name: string }[];
}

export function AddServerSheet({ regions, sshKeys }: AddServerSheetProps) {
  const [open, setOpen] = useState(false);
  const { trigger, isMutating } = useMutation();

  const form = useForm<AddServerValues>({
    resolver: zodResolver(addServerSchema),
    defaultValues: {
      hostname: "",
      publicIp: "",
      regionId: regions[0]?.id ?? "",
      sshKeyId: sshKeys[0]?.id ?? "",
      maxCpuOvercommit: 2,
      maxRamOvercommit: 1,
    },
    mode: "onChange",
  });

  const {
    formState: { isValid },
  } = form;

  const watchedRegionId = useWatch({ control: form.control, name: "regionId" });
  const watchedSshKeyId = useWatch({
    control: form.control,
    name: "sshKeyId",
  });
  const selectedRegionLabel =
    regions.find((r) => r.id === watchedRegionId)?.name ?? "Select region";
  const selectedSshKeyLabel =
    sshKeys.find((k) => k.id === watchedSshKeyId)?.name ?? "Select SSH key";

  async function onSubmit(values: AddServerValues) {
    const data = await trigger({
      url: "/api/orbit/servers",
      method: "POST",
      body: {
        hostname: values.hostname,
        publicIp: values.publicIp,
        regionId: values.regionId,
        sshKeyId: values.sshKeyId,
        maxCpuOvercommit: values.maxCpuOvercommit,
        maxRamOvercommit: values.maxRamOvercommit,
      },
      successMessage: `Server "${values.hostname}" created as inactive.`,
    });

    if (data === null) {
      form.setError("root", {
        message: "Failed to add server",
      });
    } else {
      form.reset();
      setOpen(false);
    }
  }

  return (
    <Sheet
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          form.reset();
        }
      }}
      open={open}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <PlusIcon className="size-4" />
          Create Server
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Server</SheetTitle>
          <SheetDescription>
            Register a new bare-metal server for Cube hosting.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="space-y-4 px-4 pb-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="hostname"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hostname</FormLabel>
                  <FormControl>
                    <Input placeholder="sv-us-east-01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="publicIp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Public IP</FormLabel>
                  <FormControl>
                    <Input placeholder="203.0.113.10" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="regionId"
              render={() => (
                <FormItem>
                  <FormLabel>Region</FormLabel>
                  <FormControl>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="w-full justify-between font-normal"
                          type="button"
                          variant="outline"
                        >
                          {selectedRegionLabel}
                          <CaretDownIcon className="size-4 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                        {regions.map((r) => (
                          <DropdownMenuItem
                            key={r.id}
                            onClick={() =>
                              form.setValue("regionId", r.id, {
                                shouldValidate: true,
                              })
                            }
                          >
                            {r.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sshKeyId"
              render={() => (
                <FormItem>
                  <FormLabel>SSH Key</FormLabel>
                  <FormControl>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="w-full justify-between font-normal"
                          type="button"
                          variant="outline"
                        >
                          {selectedSshKeyLabel}
                          <CaretDownIcon className="size-4 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                        {sshKeys.length === 0 ? (
                          <DropdownMenuItem disabled>
                            No SSH keys available
                          </DropdownMenuItem>
                        ) : (
                          sshKeys.map((k) => (
                            <DropdownMenuItem
                              key={k.id}
                              onClick={() =>
                                form.setValue("sshKeyId", k.id, {
                                  shouldValidate: true,
                                })
                              }
                            >
                              {k.name}
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="maxCpuOvercommit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CPU Overcommit</FormLabel>
                    <FormControl>
                      <Input
                        min={1}
                        name={field.name}
                        onBlur={field.onBlur}
                        onChange={(e) =>
                          field.onChange(e.target.valueAsNumber || "")
                        }
                        ref={field.ref}
                        step={0.1}
                        type="number"
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxRamOvercommit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RAM Overcommit</FormLabel>
                    <FormControl>
                      <Input
                        min={1}
                        name={field.name}
                        onBlur={field.onBlur}
                        onChange={(e) =>
                          field.onChange(e.target.valueAsNumber || "")
                        }
                        ref={field.ref}
                        step={0.1}
                        type="number"
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Alert>
              <InfoIcon className="size-4" />
              <AlertDescription>
                Ensure DNS for this server&apos;s hostname points to the server
                IP before adding.
              </AlertDescription>
            </Alert>

            <Button
              className="w-full"
              disabled={!isValid || isMutating}
              type="submit"
            >
              {isMutating && <Spinner className="size-4" />}
              {isMutating ? "Creating..." : "Create Server"}
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
