CREATE TYPE "public"."email_outbox_status" AS ENUM('queued', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "email_outbox_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"provider_message_id" text,
	"last_error" text,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_idempotency_key_unq" ON "email_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_outbox_status_idx" ON "email_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_outbox_status_claimed_at_idx" ON "email_outbox" USING btree ("status","claimed_at");