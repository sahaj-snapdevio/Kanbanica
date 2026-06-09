-- Enforce "at most one owner per space" at the DB level.
-- Partial unique index: same space_id may have many memberships, but at
-- most one with is_owner = TRUE. Additive, non-locking, IF NOT EXISTS guard
-- makes this safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS "space_memberships_one_owner_per_space"
  ON "space_memberships" ("space_id")
  WHERE is_owner = true;
