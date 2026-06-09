import { count } from "drizzle-orm";
import { SshKeysManagement } from "@/components/orbit/ssh-keys-management";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export default async function SshKeysPage() {
  const keys = await db.select().from(schema.sshKeys);

  const serverCounts = await db
    .select({
      sshKeyId: schema.servers.sshKeyId,
      count: count(schema.servers.id),
    })
    .from(schema.servers)
    .groupBy(schema.servers.sshKeyId);

  const serverCountMap = new Map(
    serverCounts.map((s) => [s.sshKeyId, Number(s.count)])
  );

  const sshKeys = keys.map((key) => ({
    id: key.id,
    name: key.name,
    fingerprint: key.fingerprint,
    createdAt: key.createdAt.toISOString(),
    serverCount: serverCountMap.get(key.id) ?? 0,
  }));

  return <SshKeysManagement sshKeys={sshKeys} />;
}
