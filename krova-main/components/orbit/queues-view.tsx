"use client";

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  ProhibitIcon,
  SpinnerIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Stat } from "@/components/ui/stat";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { fetcher } from "@/lib/fetcher";

interface QueueSummary {
  active: number;
  failed: number;
  name: string;
  queued: number;
  retry: number;
  schedule: string | null;
}

interface ScheduleInfo {
  cron: string;
  name: string;
  timezone: string;
}

interface JobInfo {
  completedOn: string | null;
  createdOn: string | null;
  data: Record<string, unknown>;
  expireInSeconds: number;
  id: string;
  name: string;
  priority: number;
  retryCount: number;
  retryDelay: number;
  retryLimit: number;
  startAfter: string | null;
  startedOn: string | null;
  state: string;
}

const STATE_FILTER_OPTIONS = [
  { value: "all", label: "All states" },
  { value: "failed", label: "Failed" },
  { value: "retry", label: "Retry" },
  { value: "active", label: "Active" },
  { value: "created", label: "Queued" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const STATE_COLORS: Record<string, string> = {
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  retry:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  active: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  created: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  completed:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  cancelled: "bg-muted text-muted-foreground",
};

function StateBadge({ state }: { state: string }) {
  return (
    <Badge
      className={`text-xs font-medium ${STATE_COLORS[state] ?? ""}`}
      variant="secondary"
    >
      {state}
    </Badge>
  );
}

function StateIcon({ state }: { state: string }) {
  switch (state) {
    case "failed":
      return <XCircleIcon className="size-4 text-red-500" weight="fill" />;
    case "retry":
      return <ArrowCounterClockwiseIcon className="size-4 text-yellow-500" />;
    case "active":
      return <SpinnerIcon className="size-4 animate-spin text-blue-500" />;
    case "completed":
      return (
        <CheckCircleIcon className="size-4 text-green-500" weight="fill" />
      );
    case "cancelled":
      return <ProhibitIcon className="size-4 text-gray-400" />;
    default:
      return <ClockIcon className="size-4 text-gray-400" />;
  }
}

function formatDate(iso: string | null) {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatAgo(iso: string | null) {
  if (!iso) {
    return "";
  }
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) {
    return "scheduled";
  }
  if (ms < 60_000) {
    return `${Math.floor(ms / 1000)}s ago`;
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ago`;
  }
  if (ms < 86_400_000) {
    return `${Math.floor(ms / 3_600_000)}h ago`;
  }
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

interface OverviewResponse {
  queues: QueueSummary[];
  schedules: ScheduleInfo[];
}

interface JobsResponse {
  jobs: JobInfo[];
  total: number;
}

export function QueuesView() {
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const {
    data: overview,
    isLoading: loading,
    mutate: refetchOverview,
  } = useSWR<OverviewResponse>("/api/orbit/queues", fetcher, {
    onError: () => toast.error("Failed to load queue data"),
  });
  const queues = overview?.queues ?? [];
  const schedules = overview?.schedules ?? [];
  const [queuesPage, setQueuesPage] = useState(1);
  const [queuesPageSize, setQueuesPageSize] = useState(10);
  const queuesPageWindow = useMemo(() => {
    const start = (queuesPage - 1) * queuesPageSize;
    return queues.slice(start, start + queuesPageSize);
  }, [queues, queuesPage, queuesPageSize]);
  const [prevQueuesPageSize, setPrevQueuesPageSize] = useState(queuesPageSize);
  if (prevQueuesPageSize !== queuesPageSize) {
    setPrevQueuesPageSize(queuesPageSize);
    setQueuesPage(1);
  }

  const jobsParams = new URLSearchParams({
    queue: selectedQueue ?? "",
    limit: "100",
  });
  if (stateFilter !== "all") {
    jobsParams.set("state", stateFilter);
  }
  const {
    data: jobsData,
    isLoading: jobsLoading,
    mutate: refetchJobs,
  } = useSWR<JobsResponse>(
    selectedQueue ? `/api/orbit/queues?${jobsParams.toString()}` : null,
    fetcher,
    { onError: () => toast.error("Failed to load jobs") }
  );
  const jobs = jobsData?.jobs ?? [];
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsPageSize, setJobsPageSize] = useState(10);
  const jobsPageWindow = useMemo(() => {
    const start = (jobsPage - 1) * jobsPageSize;
    return jobs.slice(start, start + jobsPageSize);
  }, [jobs, jobsPage, jobsPageSize]);
  const [prevJobsPageSize, setPrevJobsPageSize] = useState(jobsPageSize);
  if (prevJobsPageSize !== jobsPageSize) {
    setPrevJobsPageSize(jobsPageSize);
    setJobsPage(1);
  }
  const jobsTotal = jobsData?.total ?? 0;

  const handleAction = async (
    action: "retry" | "cancel",
    queue: string,
    jobId: string
  ) => {
    setActionLoading(jobId);
    try {
      const res = await fetch("/api/orbit/queues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, queue, jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Action failed");
        return;
      }
      toast.success(data.message);
      // Refresh both overview and job list
      refetchOverview();
      if (selectedQueue) {
        refetchJobs();
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? `Action failed: ${err.message}` : "Action failed"
      );
    } finally {
      setActionLoading(null);
    }
  };

  const [bulkRetryLoading, setBulkRetryLoading] = useState<string | null>(null);
  const handleBulkRetry = async (queue: string) => {
    setBulkRetryLoading(queue);
    try {
      const res = await fetch("/api/orbit/queues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "retry_all_failed",
          queue,
          jobId: "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Bulk retry failed");
        return;
      }
      toast.success(data.message);
      refetchOverview();
      if (selectedQueue === queue) {
        refetchJobs();
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Bulk retry failed: ${err.message}`
          : "Bulk retry failed"
      );
    } finally {
      setBulkRetryLoading(null);
    }
  };

  const toggleExpanded = (jobId: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  // Compute summary stats
  const totalFailed = queues.reduce((s, q) => s + q.failed, 0);
  const totalActive = queues.reduce((s, q) => s + q.active, 0);
  const totalRetry = queues.reduce((s, q) => s + q.retry, 0);
  const totalQueued = queues.reduce((s, q) => s + q.queued, 0);
  const scheduledQueues = schedules.length;

  return (
    <div className="space-y-6">
      {/* Summary stat strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat
          label="Failed"
          tone={totalFailed > 0 ? "destructive" : "default"}
          value={loading ? "—" : totalFailed}
        />
        <Stat label="Active" value={loading ? "—" : totalActive} />
        <Stat
          label="Retry"
          tone={totalRetry > 0 ? "warning" : "default"}
          value={loading ? "—" : totalRetry}
        />
        <Stat label="Queued" value={loading ? "—" : totalQueued} />
        <Stat label="Scheduled" value={loading ? "—" : scheduledQueues} />
      </div>

      {/* Queue overview table */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Queues</h2>
        <Button
          disabled={loading}
          onClick={() => {
            refetchOverview();
            if (selectedQueue) {
              refetchJobs();
            }
          }}
          size="sm"
          variant="outline"
        >
          <ArrowClockwiseIcon className="mr-1.5 size-4" />
          Refresh
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Queue</TableHead>
              <TableHead className="text-center">Failed</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-center">Retry</TableHead>
              <TableHead className="text-center">Queued</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead className="w-30 text-right">
                <span className="sr-only">Bulk actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  className="py-8 text-center text-muted-foreground"
                  colSpan={6}
                >
                  <SpinnerIcon className="mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : queues.length === 0 ? (
              <TableRow>
                <TableCell
                  className="py-8 text-center text-muted-foreground"
                  colSpan={6}
                >
                  No queues found
                </TableCell>
              </TableRow>
            ) : (
              queuesPageWindow.map((q) => (
                <TableRow
                  className={`cursor-pointer transition-colors ${selectedQueue === q.name ? "bg-muted/50" : "hover:bg-muted/30"}`}
                  key={q.name}
                  onClick={() => {
                    setSelectedQueue(q.name);
                    setStateFilter("all");
                    setExpandedJobs(new Set());
                  }}
                >
                  <TableCell className="font-mono text-sm">{q.name}</TableCell>
                  <TableCell className="text-center">
                    {q.failed > 0 ? (
                      <Badge className="text-xs" variant="destructive">
                        {q.failed}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {q.active > 0 ? (
                      <Badge
                        className="bg-blue-100 text-xs text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                        variant="secondary"
                      >
                        {q.active}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {q.retry > 0 ? (
                      <Badge
                        className="bg-yellow-100 text-xs text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                        variant="secondary"
                      >
                        {q.retry}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {q.queued > 0 ? (
                      <span className="font-medium">{q.queued}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {q.schedule ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {q.schedule}
                      </code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {q.failed > 0 && (
                      <Button
                        disabled={bulkRetryLoading === q.name}
                        onClick={() => handleBulkRetry(q.name)}
                        size="sm"
                        title={`Retry all ${q.failed} failed jobs in this queue`}
                        variant="ghost"
                      >
                        {bulkRetryLoading === q.name ? (
                          <SpinnerIcon className="size-4 animate-spin" />
                        ) : (
                          <ArrowCounterClockwiseIcon className="size-4" />
                        )}
                        Retry all
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {queues.length > 0 && (
          <div className="border-t p-2">
            <TablePagination
              onPageChange={setQueuesPage}
              onPageSizeChange={setQueuesPageSize}
              page={queuesPage}
              pageSize={queuesPageSize}
              total={queues.length}
            />
          </div>
        )}
      </div>

      {/* Job detail panel */}
      {selectedQueue && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">
                Jobs:{" "}
                <code className="text-base font-normal">{selectedQueue}</code>
              </h2>
              {jobsTotal > 0 && (
                <Badge className="text-xs" variant="outline">
                  {jobsTotal} total
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="w-35 justify-between font-normal"
                    type="button"
                    variant="outline"
                  >
                    {STATE_FILTER_OPTIONS.find((o) => o.value === stateFilter)
                      ?.label ?? "All states"}
                    <CaretDownIcon className="size-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                  {STATE_FILTER_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                      key={opt.value}
                      onClick={() => setStateFilter(opt.value)}
                    >
                      <span>{opt.label}</span>
                      {opt.value === stateFilter && (
                        <CheckIcon className="ml-auto size-4" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                onClick={() => setSelectedQueue(null)}
                size="sm"
                variant="ghost"
              >
                Close
              </Button>
            </div>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Job ID</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobsLoading ? (
                  <TableRow>
                    <TableCell
                      className="py-8 text-center text-muted-foreground"
                      colSpan={7}
                    >
                      <SpinnerIcon className="mx-auto size-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : jobs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      className="py-8 text-center text-muted-foreground"
                      colSpan={7}
                    >
                      No jobs found
                      {stateFilter !== "all" && " for this filter"}
                    </TableCell>
                  </TableRow>
                ) : (
                  jobsPageWindow.map((job) => (
                    <Fragment key={job.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => toggleExpanded(job.id)}
                      >
                        <TableCell className="w-8 px-2">
                          {expandedJobs.has(job.id) ? (
                            <CaretDownIcon className="size-4" />
                          ) : (
                            <CaretRightIcon className="size-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {job.id.slice(0, 12)}...
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <StateIcon state={job.state} />
                            <StateBadge state={job.state} />
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {job.retryCount}/{job.retryLimit}
                        </TableCell>
                        <TableCell
                          className="text-sm text-muted-foreground"
                          title={formatDate(job.createdOn)}
                        >
                          {formatAgo(job.createdOn)}
                        </TableCell>
                        <TableCell
                          className="text-sm text-muted-foreground"
                          title={formatDate(job.startedOn)}
                        >
                          {formatAgo(job.startedOn)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {job.state === "failed" && (
                              <Button
                                disabled={actionLoading === job.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction("retry", selectedQueue, job.id);
                                }}
                                size="sm"
                                variant="outline"
                              >
                                <ArrowCounterClockwiseIcon className="mr-1 size-3.5" />
                                Retry
                              </Button>
                            )}
                            {(job.state === "created" ||
                              job.state === "retry" ||
                              job.state === "active" ||
                              job.state === "failed") && (
                              <Button
                                disabled={actionLoading === job.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction("cancel", selectedQueue, job.id);
                                }}
                                size="sm"
                                variant="outline"
                              >
                                <XCircleIcon className="mr-1 size-3.5" />
                                Cancel
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedJobs.has(job.id) && (
                        <TableRow>
                          <TableCell className="bg-muted/20 p-4" colSpan={7}>
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
                                <div>
                                  <span className="text-muted-foreground">
                                    Full ID:
                                  </span>
                                  <p className="mt-0.5 font-mono text-xs break-all">
                                    {job.id}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Expires in:
                                  </span>
                                  <p className="mt-0.5">
                                    {job.expireInSeconds}s
                                  </p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Priority:
                                  </span>
                                  <p className="mt-0.5">{job.priority}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Retry delay:
                                  </span>
                                  <p className="mt-0.5">{job.retryDelay}s</p>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
                                <div>
                                  <span className="text-muted-foreground">
                                    Created:
                                  </span>
                                  <p className="mt-0.5">
                                    {formatDate(job.createdOn)}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Started:
                                  </span>
                                  <p className="mt-0.5">
                                    {formatDate(job.startedOn)}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Completed:
                                  </span>
                                  <p className="mt-0.5">
                                    {formatDate(job.completedOn)}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Start after:
                                  </span>
                                  <p className="mt-0.5">
                                    {formatDate(job.startAfter)}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <span className="text-sm text-muted-foreground">
                                  Payload:
                                </span>
                                <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                                  {JSON.stringify(job.data, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
            {jobs.length > 0 && (
              <div className="border-t p-2">
                <TablePagination
                  onPageChange={setJobsPage}
                  onPageSizeChange={setJobsPageSize}
                  page={jobsPage}
                  pageSize={jobsPageSize}
                  total={jobs.length}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
