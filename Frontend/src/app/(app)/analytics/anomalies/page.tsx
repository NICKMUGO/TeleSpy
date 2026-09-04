import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function AnomaliesPage() {
  return (
    <>
      <PageHeader
        title="Anomalies"
        description="Usage flagged by the Isolation Forest model for review."
      />
      <StubNotice icon={TriangleAlert}>
        The anomaly review queue is built once the data layer and ML result
        mocks are ready.
      </StubNotice>
    </>
  );
}
