import { QueuesView } from "@/components/orbit/queues-view";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";

export default function QueuesPage() {
  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Queues</PageHeaderTitle>
          <PageHeaderDescription>
            Monitor and manage background job queues. View failed jobs, retry
            stuck operations, and inspect job payloads.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <QueuesView />
    </div>
  );
}
