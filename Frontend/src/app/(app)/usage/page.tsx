import { Activity } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function UsagePage() {
  return (
    <>
      <PageHeader
        title="Usage events"
        description="Every CDR event, attributed to the employee and SIM holding the line at the time it occurred."
      />
      <StubNotice icon={Activity}>
        The usage events table is built once the DataTable primitive and mock
        API are ready.
      </StubNotice>
    </>
  );
}
