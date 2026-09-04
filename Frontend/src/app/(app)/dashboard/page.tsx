import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="A role-aware landing view summarising spend, anomalies and SIM activity."
      />
      <StubNotice icon={LayoutDashboard}>
        The dashboard is built in a later phase, once the data layer and mock
        API are wired up.
      </StubNotice>
    </>
  );
}
