// Single source of truth for every queue name. Add new entries here first;
// ensure-queues.ts will fail to compile until a matching QUEUE_OPTIONS entry
// exists (the Record<JobName, …> is exhaustive by design).

export const JOB_NAMES = {
  // Email
  SEND_EMAIL: "send-email",

  // Add your jobs here, e.g.:
  // USER_WELCOME:    "user.welcome",
  // REPORT_GENERATE: "report.generate",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export type SendEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};
