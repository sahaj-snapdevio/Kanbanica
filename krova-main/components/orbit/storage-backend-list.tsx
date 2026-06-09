"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  HardDriveIcon,
  HeartbeatIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { useMutation } from "@/hooks/use-mutation";
import { formatBytes } from "@/lib/format";

interface StorageBackend {
  bucket: string;
  capacityGb: number | null;
  createdAt: string;
  endpoint: string;
  id: string;
  isActive: boolean;
  lastHealthCheck: string | null;
  name: string;
  region: string;
  updatedAt: string;
  usedBytes: number;
}

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  endpoint: z.string().url("Must be a valid https URL"),
  region: z.string().min(1, "Region is required"),
  bucket: z.string().min(3, "Bucket must be at least 3 characters"),
  accessKeyId: z.string().min(1, "Access key ID is required"),
  secretAccessKey: z.string().min(1, "Secret access key is required"),
  capacityGb: z.number().int().positive().optional(),
  isActive: z.boolean(),
});

const editSchema = z.object({
  name: z.string().min(1, "Name is required"),
  endpoint: z.string().url("Must be a valid https URL"),
  region: z.string().min(1, "Region is required"),
  bucket: z.string().min(3, "Bucket must be at least 3 characters"),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  capacityGb: z.number().int().positive().optional(),
  isActive: z.boolean(),
});

type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;

function BackendSheet({
  backend,
  trigger,
}: {
  backend?: StorageBackend;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { trigger: mutate, isMutating } = useMutation();

  const isEditing = !!backend;
  const schema = isEditing ? editSchema : createSchema;

  const form = useForm<CreateValues | EditValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: backend?.name ?? "",
      endpoint: backend?.endpoint ?? "",
      region: backend?.region ?? "",
      bucket: backend?.bucket ?? "",
      accessKeyId: "",
      secretAccessKey: "",
      capacityGb: backend?.capacityGb ?? undefined,
      isActive: backend?.isActive ?? true,
    },
    mode: "onChange",
  });

  const {
    formState: { isValid, isDirty },
  } = form;

  async function onSubmit(values: CreateValues | EditValues) {
    const body: Record<string, unknown> = {
      name: values.name,
      endpoint: values.endpoint,
      region: values.region,
      bucket: values.bucket,
      capacityGb: values.capacityGb ?? null,
      isActive: values.isActive,
    };
    if (values.accessKeyId && values.accessKeyId.trim().length > 0) {
      body.accessKeyId = values.accessKeyId;
    }
    if (values.secretAccessKey && values.secretAccessKey.trim().length > 0) {
      body.secretAccessKey = values.secretAccessKey;
    }

    if (isEditing && backend) {
      const data = await mutate({
        url: `/api/orbit/storage-backends/${backend.id}`,
        method: "PATCH",
        body,
        successMessage: `Backend "${values.name}" updated.`,
      });
      if (data === null) {
        form.setError("root", { message: "Failed to update backend" });
      } else {
        setOpen(false);
      }
    } else {
      const data = await mutate({
        url: "/api/orbit/storage-backends",
        method: "POST",
        body,
        successMessage: `Backend "${values.name}" created.`,
      });
      if (data === null) {
        form.setError("root", { message: "Failed to create backend" });
      } else {
        form.reset();
        setOpen(false);
      }
    }
  }

  const isSubmitDisabled = isEditing
    ? !isValid || !isDirty || isMutating
    : !isValid || isMutating;

  return (
    <Sheet
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          form.reset({
            name: backend?.name ?? "",
            endpoint: backend?.endpoint ?? "",
            region: backend?.region ?? "",
            bucket: backend?.bucket ?? "",
            accessKeyId: "",
            secretAccessKey: "",
            capacityGb: backend?.capacityGb ?? undefined,
            isActive: backend?.isActive ?? true,
          });
        }
      }}
      open={open}
    >
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {isEditing ? "Edit storage backend" : "Add storage backend"}
          </SheetTitle>
          <SheetDescription>
            {isEditing
              ? "Update this storage backend's configuration. Leave credentials blank to keep the existing ones."
              : "Add an S3-compatible storage backend for snapshot and backup storage."}
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="idrive-eu" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="endpoint"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Endpoint URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://s3.eu-central-1.idrivee2.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="region"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Region</FormLabel>
                  <FormControl>
                    <Input placeholder="eu-central-1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bucket"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bucket</FormLabel>
                  <FormControl>
                    <Input placeholder="krova-production" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="accessKeyId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Access key ID{isEditing ? " (leave blank to keep)" : ""}
                  </FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="off"
                      placeholder="AKIA..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="secretAccessKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Secret access key
                    {isEditing ? " (leave blank to keep)" : ""}
                  </FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="off"
                      placeholder="••••••••••••••••"
                      type="password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="capacityGb"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capacity (GB, optional)</FormLabel>
                  <FormControl>
                    <Input
                      className="w-40 font-mono"
                      min={1}
                      onChange={(e) => {
                        const v = e.target.value;
                        field.onChange(v === "" ? undefined : Number(v));
                      }}
                      type="number"
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormDescription>
                    Leave blank for unlimited. Used by backend selection to
                    avoid filling small buckets.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel className="mt-0!">Active</FormLabel>
                </FormItem>
              )}
            />

            <Button
              className="w-full"
              disabled={isSubmitDisabled}
              type="submit"
            >
              {isMutating && <Spinner className="size-4" />}
              {isEditing ? "Save changes" : "Add backend"}
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

