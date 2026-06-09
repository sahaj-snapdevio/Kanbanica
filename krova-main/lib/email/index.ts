/**
 * Outbound transactional email — durable, idempotency-safe queue.
 *
 * Every call to `enqueueEmail()` inserts an `email_outbox` row in
 * `queued` status BEFORE the pg-boss job is enqueued. The worker
 * (`lib/worker/handlers/email-send.ts`) atomically transitions the row
 * `queued → sending` via a `WHERE status='queued' RETURNING` update,
 * calls EmailIt, then transitions to `sent` (success) or back to
 * `queued` (retry) or `failed` (terminal).
 *
 * The row-state machine — not the pg-boss retry — is the source of
 * truth for whether an email has been sent. pg-boss guarantees
 * at-least-once delivery; the outbox table makes the external API
 * call effectively exactly-once-per-row.
 *
 * Callers see the same API (`enqueueEmail({ to, subject, html, text })`)
 * — the outbox is an internal mechanism.
 */

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

/**
 * Enqueue an email for asynchronous delivery via the background worker.
 * The email is persisted to the `email_outbox` table first, then a
 * pg-boss job is enqueued referencing the outbox row.
 */
export async function enqueueEmail(options: SendEmailOptions): Promise<void> {
  const idempotencyKey = randomUUID();
  const [row] = await db
    .insert(emailOutbox)
    .values({
      idempotencyKey,
      status: "queued",
      payload: {
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      },
    })
    .returning({ id: emailOutbox.id });

  await enqueueJob(JOB_NAMES.EMAIL_SEND, { outboxId: row.id });

  console.log(
    `[email] queued "${options.subject}" to ${options.to} (outbox=${row.id})`
  );
}
