-- Sprint architecture change: move sprint from list-level to project (space) level
-- Drops list_id and workspace_id, adds space_id FK → space

--> statement-breakpoint
ALTER TABLE "sprint" DROP CONSTRAINT "sprint_list_id_list_id_fk";
--> statement-breakpoint
ALTER TABLE "sprint" DROP CONSTRAINT "sprint_workspace_id_workspace_id_fk";
--> statement-breakpoint
DROP INDEX "sprint_list_id_idx";
--> statement-breakpoint
ALTER TABLE "sprint" ADD COLUMN "space_id" text;
--> statement-breakpoint
UPDATE "sprint" s
SET "space_id" = l."space_id"
FROM "list" l
WHERE s."list_id" = l."id";
--> statement-breakpoint
ALTER TABLE "sprint" ALTER COLUMN "space_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sprint" DROP COLUMN "list_id";
--> statement-breakpoint
ALTER TABLE "sprint" DROP COLUMN "workspace_id";
--> statement-breakpoint
ALTER TABLE "sprint" ADD CONSTRAINT "sprint_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sprint_space_id_idx" ON "sprint" USING btree ("space_id");
