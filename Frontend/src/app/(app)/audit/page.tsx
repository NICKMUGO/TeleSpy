import { Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every write in the system."
      />
      <StubNotice icon={Lock}>
        The audit log is built once the data layer and mock API are wired up.
      </StubNotice>
    </>
  );
}
