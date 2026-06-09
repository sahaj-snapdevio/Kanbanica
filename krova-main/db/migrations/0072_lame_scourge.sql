CREATE TYPE "public"."domain_claim_status" AS ENUM('pending', 'verified', 'failed');--> statement-breakpoint
CREATE TABLE "space_domain_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"domain" text NOT NULL,
	"token" text NOT NULL,
	"status" "domain_claim_status" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"failed_checks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_domain_claims" ADD CONSTRAINT "space_domain_claims_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_domain_claims_space_id_idx" ON "space_domain_claims" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_domain_claims_space_domain_unique" ON "space_domain_claims" USING btree ("space_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "space_domain_claims_domain_verified_unique" ON "space_domain_claims" USING btree ("domain") WHERE status = 'verified';--> statement-breakpoint
CREATE INDEX "space_domain_claims_domain_idx" ON "space_domain_claims" USING btree ("domain");