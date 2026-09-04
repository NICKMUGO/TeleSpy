import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function BudgetsPage() {
  return (
    <>
      <PageHeader
        title="Budgets"
        description="Threshold configuration and breach history."
      />
      <StubNotice icon={Wallet}>
        Budget thresholds and breach history are built once the data layer and
        mock API are wired up.
      </StubNotice>
    </>
  );
}
