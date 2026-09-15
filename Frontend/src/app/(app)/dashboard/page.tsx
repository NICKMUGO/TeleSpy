"use client";

import Link from "next/link";
import { Activity, ShieldAlert, TrendingUp, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/data/stat-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/data/error-banner";
import {
  useAnomalies,
  useDepartments,
  useEmployees,
  useMyUsage,
  useOverLimit,
  useSims,
} from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function kes(value: number) {
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

export default function DashboardPage() {
  const user = useSession((state) => state.user);
  const isSelfService = user?.role === "Employee";

  return (
    <>
      <PageHeader
        title={`Welcome back${user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}`}
        description={
          isSelfService
            ? "Your telecom usage and spend at a glance."
            : "A role-aware overview of spend, anomalies and SIM activity."
        }
      />
      {isSelfService ? <EmployeeDashboard /> : <OrgDashboard />}
    </>
  );
}

function OrgDashboard() {
  const employees = useEmployees();
  const sims = useSims();
  const departments = useDepartments();
  const anomalies = useAnomalies(false);
  const overLimit = useOverLimit();

  const loading =
    employees.isLoading || sims.isLoading || departments.isLoading;
  const error = employees.error ?? sims.error ?? departments.error;

  if (error) return <ErrorBanner error={error} />;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))
        ) : (
          <>
            <StatCard
              label="Employees"
              value={String(employees.data?.data.length ?? 0)}
              icon={Users}
            />
            <StatCard
              label="Active SIMs"
              value={String(sims.data?.data.length ?? 0)}
              icon={Activity}
            />
            <StatCard
              label="Departments"
              value={String(departments.data?.data.length ?? 0)}
              icon={Wallet}
            />
            <StatCard
              label="Open anomalies"
              value={String(anomalies.data?.data.length ?? 0)}
              icon={ShieldAlert}
              tone={
                (anomalies.data?.data.length ?? 0) > 0 ? "warning" : "default"
              }
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="border-border rounded-lg border">
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Recent anomalies</h2>
            <Link
              href="/analytics/anomalies"
              className="text-primary text-sm hover:underline"
            >
              View all
            </Link>
          </div>
          {anomalies.isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : anomalies.data && anomalies.data.data.length > 0 ? (
            <ul className="divide-border divide-y">
              {anomalies.data.data.slice(0, 5).map((flag) => (
                <li
                  key={flag.id}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="truncate">
                    {flag.employee?.full_name ?? "Unattributed"}
                  </span>
                  <Badge variant="outline">
                    score {flag.anomaly_score.toFixed(2)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground p-4 text-sm">
              No open anomalies right now.
            </p>
          )}
        </section>

        <section className="border-border rounded-lg border">
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Over budget this month</h2>
            <Link
              href="/budgets"
              className="text-primary text-sm hover:underline"
            >
              View all
            </Link>
          </div>
          {overLimit.isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : overLimit.data && overLimit.data.data.length > 0 ? (
            <ul className="divide-border divide-y">
              {overLimit.data.data.slice(0, 5).map((entry) => (
                <li
                  key={entry.employee_id}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="truncate">{entry.full_name}</span>
                  <span className="text-destructive font-mono text-xs">
                    +{kes(entry.overage_kshs)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground p-4 text-sm">
              Everyone is within their limit.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function EmployeeDashboard() {
  const myUsage = useMyUsage();
  const month = currentMonth();
  const currentSummary = myUsage.data?.data.cost_summaries.find(
    (s) => s.month === month,
  );
  const recentEvents = myUsage.data?.data.usage.slice(0, 5) ?? [];

  if (myUsage.error) return <ErrorBanner error={myUsage.error} />;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {myUsage.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))
        ) : (
          <>
            <StatCard
              label="This month's spend"
              value={kes(currentSummary?.total_cost ?? 0)}
              icon={Wallet}
            />
            <StatCard
              label="Extension"
              value={
                myUsage.data?.data.current_sim?.extension ??
                myUsage.data?.data.current_sim?.msisdn_masked ??
                "—"
              }
              icon={Activity}
            />
            <StatCard
              label="Usage profile"
              value={
                myUsage.data?.data.usage_profile_cluster?.replace("_", " ") ??
                "Not yet profiled"
              }
              icon={TrendingUp}
            />
          </>
        )}
      </div>

      <section className="border-border rounded-lg border">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Recent calls</h2>
          <Link
            href="/invoices"
            className="text-primary text-sm hover:underline"
          >
            View invoices
          </Link>
        </div>
        {myUsage.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : recentEvents.length > 0 ? (
          <ul className="divide-border divide-y">
            {recentEvents.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="font-mono">{event.destination}</span>
                <span className="text-muted-foreground">
                  {event.duration_minutes.toFixed(1)} min
                </span>
                <Badge variant="outline">{event.call_classification}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground p-4 text-sm">
            No calls recorded yet.
          </p>
        )}
      </section>
    </div>
  );
}
