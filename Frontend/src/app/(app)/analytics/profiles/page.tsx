import { FingerprintPattern } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function ProfilesPage() {
  return (
    <>
      <PageHeader
        title="Usage profiles"
        description="K-Means clusters of usage behaviour."
      />
      <StubNotice icon={FingerprintPattern}>
        Usage-profile clusters are built once the data layer and ML result mocks
        are ready.
      </StubNotice>
    </>
  );
}
