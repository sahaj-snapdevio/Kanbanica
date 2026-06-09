"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowsClockwiseIcon,
  KeyIcon,
  LightningIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  createWebhook,
  deleteWebhook,
  redeliverWebhookDelivery,
  rotateWebhookSecret,
  setWebhookEnabled,
  testFireWebhook,
  updateWebhook,
} from "@/app/actions/outbound-webhooks";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
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
import { copyToClipboard } from "@/lib/clipboard";
import {
  groupedWebhookEvents,
  WEBHOOK_EVENT_VALUES,
} from "@/lib/webhook-events";

const formSchema = z.object({
  description: z.string().trim().max(120).optional(),
  url: z.string().trim().min(1, "URL is required").url("Must be a valid URL"),
  events: z
    .array(z.enum(WEBHOOK_EVENT_VALUES))
    .min(1, "Select at least one event"),
});

type FormValues = z.infer<typeof formSchema>;

export interface WebhookRow {
  consecutiveFailures: number;
  createdAt: Date;
  description: string | null;
  disabledReason: string | null;
  enabled: boolean;
  events: string[];
  id: string;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  url: string;
}

export interface DeliveryRow {
  attempts: number;
  createdAt: Date;
  event: string;
  id: string;
  lastAttemptAt: Date | null;
  responseStatus: number | null;
  status: "pending" | "delivered" | "failed";
}

interface WebhooksPageProps {
  deliveriesByEndpoint: Record<string, DeliveryRow[]>;
  initialWebhooks: WebhookRow[];
  spaceId: string;
}

const EVENT_GROUPS = groupedWebhookEvents();

