-- Add customer-facing API keys for programmatic access (v1 API).
-- Keys authenticate via X-API-KEY header, scoped per space.

CREATE TABLE "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "space_id" text NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "membership_id" text NOT NULL REFERENCES "space_memberships"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");
--> statement-breakpoint

CREATE INDEX "api_keys_space_id_idx" ON "api_keys" USING btree ("space_id");
