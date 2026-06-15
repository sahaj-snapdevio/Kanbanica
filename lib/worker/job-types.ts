// Single source of truth for every queue name. Add new entries here first;
// ensure-queues.ts will fail to compile until a matching QUEUE_OPTIONS entry
// exists (the Record<JobName, …> is exhaustive by design).

export const JOB_NAMES = {
  // Email
  SEND_EMAIL: "send-email",

  // Workspace
  WORKSPACE_DELETE: "workspace.delete",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export type SendEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type WorkspaceDeletePayload = {
  workspaceId: string;
  requestedBy: string; // userId of the Owner who triggered it
  requestedAt: string; // ISO timestamp
};
