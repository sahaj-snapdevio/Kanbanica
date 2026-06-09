"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CircleIcon,
  CircleNotchIcon,
  PlayIcon,
  StopIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { JobLogStream } from "@/components/orbit/job-log-stream";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useMutation } from "@/hooks/use-mutation";
import { usePusherChannel, usePusherEvent } from "@/hooks/use-pusher";
import {
  SETUP_PHASE_CONFIG,
  SETUP_PHASE_ORDER,
  type SetupPhase,
} from "@/lib/status-display";
import { cn } from "@/lib/utils";

type SetupStatus = "idle" | "running" | "failed";

interface ServerSetupCardProps {
  hostname: string;
  publicIp: string;
  serverId: string;
  setupError: string | null;
  setupPhase: SetupPhase;
  setupStartedAt: Date | null;
  setupStatus: SetupStatus;
}

const bootstrapSchema = z
  .object({
    initialPort: z.number().min(1).max(65_535),
    initialUser: z.string().min(1, "User is required"),
    authMethod: z.enum(["password", "key"]),
    password: z.string().optional(),
    privateKey: z.string().optional(),
  })
  .refine(
    (v) =>
      v.authMethod === "password"
        ? !!v.password && v.password.length > 0
        : !!v.privateKey && v.privateKey.length > 0,
    { message: "Provide a password or a private key", path: ["password"] }
  );

type BootstrapValues = z.infer<typeof bootstrapSchema>;

function PhaseIcon({
  state,
}: {
  state: "done" | "running" | "failed" | "pending";
}) {
  if (state === "done") {
    return (
      <CheckCircleIcon
        className="size-5 text-green-600 dark:text-green-400"
        weight="fill"
      />
    );
  }
  if (state === "running") {
    return (
      <CircleNotchIcon
        className="size-5 animate-spin text-blue-600 dark:text-blue-400"
        weight="bold"
      />
    );
  }
  if (state === "failed") {
    return (
      <WarningIcon
        className="size-5 text-red-600 dark:text-red-400"
        weight="fill"
      />
    );
  }
  return <CircleIcon className="size-5 text-muted-foreground" />;
}

