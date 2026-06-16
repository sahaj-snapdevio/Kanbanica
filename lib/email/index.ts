import { randomUUID } from "node:crypto";
import { emailOutbox } from "@/db/schema";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export interface SendEmailOptions {
  html: string;
  subject: string;
  text?: string;
  to: string;
}

export async function enqueueEmail(options: SendEmailOptions) {
  const [row] = await db
    .insert(emailOutbox)
    .values({
      idempotencyKey: randomUUID(),
      payload: options,
      status: "queued",
    })
    .returning({ id: emailOutbox.id });

  await enqueueJob(JOB_NAMES.EMAIL_SEND, { outboxId: row.id });
}