function DeleteBackendDialog({
  backend,
  trigger,
}: {
  backend: StorageBackend;
  trigger: React.ReactNode;
}) {
  const [confirmName, setConfirmName] = useState("");
  const { trigger: mutate, isMutating } = useMutation();

  async function handleDelete() {
    await mutate({
      url: `/api/orbit/storage-backends/${backend.id}`,
      method: "DELETE",
      successMessage: `Backend "${backend.name}" deleted.`,
      errorMessage: "Failed to delete backend",
    });
    setConfirmName("");
  }

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          setConfirmName("");
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete storage backend</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the backend &ldquo;{backend.name}
            &rdquo;. The bucket itself is untouched. Type the name to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={backend.name}
          value={confirmName}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
            disabled={confirmName !== backend.name || isMutating}
            onClick={handleDelete}
          >
            {isMutating && <Spinner className="size-4" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function HealthCheckButton({ backend }: { backend: StorageBackend }) {
  const { trigger: mutate, isMutating } = useMutation();
  async function run() {
    await mutate({
      url: `/api/orbit/storage-backends/${backend.id}/health-check`,
      method: "POST",
      successMessage: `Probe ok for "${backend.name}".`,
      errorMessage: "Probe failed",
    });
  }
  return (
    <Button
      aria-label="Run health check"
      disabled={isMutating}
      onClick={run}
      size="icon-xs"
      variant="ghost"
    >
      {isMutating ? (
        <Spinner className="size-3.5" />
      ) : (
        <HeartbeatIcon className="size-3.5" />
      )}
    </Button>
  );
}

export function StorageBackendList({
  storageBackends,
}: {
  storageBackends: StorageBackend[];
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageWindow = useMemo(() => {
    const start = (page - 1) * pageSize;
    return storageBackends.slice(start, start + pageSize);
  }, [storageBackends, page, pageSize]);
  const [prevPageSize, setPrevPageSize] = useState(pageSize);
  if (prevPageSize !== pageSize) {
    setPrevPageSize(pageSize);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
          <p className="text-sm text-muted-foreground">
            S3-compatible object-storage backends for snapshot and backup
            storage.
          </p>
        </div>
        <BackendSheet
          trigger={
            <Button size="sm">
              <PlusIcon className="size-4" />
              Add backend
            </Button>
          }
        />
      </div>

      {storageBackends.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <HardDriveIcon className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No storage backends</EmptyTitle>
            <EmptyDescription>
              Add an S3-compatible backend to enable snapshot and backup
              storage.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Bucket</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last check</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageWindow.map((backend) => {
                const capacityBytes =
                  backend.capacityGb == null
                    ? null
                    : backend.capacityGb * 1024 ** 3;
                const usagePercent =
                  capacityBytes != null && capacityBytes > 0
                    ? Math.round((backend.usedBytes / capacityBytes) * 100)
                    : 0;

                return (
                  <TableRow key={backend.id}>
                    <TableCell className="font-medium">
                      {backend.name}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">
                        {backend.endpoint}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {backend.region}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">
                        {backend.bucket}
                      </span>
                    </TableCell>
                    <TableCell>
                      {capacityBytes == null ? (
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(backend.usedBytes)} used
                        </span>
                      ) : (
                        <div className="w-36 space-y-1">
                          <Progress className="h-2" value={usagePercent} />
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(backend.usedBytes)} /{" "}
                            {formatBytes(capacityBytes)} ({usagePercent}%)
                          </p>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {backend.isActive ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {backend.lastHealthCheck ? (
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(
                            new Date(backend.lastHealthCheck),
                            { addSuffix: true }
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Never
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <HealthCheckButton backend={backend} />
                        <BackendSheet
                          backend={backend}
                          trigger={
                            <Button
                              aria-label="Edit backend"
                              size="icon-xs"
                              variant="ghost"
                            >
                              <PencilSimpleIcon className="size-3.5" />
                            </Button>
                          }
                        />
                        <DeleteBackendDialog
                          backend={backend}
                          trigger={
                            <Button
                              aria-label="Delete backend"
                              size="icon-xs"
                              variant="ghost"
                            >
                              <TrashIcon className="size-3.5" />
                            </Button>
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="border-t p-2">
            <TablePagination
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              page={page}
              pageSize={pageSize}
              total={storageBackends.length}
            />
          </div>
        </div>
      )}
    </div>
  );
}
