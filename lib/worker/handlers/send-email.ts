import type { Job } from "pg-boss";
import { sendEmail } from "@/lib/email";
import type { SendEmailPayload } from "@/lib/worker/job-types";

export async function handleSendEmail(jobs: Job<SendEmailPayload>[]): Promise<void> {
  for (const job of jobs) {
    const { to, subject, html, text } = job.data;
    await sendEmail({ to, subject, html, text });
    console.log(`[worker] send-email → ${to}`);
  }
}