export function ServerSetupCard({
  serverId,
  hostname,
  publicIp,
  setupPhase,
  setupStatus,
  setupError,
  setupStartedAt,
}: ServerSetupCardProps) {
  const router = useRouter();
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const { trigger: mutate, isMutating } = useMutation({
    onSuccess: () => router.refresh(),
  });

  // Live updates via Pusher + unconditional polling.
  //
  // Belt-and-suspenders refresh strategy:
  // 1. `setup.update` — emitted by setup-phase transitions (claim/complete/fail)
  // 2. `job.log` — emitted on every step; debounced to avoid 10× refreshes per phase
  // 3. Polling — every 4s **whenever this card is rendered** (i.e. setup is
  //    not yet "ready"). Originally we only polled when status==="running",
  //    but that left a hole: between worker job enqueue and worker claim
  //    (status="idle" → still idle for 1-3s), a missed `setup.update` Pusher
  //    event meant the UI never noticed the worker had picked up. The card
  //    is only visible during setup, so polling here costs nothing once the
  //    server is active.
  const channel = usePusherChannel(`private-server-${serverId}`);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleRefresh() {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = setTimeout(() => router.refresh(), 250);
  }
  usePusherEvent(channel, "setup.update", scheduleRefresh);
  usePusherEvent(channel, "job.log", scheduleRefresh);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [router]);

  useEffect(
    () => () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
    },
    []
  );

  if (setupPhase === "ready") {
    return null;
  }

  const currentIdx = SETUP_PHASE_ORDER.indexOf(
    setupPhase as Exclude<SetupPhase, "ready">
  );

  function phaseState(
    p: SetupPhase
  ): "done" | "running" | "failed" | "pending" {
    const idx = SETUP_PHASE_ORDER.indexOf(p as Exclude<SetupPhase, "ready">);
    if (idx < currentIdx) {
      return "done";
    }
    if (idx > currentIdx) {
      return "pending";
    }
    if (setupStatus === "running") {
      return "running";
    }
    if (setupStatus === "failed") {
      return "failed";
    }
    return "pending";
  }

  async function runNonBootstrapPhase() {
    await mutate({
      url: `/api/orbit/servers/${serverId}/setup`,
      method: "POST",
      successMessage: `Started ${SETUP_PHASE_CONFIG[setupPhase].label}`,
      errorMessage: "Failed to start phase",
    });
  }

  function handleRunClick() {
    if (setupPhase === "bootstrap") {
      setBootstrapOpen(true);
    } else {
      void runNonBootstrapPhase();
    }
  }

  async function confirmReset() {
    await mutate({
      url: `/api/orbit/servers/${serverId}/setup/reset`,
      method: "POST",
      successMessage: "Phase reset — verify state via SSH before retrying",
      errorMessage: "Failed to reset phase",
    });
    setResetOpen(false);
  }

  const isRunning = setupStatus === "running";
  const isFailed = setupStatus === "failed";
  const buttonLabel = isFailed
    ? `Retry: ${SETUP_PHASE_CONFIG[setupPhase].label}`
    : `Run: ${SETUP_PHASE_CONFIG[setupPhase].label}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Phased Setup</span>
          <Badge className="capitalize" variant="secondary">
            {setupStatus}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Set up <span className="font-mono">{hostname}</span> ({publicIp}) one
          phase at a time. Each phase is idempotent — you can safely retry on
          failure without redoing prior phases.
        </p>

        {/* Vertical stepper — each phase is a step on a continuous rail.
            The rail color reflects the running/done state, so visual
            progress is immediately legible without reading each label. */}
        <ol className="relative space-y-0">
          {SETUP_PHASE_ORDER.map((p, i) => {
            const state = phaseState(p);
            const isLast = i === SETUP_PHASE_ORDER.length - 1;
            const railClass =
              state === "done"
                ? "bg-green-500/40"
                : state === "running"
                  ? "bg-blue-500/40"
                  : state === "failed"
                    ? "bg-red-500/40"
                    : "bg-border";
            return (
              <li
                className={cn(
                  "relative flex gap-4 pb-6 last:pb-0",
                  state === "running" && "text-foreground"
                )}
                key={p}
              >
                {!isLast && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-6 bottom-0 left-2.5 w-px",
                      railClass
                    )}
                  />
                )}
                <div
                  className={cn(
                    "relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background",
                    state === "running" && "ring-2 ring-blue-500/40",
                    state === "failed" && "ring-2 ring-red-500/40"
                  )}
                >
                  <PhaseIcon state={state} />
                </div>
                <div
                  className={cn(
                    "flex-1 space-y-1 rounded-md border p-3",
                    state === "running" && "border-blue-500/30 bg-blue-500/5",
                    state === "failed" && "border-red-500/30 bg-red-500/5",
                    state === "done" && "border-green-500/20",
                    state === "pending" && "border-border"
                  )}
                >
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      {SETUP_PHASE_CONFIG[p].label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {SETUP_PHASE_CONFIG[p].description}
                    </div>
                  </div>
                  {state === "running" && setupStartedAt && (
                    <div className="text-xs text-blue-600 dark:text-blue-400">
                      Started {new Date(setupStartedAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {isFailed && setupError && (
          <Alert variant="destructive">
            <AlertDescription className="font-mono text-xs whitespace-pre-wrap">
              {setupError}
            </AlertDescription>
          </Alert>
        )}

        <JobLogStream
          channelName={`private-server-${serverId}`}
          logsUrl={`/api/orbit/servers/${serverId}/job-logs?limit=500`}
        />

        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={isRunning || isMutating}
            onClick={handleRunClick}
          >
            {(isRunning || isMutating) && <Spinner className="mr-1 size-4" />}
            {!isRunning && !isMutating && isFailed && (
              <ArrowClockwiseIcon className="mr-1 size-4" />
            )}
            {!isRunning && !isMutating && !isFailed && (
              <PlayIcon className="mr-1 size-4" />
            )}
            {isRunning ? "Running..." : buttonLabel}
          </Button>
          {isRunning && (
            <Button
              disabled={isMutating}
              onClick={() => setResetOpen(true)}
              variant="outline"
            >
              <StopIcon className="size-4" />
              Reset
            </Button>
          )}
        </div>

        <BootstrapCredsSheet
          onOpenChange={setBootstrapOpen}
          onSuccess={() => {
            setBootstrapOpen(false);
            router.refresh();
          }}
          open={bootstrapOpen}
          publicIp={publicIp}
          serverId={serverId}
        />

        <AlertDialog onOpenChange={setResetOpen} open={resetOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Reset stuck phase &quot;{setupPhase}&quot;?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This marks the row as failed in the database so you can retry.
                It does NOT actually stop the worker — the underlying operation
                (SSH command, file transfer, etc.) may still be running on{" "}
                <span className="font-mono">{hostname}</span>. Verify the
                server&apos;s state via SSH or the activity log below before
                clicking Retry, otherwise you risk concurrent phases stepping on
                each other.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={isMutating}
                onClick={() => void confirmReset()}
              >
                {isMutating && <Spinner className="mr-1 size-4" />}
                Reset to Failed
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function BootstrapCredsSheet({
  open,
  onOpenChange,
  serverId,
  publicIp,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  serverId: string;
  publicIp: string;
  onSuccess: () => void;
}) {
  const { trigger: mutate, isMutating } = useMutation();

  const form = useForm<BootstrapValues>({
    resolver: zodResolver(bootstrapSchema),
    defaultValues: {
      initialPort: 22,
      initialUser: "root",
      authMethod: "password",
      password: "",
      privateKey: "",
    },
    mode: "onChange",
  });

  const authMethod = useWatch({ control: form.control, name: "authMethod" });

  async function onSubmit(values: BootstrapValues) {
    const payload: Record<string, unknown> = {
      initialPort: values.initialPort,
      initialUser: values.initialUser,
    };
    if (values.authMethod === "password") {
      payload.password = values.password;
    } else {
      payload.privateKey = values.privateKey;
    }

    const data = await mutate({
      url: `/api/orbit/servers/${serverId}/setup`,
      method: "POST",
      body: payload,
      successMessage: "Bootstrap started",
    });
    if (data === null) {
      form.setError("root", { message: "Failed to start bootstrap" });
    } else {
      form.reset();
      onSuccess();
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Bootstrap SSH</SheetTitle>
          <SheetDescription>
            Provide the credentials currently working for{" "}
            <span className="font-mono">{publicIp}</span>. They are used once
            and not stored — after this phase succeeds the server is locked to
            the platform key on port 2822.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="mt-6 space-y-4 px-4 pb-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="initialPort"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Initial Port</FormLabel>
                    <FormControl>
                      <Input
                        max={65_535}
                        min={1}
                        type="number"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? 0
                              : Number.parseInt(e.target.value, 10)
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="initialUser"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>User</FormLabel>
                    <FormControl>
                      <Input placeholder="root" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="authMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Authentication</FormLabel>
                  <FormControl>
                    <RadioGroup
                      className="grid grid-cols-2 gap-2"
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <div className="flex items-center gap-2 rounded-md border p-2">
                        <RadioGroupItem id="auth-password" value="password" />
                        <Label
                          className="cursor-pointer text-sm font-normal"
                          htmlFor="auth-password"
                        >
                          Password
                        </Label>
                      </div>
                      <div className="flex items-center gap-2 rounded-md border p-2">
                        <RadioGroupItem id="auth-key" value="key" />
                        <Label
                          className="cursor-pointer text-sm font-normal"
                          htmlFor="auth-key"
                        >
                          SSH key
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )}
            />

            {authMethod === "password" ? (
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="privateKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Private Key</FormLabel>
                    <FormControl>
                      <Textarea
                        className="font-mono text-xs"
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                        rows={6}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button
              className="w-full"
              disabled={!form.formState.isValid || isMutating}
              type="submit"
            >
              {isMutating && <Spinner className="size-4" />}
              Start Bootstrap
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
