import { createId } from "@paralleldrive/cuid2"
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import { cubes } from "@/db/schema/cubes"
import { spaces } from "@/db/schema/spaces"
import { user } from "@/db/schema/auth"

/**
 * Lifecycle states for a browser-terminal session:
 *
 *  pending  — row inserted by the API; the worker bridge has not claimed it yet.
 *  running  — worker bridge holds the SSH + vsock connection and is shovelling
 *             bytes through Soketi. Session row is the canonical "is this
 *             session alive" signal.
 *  ended    — closed cleanly (customer closed the tab / clicked Disconnect).
 *  failed   — bridge errored before it could deliver bytes either way
 *             (SSH refused, vsock-pty install missing, cube not actually up).
 *  expired  — idle / hard timeout fired and the bridge tore the session down.
 *
 *  See lib/worker/handlers/cube-terminal-bridge.ts for the state machine.
 */
export const cubeTerminalSessionStatus = pgEnum(
  "cube_terminal_session_status",
  ["pending", "running", "ended", "failed", "expired"]
)

export const cubeTerminalSessions = pgTable(
  "cube_terminal_sessions",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    cubeId: text("cube_id")
      .notNull()
      .references(() => cubes.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    /**
     * The user who opened this session. Used to:
     *  (a) restrict the presence-terminal-{sessionId} Pusher channel to its
     *      original opener (defense in depth on top of the cube.manage check),
     *  (b) drive the audit-log entry.
     */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: cubeTerminalSessionStatus("status").notNull().default("pending"),
    /** Initial PTY geometry the browser sent on session open. */
    initialCols: integer("initial_cols").notNull().default(80),
    initialRows: integer("initial_rows").notNull().default(24),
    /**
     * Bumped every time the bridge sees stdin OR stdout traffic. The idle
     * timeout sweep compares `last_activity_at` to NOW(): no activity for
     * the configured grace window → status flips to `expired` and the
     * bridge tears down.
     */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When the bridge actually claimed the row (status pending → running). */
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /**
     * Short tag describing why the session ended. Free-form text rather
     * than an enum because end-reasons are display-only and evolve faster
     * than the schema. Examples:
     *  - "closed_by_user"
     *  - "idle_timeout"
     *  - "hard_timeout"
     *  - "cube_state_change"
     *  - "bridge_error: <message>"
     */
    endReason: text("end_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cube_terminal_sessions_cube_id_idx").on(t.cubeId),
    index("cube_terminal_sessions_user_id_idx").on(t.userId),
    index("cube_terminal_sessions_status_idx").on(t.status),
  ]
)
