import { Upload } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function IngestionPage() {
  return (
    <>
      <PageHeader
        title="CDR upload"
        description="Upload carrier CDR batches and track ingestion status."
      />
      <StubNotice icon={Upload}>
        CDR upload with progress tracking is built once the data layer and mock
        API are wired up.
      </StubNotice>
    </>
  );
}
