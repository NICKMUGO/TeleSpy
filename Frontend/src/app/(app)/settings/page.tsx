import { Bell, Receipt } from "lucide-react";
import { DisplaySettingsForm } from "@/components/layout/display-settings-form";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Display preferences, notifications and tariff plans."
      />
      <div className="flex flex-col gap-8 px-6 py-6">
        <section>
          <h2 className="mb-4 text-lg font-semibold">Display</h2>
          <DisplaySettingsForm />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold">Notifications</h2>
          <StubNotice icon={Bell}>
            Notification preferences are built once the data layer and mock API
            are wired up.
          </StubNotice>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold">Tariff plans</h2>
          <StubNotice icon={Receipt}>
            Tariff plan configuration is built once the data layer and mock API
            are wired up.
          </StubNotice>
        </section>
      </div>
    </>
  );
}
