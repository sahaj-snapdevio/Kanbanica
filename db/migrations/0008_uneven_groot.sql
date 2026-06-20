CREATE TYPE "public"."channel_member_role" AS ENUM('ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TABLE "channel" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_workspace_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
CREATE TABLE "channel_member" (
	"channel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "channel_member_role" DEFAULT 'MEMBER' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_member_pk" UNIQUE("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channel_message" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"content" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_message_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member" ADD CONSTRAINT "channel_member_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_attachment" ADD CONSTRAINT "channel_message_attachment_message_id_channel_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."channel_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_workspace_id_idx" ON "channel" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "channel_member_channel_id_idx" ON "channel_member" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channel_message_channel_id_idx" ON "channel_message" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channel_message_created_at_idx" ON "channel_message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "channel_message_attachment_message_id_idx" ON "channel_message_attachment" USING btree ("message_id");