import { createId } from "@paralleldrive/cuid2"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const sshKeys = pgTable("ssh_keys", {
  id: text("id").primaryKey().$defaultFn(createId),
  name: text("name").notNull(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  publicKey: text("public_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
