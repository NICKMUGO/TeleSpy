import { TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function ForecastsPage() {
  return (
    <>
      <PageHeader
        title="Forecasts"
        description="Prophet cost projections with uncertainty bands."
      />
      <StubNotice icon={TrendingUp}>
        Forecast charts are built once the TrendChart primitive and ML result
        mocks are ready.
      </StubNotice>
    </>
  );
}
