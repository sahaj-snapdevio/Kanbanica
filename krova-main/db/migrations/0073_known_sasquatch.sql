ALTER TABLE "servers" ADD COLUMN "numa_node_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "numa_topology" jsonb;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN "numa_node" integer;