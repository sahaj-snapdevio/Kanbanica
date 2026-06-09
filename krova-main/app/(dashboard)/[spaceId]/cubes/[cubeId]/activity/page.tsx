import { and, desc, eq } from "drizzle-orm";
import { LifecycleLog } from "@/components/lifecycle-log";
import { JobLogStream } from "@/components/orbit/job-log-stream";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import * as schema from "@/db/schema";
import { loadCubeContext } from "@/lib/cubes/load-cube-context";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CubeActivityTabPage({
  params,
}: {
  params: Promise<{ spaceId: string; cubeId: string }>;
}) {
  const { spaceId, cubeId } = await params;
  const ctx = await loadCubeContext(spaceId, cubeId);

  const lifecycleLogs = await db
    .select()
    .from(schema.lifecycleLogs)
    .where(
      and(
        eq(schema.lifecycleLogs.entityType, "cube"),
        eq(schema.lifecycleLogs.entityId, cubeId)
      )
    )
    .orderBy(desc(schema.lifecycleLogs.createdAt))
    .limit(50);

  const isDeleted = ctx.cube.status === "deleted";
  const showJobLogs = !isDeleted;

  // Two distinct streams are surfaced here. Wrapping each in its own
  // Card with an explicit title + description prevents the previous
  // "two unlabeled Activity sections" confusion where the lifecycle
  // timeline and the live worker job-log feed both read as "Activity"
  // separated only by whitespace.
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
          <CardDescription>
            Durable, human-readable timeline of every state change for this Cube
            — provision, wake, sleep, resize, transfer, delete.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LifecycleLog
            logs={lifecycleLogs.map((l) => ({
              ...l,
              createdAt: l.createdAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>

      {showJobLogs && (
        <Card>
          <CardHeader>
            <CardTitle>Live job activity</CardTitle>
            <CardDescription>
              Real-time worker output for background jobs touching this Cube
              (snapshots, backups, domain attaches, resize, etc.). Streams live
              while a job is in flight and shows the last few completed runs
              once it&apos;s idle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JobLogStream
              channelName={`private-cube-${cubeId}`}
              logsUrl={`/api/spaces/${spaceId}/cubes/${cubeId}/job-logs?limit=500`}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
