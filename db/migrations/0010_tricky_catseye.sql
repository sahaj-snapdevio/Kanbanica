CREATE TABLE "pinned_task" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "list_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "status_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "space_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "is_pinned_to_list" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "pinned_to_list_by" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "pinned_to_list_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "pinned_to_list_order" integer;--> statement-breakpoint
ALTER TABLE "pinned_task" ADD CONSTRAINT "pinned_task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_task" ADD CONSTRAINT "pinned_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_task" ADD CONSTRAINT "pinned_task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pinned_task_user_task_idx" ON "pinned_task" USING btree ("user_id","task_id");--> statement-breakpoint
CREATE INDEX "pinned_task_user_workspace_idx" ON "pinned_task" USING btree ("user_id","workspace_id");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_pinned_to_list_idx" ON "task" USING btree ("list_id","is_pinned_to_list");