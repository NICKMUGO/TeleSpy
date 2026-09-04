import { Smartphone } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function SimsPage() {
  return (
    <>
      <PageHeader
        title="SIM inventory"
        description="Every SIM card, who holds it, and its current status."
      />
      <StubNotice icon={Smartphone}>
        SIM inventory, detail and allocation flows are built once the data layer
        and mock API are wired up.
      </StubNotice>
    </>
  );
}
