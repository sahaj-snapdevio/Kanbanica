CREATE TABLE IF NOT EXISTS "email_events" (
	"id" text PRIMARY KEY NOT NULL,
	"emailit_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"emailit_email_id" text,
	"recipient" text,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_events_emailit_event_id_unique" UNIQUE("emailit_event_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_events_event_type_idx" ON "email_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_events_recipient_idx" ON "email_events" USING btree ("recipient");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_events_received_at_idx" ON "email_events" USING btree ("received_at");