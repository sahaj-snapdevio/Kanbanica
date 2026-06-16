import { dbClient } from "@/lib/db";

export interface QueueSummaryRow {
  count: number;
  name: string;
  state: string;
}

export async function getQueueSummary(): Promise<QueueSummaryRow[]> {
  try {
    const rows = await dbClient<QueueSummaryRow[]>`
      select name, state, count(*)::int as count
      from pgboss.job
      group by name, state
      order by name, state
    `;
    return rows;
  } catch {
    return [];
  }
}
