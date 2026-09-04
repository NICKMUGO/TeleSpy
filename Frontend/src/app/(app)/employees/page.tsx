import { Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function EmployeesPage() {
  return (
    <>
      <PageHeader
        title="Employees"
        description="Employee records as held by HR — read-mostly, not a source of truth for org data."
      />
      <StubNotice icon={Users}>
        The employee directory is built once the data layer and mock API are
        wired up.
      </StubNotice>
    </>
  );
}
