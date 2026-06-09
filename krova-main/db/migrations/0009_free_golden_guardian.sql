ALTER TABLE "deploys" ALTER COLUMN "port" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "deploys" ALTER COLUMN "port" DROP NOT NULL;