import { AuditLogsView } from "@/components/orbit/audit-logs-view";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";

export default function AuditLogsPage() {
  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Audit Logs</PageHeaderTitle>
          <PageHeaderDescription>
            Full audit trail of all actions across the platform. Filter, search,
            and analyze user and system activity.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <AuditLogsView />
    </div>
  );
}