export function WebhooksPage({
  spaceId,
  initialWebhooks,
  deliveriesByEndpoint,
}: WebhooksPageProps) {
  const [webhooks, setWebhooks] = useState(initialWebhooks);
  const [deliveries, setDeliveries] = useState(deliveriesByEndpoint);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [secretContext, setSecretContext] = useState<
    "create" | "rotate" | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rotateTargetId, setRotateTargetId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [prevPageSize, setPrevPageSize] = useState(pageSize);
  if (prevPageSize !== pageSize) {
    setPrevPageSize(pageSize);
    setPage(1);
  }
  const pageWindow = useMemo(() => {
    const start = (page - 1) * pageSize;
    return webhooks.slice(start, start + pageSize);
  }, [webhooks, page, pageSize]);

  const createForm = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { url: "", events: [], description: "" },
    mode: "onChange",
  });
  const editForm = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { url: "", events: [], description: "" },
    mode: "onChange",
  });

  function closeCreate() {
    setCreateOpen(false);
    createForm.reset({ url: "", events: [], description: "" });
    setGeneratedSecret(null);
    setSecretContext(null);
  }

  function openEdit(row: WebhookRow) {
    editForm.reset({
      url: row.url,
      events: row.events as FormValues["events"],
      description: row.description ?? "",
    });
    setEditId(row.id);
  }

  function closeEdit() {
    setEditId(null);
    editForm.reset({ url: "", events: [], description: "" });
  }

  async function handleCreate(values: FormValues) {
    const result = await createWebhook(
      spaceId,
      values.url,
      values.events,
      values.description ?? null
    );
    if ("error" in result) {
      createForm.setError("root", { message: result.error });
      return;
    }
    setGeneratedSecret(result.endpoint.secret);
    setSecretContext("create");
    setWebhooks((prev) => [
      {
        id: result.endpoint.id,
        url: result.endpoint.url,
        description: result.endpoint.description,
        events: result.endpoint.events,
        enabled: result.endpoint.enabled,
        consecutiveFailures: 0,
        disabledReason: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        createdAt: result.endpoint.createdAt,
      },
      ...prev,
    ]);
  }

  async function handleEdit(values: FormValues) {
    if (!editId) {
      return;
    }
    const result = await updateWebhook(spaceId, editId, {
      url: values.url,
      events: values.events,
      description: values.description ?? null,
    });
    if ("error" in result) {
      editForm.setError("root", { message: result.error });
      return;
    }
    setWebhooks((prev) =>
      prev.map((w) =>
        w.id === editId
          ? {
              ...w,
              url: result.endpoint.url,
              description: result.endpoint.description,
              events: result.endpoint.events,
            }
          : w
      )
    );
    toast.success("Webhook updated");
    closeEdit();
  }

  function handleToggle(id: string, enabled: boolean) {
    setBusyId(id);
    setWebhooks((prev) =>
      prev.map((w) =>
        w.id === id
          ? {
              ...w,
              enabled,
              consecutiveFailures: enabled ? 0 : w.consecutiveFailures,
              disabledReason: enabled ? null : "customer",
            }
          : w
      )
    );
    startTransition(async () => {
      const result = await setWebhookEnabled(spaceId, id, enabled);
      setBusyId(null);
      if ("error" in result) {
        setWebhooks((prev) =>
          prev.map((w) => (w.id === id ? { ...w, enabled: !enabled } : w))
        );
        toast.error(result.error);
        return;
      }
      toast.success(enabled ? "Webhook enabled" : "Webhook disabled");
    });
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    const result = await deleteWebhook(spaceId, id);
    setBusyId(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
    setDeliveries((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    toast.success("Webhook deleted");
  }

  async function handleRotate(id: string) {
    setBusyId(id);
    const result = await rotateWebhookSecret(spaceId, id);
    setBusyId(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setGeneratedSecret(result.secret);
    setSecretContext("rotate");
  }

  async function handleTestFire(id: string) {
    setBusyId(id);
    const result = await testFireWebhook(spaceId, id);
    setBusyId(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Test event queued — check Recent deliveries");
  }

  async function handleRedeliver(endpointId: string, deliveryId: string) {
    // Guard against a double-click re-queuing the same delivery twice (the
    // button had no in-flight disable). busyId is keyed on the delivery id.
    if (busyId === deliveryId) {
      return;
    }
    setBusyId(deliveryId);
    try {
      const result = await redeliverWebhookDelivery(
        spaceId,
        endpointId,
        deliveryId
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Delivery re-queued");
    } finally {
      setBusyId(null);
    }
  }

  function handleCopySecret() {
    if (generatedSecret) {
      copyToClipboard(generatedSecret, "Signing secret copied");
    }
  }

  const renderEventPicker = (
    fieldValue: string[],
    onChange: (next: string[]) => void
  ) => (
    <div className="space-y-4">
      {EVENT_GROUPS.map((group) => (
        <div className="space-y-2" key={group.category}>
          <p className="text-xs font-medium text-muted-foreground">
            {group.label}
          </p>
          <div className="space-y-2">
            {group.events.map((opt) => {
              const checked = fieldValue.includes(opt.value);
              return (
                // biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox renders as a button — implicit-child association is intentional
                <label
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-input p-2 hover:bg-muted"
                  key={opt.value}
                >
                  <Checkbox
                    checked={checked}
                    className="mt-0.5"
                    onCheckedChange={(state) => {
                      const next = new Set(fieldValue);
                      if (state) {
                        next.add(opt.value);
                      } else {
                        next.delete(opt.value);
                      }
                      onChange(Array.from(next));
                    }}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {opt.value}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {opt.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Webhooks</PageHeaderTitle>
          <PageHeaderDescription>
            Receive signed HTTP callbacks when entities in this space change.
          </PageHeaderDescription>
        </PageHeaderContent>
        <Sheet
          onOpenChange={(open) => {
            if (open) {
              setCreateOpen(true);
            } else {
              closeCreate();
            }
          }}
          open={createOpen}
        >
          <SheetTrigger asChild>
            <Button>
              <PlusIcon className="size-4" />
              Add Webhook
            </Button>
          </SheetTrigger>
          <SheetContent
            className="w-full sm:max-w-lg"
            onInteractOutside={(e) => e.preventDefault()}
            side="right"
          >
            <SheetHeader>
              <SheetTitle>Add webhook</SheetTitle>
              <SheetDescription>
                Choose events to subscribe to. We&apos;ll deliver them as signed
                POSTs.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4 overflow-y-auto px-4 pb-4">
              {generatedSecret && secretContext === "create" ? (
                <SecretReveal
                  onCopy={handleCopySecret}
                  onDone={closeCreate}
                  secret={generatedSecret}
                />
              ) : (
                <Form {...createForm}>
                  <form
                    className="space-y-4"
                    onSubmit={createForm.handleSubmit(handleCreate)}
                  >
                    {createForm.formState.errors.root && (
                      <Alert variant="destructive">
                        <WarningIcon className="size-4" />
                        <AlertDescription>
                          {createForm.formState.errors.root.message}
                        </AlertDescription>
                      </Alert>
                    )}
                    <FormField
                      control={createForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description (optional)</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. Production billing receiver"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="url"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Endpoint URL</FormLabel>
                          <FormControl>
                            <Input
                              autoFocus
                              placeholder="https://example.com/webhooks/krova"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="events"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Events</FormLabel>
                          {renderEventPicker(field.value, field.onChange)}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      className="w-full"
                      disabled={
                        !createForm.formState.isValid ||
                        createForm.formState.isSubmitting
                      }
                      type="submit"
                    >
                      {createForm.formState.isSubmitting && (
                        <Spinner className="size-4" />
                      )}
                      Add Webhook
                    </Button>
                  </form>
                </Form>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </PageHeader>

      {/* Edit sheet */}
      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            closeEdit();
          }
        }}
        open={editId !== null}
      >
        <SheetContent
          className="w-full sm:max-w-lg"
          onInteractOutside={(e) => e.preventDefault()}
          side="right"
        >
          <SheetHeader>
            <SheetTitle>Edit webhook</SheetTitle>
            <SheetDescription>
              Change URL, description, or subscribed events.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4 overflow-y-auto px-4 pb-4">
            <Form {...editForm}>
              <form
                className="space-y-4"
                onSubmit={editForm.handleSubmit(handleEdit)}
              >
                {editForm.formState.errors.root && (
                  <Alert variant="destructive">
                    <WarningIcon className="size-4" />
                    <AlertDescription>
                      {editForm.formState.errors.root.message}
                    </AlertDescription>
                  </Alert>
                )}
                <FormField
                  control={editForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Production billing receiver"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Endpoint URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://example.com/webhooks/krova"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="events"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Events</FormLabel>
                      {renderEventPicker(field.value, field.onChange)}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  className="w-full"
                  disabled={
                    !editForm.formState.isValid ||
                    !editForm.formState.isDirty ||
                    editForm.formState.isSubmitting
                  }
                  type="submit"
                >
                  {editForm.formState.isSubmitting && (
                    <Spinner className="size-4" />
                  )}
                  Save Changes
                </Button>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      {/* Rotate-secret reveal modal — reused inline AlertDialog */}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setGeneratedSecret(null);
            setSecretContext(null);
          }
        }}
        open={generatedSecret !== null && secretContext === "rotate"}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New signing secret</AlertDialogTitle>
            <AlertDialogDescription>
              Update your verifier with the new secret. The previous secret is
              no longer valid for any future delivery.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label>Signing Secret</Label>
            <div className="flex gap-1.5">
              <Input
                className="font-mono text-xs"
                readOnly
                value={generatedSecret ?? ""}
              />
              <Button onClick={handleCopySecret} size="sm" variant="outline">
                Copy
              </Button>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setGeneratedSecret(null);
                setSecretContext(null);
              }}
            >
              Done
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {webhooks.length === 0 ? (
        <Empty className="rounded-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LightningIcon className="size-5" />
            </EmptyMedia>
            <EmptyTitle>No webhooks yet</EmptyTitle>
            <EmptyDescription>
              Add a webhook endpoint to receive signed event notifications when
              cubes, snapshots, domains, members, or subscriptions change.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageWindow.map((w) => (
                <Fragment key={w.id}>
                  <TableRow>
                    <TableCell className="max-w-xs">
                      {w.description && (
                        <div className="text-sm font-medium">
                          {w.description}
                        </div>
                      )}
                      <div className="font-mono text-xs break-all text-muted-foreground">
                        {w.url}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {w.events.slice(0, 3).map((e) => (
                          <Badge
                            className="font-mono text-[10px]"
                            key={e}
                            variant="secondary"
                          >
                            {e}
                          </Badge>
                        ))}
                        {w.events.length > 3 && (
                          <Badge
                            className="font-mono text-[10px]"
                            variant="outline"
                          >
                            +{w.events.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {w.lastSuccessAt
                        ? `${formatDistanceToNow(new Date(w.lastSuccessAt), { addSuffix: true })} (ok)`
                        : w.lastFailureAt
                          ? `${formatDistanceToNow(new Date(w.lastFailureAt), { addSuffix: true })} (failed)`
                          : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={w.enabled}
                          disabled={busyId === w.id}
                          onCheckedChange={(state) => handleToggle(w.id, state)}
                        />
                        {!w.enabled &&
                          w.disabledReason === "consecutive_failures" && (
                            <Badge variant="destructive">Auto-disabled</Badge>
                          )}
                        {!w.enabled && w.disabledReason === "ssrf_blocked" && (
                          <Badge variant="destructive">SSRF blocked</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          disabled={busyId === w.id}
                          onClick={() => handleTestFire(w.id)}
                          size="icon-sm"
                          title="Send test event"
                          variant="ghost"
                        >
                          <PaperPlaneTiltIcon className="size-4" />
                        </Button>
                        <Button
                          disabled={busyId === w.id}
                          onClick={() => openEdit(w)}
                          size="icon-sm"
                          title="Edit"
                          variant="ghost"
                        >
                          <PencilSimpleIcon className="size-4" />
                        </Button>
                        <Button
                          disabled={busyId === w.id}
                          onClick={() => setRotateTargetId(w.id)}
                          size="icon-sm"
                          title="Rotate signing secret"
                          variant="ghost"
                        >
                          <KeyIcon className="size-4" />
                        </Button>
                        <Button
                          disabled={busyId === w.id}
                          onClick={() => setDeleteTargetId(w.id)}
                          size="icon-sm"
                          title="Delete"
                          variant="ghost"
                        >
                          <TrashIcon className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {deliveries[w.id]?.length ? (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell className="p-0" colSpan={5}>
                        <div className="px-4 py-3">
                          <p className="mb-2 text-xs font-medium text-muted-foreground">
                            Recent deliveries
                          </p>
                          <div className="space-y-1 text-xs">
                            {deliveries[w.id].slice(0, 5).map((d) => (
                              <div
                                className="flex items-center gap-3"
                                key={d.id}
                              >
                                <Badge
                                  className="font-mono"
                                  variant={
                                    d.status === "delivered"
                                      ? "outline"
                                      : d.status === "pending"
                                        ? "secondary"
                                        : "destructive"
                                  }
                                >
                                  {d.status}
                                </Badge>
                                <span className="font-mono text-muted-foreground">
                                  {d.event}
                                </span>
                                <span className="text-muted-foreground">
                                  {formatDistanceToNow(new Date(d.createdAt), {
                                    addSuffix: true,
                                  })}
                                </span>
                                <span className="text-muted-foreground">
                                  attempts: {d.attempts}
                                </span>
                                {d.responseStatus != null && (
                                  <span className="font-mono text-muted-foreground">
                                    HTTP {d.responseStatus}
                                  </span>
                                )}
                                {d.status === "failed" && (
                                  <Button
                                    disabled={busyId === d.id}
                                    onClick={() => handleRedeliver(w.id, d.id)}
                                    size="sm"
                                    variant="ghost"
                                  >
                                    <ArrowsClockwiseIcon className="size-3.5" />
                                    Redeliver
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            page={page}
            pageSize={pageSize}
            total={webhooks.length}
          />
        </>
      )}

      <ConfirmActionDialog
        busy={busyId === rotateTargetId}
        confirmLabel="Rotate"
        description={
          <p>
            The current secret will stop verifying future deliveries
            immediately. Make sure you can update your receiver before
            continuing.
          </p>
        }
        destructive={false}
        onConfirm={() => {
          if (rotateTargetId) {
            const id = rotateTargetId;
            setRotateTargetId(null);
            void handleRotate(id);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setRotateTargetId(null);
          }
        }}
        open={rotateTargetId !== null}
        title="Rotate signing secret"
      />

      <ConfirmActionDialog
        busy={busyId === deleteTargetId}
        confirmLabel="Delete"
        description={
          <p>
            Future events for the selected types will no longer be delivered
            here.
          </p>
        }
        onConfirm={() => {
          if (deleteTargetId) {
            const id = deleteTargetId;
            setDeleteTargetId(null);
            void handleDelete(id);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTargetId(null);
          }
        }}
        open={deleteTargetId !== null}
        title="Delete Webhook"
      />
    </div>
  );
}

interface SecretRevealProps {
  onCopy: () => void;
  onDone: () => void;
  secret: string;
}

function SecretReveal({ secret, onCopy, onDone }: SecretRevealProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
          Store this signing secret securely. It will not be shown again.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Signing Secret</Label>
        <div className="flex gap-1.5">
          <Input className="font-mono text-xs" readOnly value={secret} />
          <Button onClick={onCopy} size="sm" variant="outline">
            Copy
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Verify each delivery with HMAC-SHA256 of{" "}
          <code>{"{timestamp}.{body}"}</code> using this secret. The{" "}
          <code>X-Krova-Signature</code> header carries{" "}
          <code>t=&lt;unix&gt;,v1=&lt;sha256&gt;</code>.
        </p>
      </div>
      <Button className="w-full" onClick={onDone} variant="outline">
        Done
      </Button>
    </div>
  );
}
