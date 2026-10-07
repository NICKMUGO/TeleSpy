"use client";

import { Bell, ShieldAlert } from "lucide-react";
import { DisplaySettingsForm } from "@/components/layout/display-settings-form";
import { PageHeader } from "@/components/layout/page-header";
import { StubNotice } from "@/components/layout/stub-notice";
import { DiscountsCard } from "@/features/billing/discounts-card";
import { SpendingLimitsCard } from "@/features/billing/spending-limits-card";
import { LocalRateCard } from "@/features/billing/local-rate-card";
import { InternationalRatesTable } from "@/features/billing/international-rates-table";
import { useSession } from "@/lib/auth/session-store";

export default function SettingsPage() {
  const user = useSession((state) => state.user);
  const isAdmin = user?.role === "Admin";

  return (
    <>
      <PageHeader
        title="Settings"
        description="Display preferences, notifications and billing."
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
          <h2 className="mb-4 text-lg font-semibold">Billing</h2>
          {isAdmin ? (
            <div className="flex flex-col gap-6">
              <LocalRateCard />
              <DiscountsCard />
              <SpendingLimitsCard />
              <div>
                <h3 className="mb-3 text-sm font-medium">
                  International call rates
                </h3>
                <InternationalRatesTable />
              </div>
            </div>
          ) : (
            <StubNotice icon={ShieldAlert}>
              Only an Admin can view or change billing settings.
            </StubNotice>
          )}
        </section>
      </div>
    </>
  );
}
