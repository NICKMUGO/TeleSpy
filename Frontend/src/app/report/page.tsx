"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ErrorBanner } from "@/components/data/error-banner";
import { Button } from "@/components/ui/button";
import { SelectNative } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthlyReportDocument } from "@/features/reports/monthly-report-document";
import { useMonthlyReport } from "@/lib/api/hooks";
import { monthLabel } from "@/lib/format";

/** The printable monthly report (/report?month=YYYY-MM), opened from the
 * dashboard's "Export report". Outside the app shell on purpose: nothing
 * but the document and one toolbar, and the toolbar doesn't print. Saving
 * as PDF is the browser's own print dialog, so the PDF is exactly the
 * pages shown here. */
export default function ReportPage() {
  return (
    <AuthGuard>
      <Suspense fallback={null}>
        <Report />
      </Suspense>
    </AuthGuard>
  );
}

function Report() {
  const router = useRouter();
  const requested = useSearchParams().get("month") ?? undefined;
  const { data, error, isLoading, isFetching, refetch } =
    useMonthlyReport(requested);
  const report = data?.data;

  return (
    <div className="min-h-dvh flex-1 bg-neutral-200 print:bg-white">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-neutral-300 bg-white px-4 py-3 text-neutral-900 sm:px-6 print:hidden">
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">
            <ArrowLeft aria-hidden="true" />
            Dashboard
          </Link>
        </Button>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="sr-only sm:not-sr-only">Month</span>
          <SelectNative
            value={report?.month ?? ""}
            disabled={!report}
            onChange={(e) => router.replace(`/report?month=${e.target.value}`)}
          >
            {(report?.months ?? []).map((month) => (
              <option key={month} value={month}>
                {monthLabel(month)}
              </option>
            ))}
          </SelectNative>
        </label>
        <Button
          type="button"
          size="sm"
          disabled={!report || isFetching}
          onClick={() => window.print()}
        >
          <Printer aria-hidden="true" />
          Save as PDF / Print
        </Button>
      </div>

      <main id="main-content" className="px-3 py-6 sm:px-6 print:p-0">
        {error ? (
          <div className="mx-auto max-w-[210mm] bg-white p-6">
            <ErrorBanner error={error} onRetry={() => refetch()} />
          </div>
        ) : isLoading || !report ? (
          <div className="mx-auto flex max-w-[210mm] flex-col gap-3 bg-white p-8">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <MonthlyReportDocument report={report} />
        )}
      </main>
    </div>
  );
}
