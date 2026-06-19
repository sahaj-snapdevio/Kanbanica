ALTER TABLE "workspace" ALTER COLUMN "theme" SET DEFAULT 'forest';--> statement-breakpoint
UPDATE "workspace" SET "theme" = 'forest' WHERE "theme" = 'indigo';