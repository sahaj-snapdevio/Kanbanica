ALTER TYPE "public"."support_ticket_status" ADD VALUE 'IN_PROGRESS' BEFORE 'CLOSED';--> statement-breakpoint
ALTER TABLE "support_ticket" ADD COLUMN "assigned_to" text;--> statement-breakpoint
ALTER TABLE "support_ticket_message" ADD COLUMN "is_internal_note" boolean DEFAULT false NOT NULL;