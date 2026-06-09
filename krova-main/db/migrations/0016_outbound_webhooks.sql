DO $$ BEGIN
 CREATE TYPE "public"."outbound_webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"url" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"events" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbound_webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"response_status" integer,
	"response_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_webhook_endpoints" ADD CONSTRAINT "outbound_webhook_endpoints_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_webhook_deliveries" ADD CONSTRAINT "outbound_webhook_deliveries_endpoint_id_outbound_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."outbound_webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "owhe_space_id_idx" ON "outbound_webhook_endpoints" USING btree ("space_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "owhd_endpoint_id_idx" ON "outbound_webhook_deliveries" USING btree ("endpoint_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "owhd_status_created_idx" ON "outbound_webhook_deliveries" USING btree ("status","created_at");
