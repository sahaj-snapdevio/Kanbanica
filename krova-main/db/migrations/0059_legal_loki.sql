-- Disposable email-service blocklist. PK on `domain` makes lookup a
-- B-tree probe — sub-millisecond on a warm Postgres. Table starts empty
-- after this migration; the `disposable-emails.refresh` pg-boss cron
-- populates it weekly, or `pnpm refresh:disposable-emails` primes it
-- on demand. IF NOT EXISTS makes the migration re-run safe per Rule 40.
CREATE TABLE IF NOT EXISTS "disposable_email_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
