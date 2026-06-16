import { and, eq, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import { emailOutbox } from "@/db/schema";
import { db } from "@/lib/db";
import { sendEmailViaSmtp } from "@/lib/smtp/client";
import { enqueueJob } from "@/lib/worker/enqueue";
import { type EmailSendPayload, JOB_NAMES } from "@/lib/worker/job-types";

const RETRY_BACKOFF_SECONDS = [60, 300, 900];

export async function handleEmailSend(jobs: Job<EmailSendPayload>[]) {
  for (const job of jobs) {
    await processEmailSendJob(job);
  }
}

async function processEmailSendJob(job: Job<EmailSendPayload>) {
  const { outboxId } = job.data;

  const [claimed] = await db
    .update(emailOutbox)
    .set({
      attemptCount: sql`${emailOutbox.attemptCount} + 1`,
      claimedAt: new Date(),
      status: "sending",
      updatedAt: new Date(),
    })
    .where(and(eq(emailOutbox.id, outboxId), eq(emailOutbox.status, "queued")))
    .returning();

  if (!claimed) {
    return;
  }

  const attempt = claimed.attemptCount;
  const remainingAttempts = claimed.maxAttempts - attempt;

  try {
    const result = await sendEmailViaSmtp({
      html: claimed.payload.html,
      idempotencyKey: claimed.idempotencyKey,
      subject: claimed.payload.subject,
      text: claimed.payload.text,
      to: claimed.payload.to,
    });

    await db
      .update(emailOutbox)
      .set({
        providerMessageId: result.id,
        sentAt: new Date(),
        status: "sent",
        updatedAt: new Date(),
      })
      .where(eq(emailOutbox.id, outboxId));
  } catch (error) {
    const reason = describeEmailError(error);

    if (remainingAttempts > 0 && isRetryable(error)) {
      await db
        .update(emailOutbox)
        .set({
          claimedAt: null,
          lastError: reason,
          status: "queued",
          updatedAt: new Date(),
        })
        .where(eq(emailOutbox.id, outboxId));

      await enqueueJob(
        JOB_NAMES.EMAIL_SEND,
        { outboxId },
        {
          startAfter:
            RETRY_BACKOFF_SECONDS[
              Math.min(attempt - 1, RETRY_BACKOFF_SECONDS.length - 1)
            ],
        }
      );
      return;
    }

    await db
      .update(emailOutbox)
      .set({
        lastError: reason,
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(emailOutbox.id, outboxId));
  }
}

function describeEmailError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }
  return String(error).slice(0, 500);
}

function isRetryable(_error: unknown) {
  return true;
}
