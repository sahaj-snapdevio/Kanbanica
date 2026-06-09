import { createId } from "@paralleldrive/cuid2"
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"

import { cubes, allocatedPorts } from "@/db/schema/cubes"

export const tcpMappingStatus = pgEnum("tcp_mapping_status", [
  "pending",
  "active",
  "stopping",
  "failed",
  "disabled",
])

export const tcpPortMappings = pgTable(
  "tcp_port_mappings",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    cubeId: text("cube_id")
      .notNull()
      .references(() => cubes.id, { onDelete: "cascade" }),
    cubePort: integer("cube_port").notNull(),
    hostPort: integer("host_port").notNull(),
    allocatedPortId: text("allocated_port_id")
      .notNull()
      .references(() => allocatedPorts.id, { onDelete: "cascade" }),
    label: text("label"),
    isSsh: boolean("is_ssh").notNull().default(false),
    status: tcpMappingStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.cubeId, t.cubePort),
    index("tcp_port_mappings_cube_id_idx").on(t.cubeId),
  ]
)

export const tcpMappingWhitelistedIps = pgTable(
  "tcp_mapping_whitelisted_ips",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    mappingId: text("mapping_id")
      .notNull()
      .references(() => tcpPortMappings.id, { onDelete: "cascade" }),
    cidr: text("cidr").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.mappingId, t.cidr)]
)
