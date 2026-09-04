import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function DepartmentsPage() {
  return (
    <>
      <PageHeader
        title="Departments"
        description="Departments and their cost centres."
      />
      <StubNotice icon={Building2}>
        Department and cost-centre management is built once the data layer and
        mock API are wired up.
      </StubNotice>
    </>
  );
}
