import type { ReactNode } from "react";
import {
  ReportBars,
  ReportColumns,
  ReportDonut,
} from "@/features/reports/report-charts";
import type { MonthlyReport } from "@/lib/api/types";
import { kesCompact, monthLabel } from "@/lib/format";

/** Money to the cent, as a bill states it. */
function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function count(value: number) {
  return value.toLocaleString("en-KE");
}

function minutes(value: number) {
  return `${Math.round(value).toLocaleString("en-KE")} min`;
}

function change(current: number, previous: number | null) {
  if (previous === null || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}

const CALL_TYPE_LABEL: Record<string, string> = {
  Internal: "Internal (extension to extension)",
  External: "Local (Kenyan numbers)",
  International: "International",
};

/** The monthly management report as a paged document: what is shown on
 * screen is what prints. Summary figures only — no employee is named. */
export function MonthlyReportDocument({ report }: { report: MonthlyReport }) {
  const { bill } = report;
  const company = report.scope.type === "company";
  const subject = company
    ? "Company"
    : (report.scope.department_name ?? "Department");
  const period = monthLabel(report.month);
  const partial = report.days_covered < report.days_in_month;
  const previousMonth = report.trend.at(-2)?.month;
  const vsPrevious = change(bill.calls_cost_kes, bill.previous_calls_cost_kes);
  const pages = company ? 4 : 3;
  const totalMinutes = report.call_types.reduce((sum, t) => sum + t.minutes, 0);
  const totalCalls = report.call_types.reduce((sum, t) => sum + t.calls, 0);
  const budgeted = report.departments.filter(
    (d) => d.budget_ceiling_kes !== null,
  );

  const footer = (page: number) => (
    <PageFooter
      left={`${subject} telecom expenditure — ${period}`}
      right={`Page ${page} of ${pages}`}
    />
  );

  return (
    <div className="report-document flex flex-col gap-6 print:gap-0">
      {/* ---- Page 1: summary and the bill -------------------------------- */}
      <ReportPage>
        <header className="border-kq-red border-b-4 pb-5">
          <p className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
            TeleSpy · Telecom expenditure report
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {period}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            {company ? "Whole company" : `${subject} department`} ·{" "}
            {report.home_network_name} line · prepared{" "}
            {new Date(report.generated_at).toLocaleDateString("en-KE", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </header>

        {partial ? (
          <p className="mt-4 rounded border border-neutral-400 bg-neutral-100 px-3 py-2 text-xs">
            <strong>Part month.</strong> The call records cover{" "}
            {report.days_covered} of {report.days_in_month} days of {period}, so
            these figures are lower than a full month&rsquo;s bill.
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure
            label="Calls before discount"
            value={kesCompact(bill.calls_list_cost_kes)}
            note="at list price"
          />
          <Figure
            label="Contract discount"
            value={kesCompact(bill.discount_kes)}
            note={`${bill.discount_pct.toFixed(1)}% off list`}
          />
          <Figure
            label="Calls after discount"
            value={kesCompact(bill.calls_cost_kes)}
            note={
              vsPrevious && previousMonth
                ? `${vsPrevious} vs ${monthLabel(previousMonth, true)}`
                : "no earlier month"
            }
          />
          {company ? (
            <Figure
              label="Total bill"
              value={kesCompact(bill.total_kes)}
              note="calls + line rental"
              strong
            />
          ) : (
            <Figure
              label="Staff with calls"
              value={count(report.staff_with_spend)}
              note="this month"
            />
          )}
        </div>

        <Section
          title="Bill summary"
          description={
            company
              ? `Rebuilt from the call records the way the ${report.home_network_name} invoice is laid out. Call charges include tax.`
              : `${subject}'s call charges, before and after the contract discount. Call charges include tax. The line rental is a company cost and is not shared out to departments.`
          }
        >
          <table className="w-full text-sm">
            <tbody>
              <BillRow
                label="Call charges at list price"
                value={money(bill.calls_list_cost_kes)}
              />
              <BillRow
                label={`Less contract discount (${bill.discount_pct.toFixed(1)}%)`}
                value={`−${money(bill.discount_kes)}`}
              />
              <BillRow
                label="Call charges after discount"
                value={money(bill.calls_cost_kes)}
                subtotal
              />
              {company ? (
                <>
                  <BillRow
                    label="Fixed line rental (before tax)"
                    value={money(bill.fixed_charge_kes)}
                  />
                  <BillRow
                    label={`Excise duty on rental (${bill.excise_rate_pct}%)`}
                    value={money(bill.excise_kes)}
                  />
                  <BillRow
                    label={`VAT on rental (${bill.vat_rate_pct}%)`}
                    value={money(bill.vat_kes)}
                  />
                  <BillRow
                    label="Total for the month"
                    value={`KES ${money(bill.total_kes)}`}
                    total
                  />
                </>
              ) : null}
            </tbody>
          </table>

          {company ? (
            <div className="mt-4 rounded border border-neutral-300 px-4 py-3 text-sm">
              {bill.invoice_total_kes !== null &&
              bill.invoice_total_kes !== undefined ? (
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
                  <dt>{report.home_network_name} invoice total</dt>
                  <dd className="font-tabular text-right">
                    KES {money(bill.invoice_total_kes)}
                  </dd>
                  <dt>Difference (rebuilt − invoice)</dt>
                  <dd className="font-tabular text-right font-medium">
                    {(bill.difference_kes ?? 0) >= 0 ? "+" : "−"}
                    {money(Math.abs(bill.difference_kes ?? 0))}
                    {bill.difference_pct !== null &&
                    bill.difference_pct !== undefined
                      ? ` (${bill.difference_pct >= 0 ? "+" : "−"}${Math.abs(bill.difference_pct).toFixed(2)}%)`
                      : ""}
                  </dd>
                  {bill.invoice_note ? (
                    <dd className="col-span-2 text-xs text-neutral-600">
                      Note: {bill.invoice_note}
                    </dd>
                  ) : null}
                </dl>
              ) : (
                <p className="text-neutral-600">
                  No {report.home_network_name} invoice total has been entered
                  for {period}, so there is nothing to compare the rebuilt bill
                  against. Enter it under Bill reconciliation.
                </p>
              )}
            </div>
          ) : null}
        </Section>
        <Section
          title="Call spend by month"
          description="After the contract discount; line rental not included."
        >
          <ReportColumns
            points={report.trend.map((t) => ({
              label: monthLabel(t.month, true),
              value: t.cost_kes,
              display: kesCompact(t.cost_kes),
              partial: t.days_covered < t.days_in_month,
            }))}
          />
        </Section>
        {footer(1)}
      </ReportPage>

      {/* ---- Page 2: departments (company report only) -------------------- */}
      {company ? (
        <ReportPage>
          <PageTitle
            title="Spend per department"
            period={period}
            description="Call charges after the contract discount, by the department of whoever placed the call."
          />
          <Section title="Share of call spend">
            {report.departments.length <= 5 ? (
              <ReportDonut
                centerLabel="Calls"
                centerValue={kesCompact(bill.calls_cost_kes)}
                slices={report.departments.map((d) => ({
                  label: d.name,
                  value: d.cost_kes,
                  display: `KES ${money(d.cost_kes)}`,
                }))}
              />
            ) : (
              <ReportBars
                rows={report.departments.map((d) => ({
                  label: d.name,
                  value: d.cost_kes,
                  display: `KES ${money(d.cost_kes)}`,
                  note: `${d.share_pct.toFixed(0)}%`,
                }))}
              />
            )}
          </Section>

          <Section title="Department detail">
            <DepartmentTable report={report} previousMonth={previousMonth} />
            {report.unassigned_cost_kes > 0 ? (
              <p className="mt-2 text-xs text-neutral-600">
                A further KES {money(report.unassigned_cost_kes)} was spent by
                staff not assigned to a department.
              </p>
            ) : null}
          </Section>

          <Section
            title="Against budget"
            description="Bar: call spend. Black mark: the department's monthly ceiling."
          >
            {budgeted.length > 0 ? (
              <ReportBars
                rows={budgeted.map((d) => ({
                  label: d.name,
                  value: d.cost_kes,
                  display: `${(d.budget_used_pct ?? 0).toFixed(0)}% used`,
                  marker: {
                    value: d.budget_ceiling_kes ?? 0,
                    label: `Ceiling KES ${money(d.budget_ceiling_kes)}`,
                  },
                  note:
                    (d.budget_used_pct ?? 0) > 100 ? "Over budget" : undefined,
                }))}
              />
            ) : (
              <p className="text-sm text-neutral-600">
                No department has a budget ceiling set.
              </p>
            )}
          </Section>
          {footer(2)}
        </ReportPage>
      ) : null}

      {/* ---- Trend and call mix ------------------------------------------- */}
      <ReportPage>
        <PageTitle
          title="Call mix"
          period={period}
          description={`What kinds of calls ${company ? "the company" : subject} made, and how the contract discount applies to them.`}
        />
        {!company ? (
          <Section title="Against budget">
            <DepartmentTable report={report} previousMonth={previousMonth} />
          </Section>
        ) : null}

        <Section
          title="Calls by type"
          description={`${count(totalCalls)} answered calls, ${minutes(totalMinutes)} in total. Shown in minutes: costs are worked out per person per month, not per call.`}
        >
          <ReportDonut
            centerLabel="Minutes"
            centerValue={count(Math.round(totalMinutes))}
            slices={report.call_types.map((t) => ({
              label: CALL_TYPE_LABEL[t.type] ?? t.type,
              value: t.minutes,
              display: `${minutes(t.minutes)} · ${count(t.calls)} calls`,
            }))}
          />
        </Section>

        <Section
          title="Local calls by network and time"
          description={`On-net is a call to another ${report.home_network_name} number. The discount is the contract rate for that kind of call.`}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-400 text-left text-xs text-neutral-600">
                <th className="py-1.5 font-medium">Call kind</th>
                <th className="py-1.5 text-right font-medium">Calls</th>
                <th className="py-1.5 text-right font-medium">Minutes</th>
                <th className="py-1.5 text-right font-medium">Discount</th>
              </tr>
            </thead>
            <tbody>
              {report.local_mix.map((row) => (
                <tr
                  key={`${row.network}-${row.band}`}
                  className="border-b border-neutral-200"
                >
                  <td className="py-1.5">
                    {row.network === "on_net" ? "On-net" : "Off-net"},{" "}
                    {row.band === "peak" ? "peak" : "off-peak"}
                  </td>
                  <td className="font-tabular py-1.5 text-right">
                    {count(row.calls)}
                  </td>
                  <td className="font-tabular py-1.5 text-right">
                    {count(Math.round(row.minutes))}
                  </td>
                  <td className="font-tabular py-1.5 text-right">
                    {row.discount_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        {footer(company ? 3 : 2)}
      </ReportPage>

      {/* ---- International, limits, anomalies, lines ----------------------- */}
      <ReportPage>
        <PageTitle
          title="International calls and controls"
          period={period}
          description="Where international minutes went, and the checks that keep spend in line."
        />
        <Section
          title="Top international destinations"
          description="By minutes on the line. Rate is the list price per minute."
        >
          {report.international_destinations.length > 0 ? (
            <ReportBars
              rows={report.international_destinations.map((d) => ({
                label: d.country_name,
                value: d.minutes,
                display: minutes(d.minutes),
                note: `${count(d.calls)} calls · KES ${d.rate_kes_per_minute}/min`,
              }))}
            />
          ) : (
            <p className="text-sm text-neutral-600">
              No international calls were placed in {period}.
            </p>
          )}
        </Section>

        <div className="grid gap-x-8 sm:grid-cols-2">
          <Section title="Personal spending limits">
            <dl className="text-sm">
              <Fact
                label="Staff with calls this month"
                value={count(report.staff_with_spend)}
              />
              <Fact
                label="Staff over their limit"
                value={count(report.limits.over_limit_count)}
              />
              <Fact
                label="Total over the limits"
                value={`KES ${money(report.limits.over_limit_total_kes)}`}
              />
            </dl>
            <p className="mt-2 text-xs text-neutral-600">
              The amount over is what gets invoiced back to those staff.
            </p>
          </Section>

          <Section title="Unusual calls">
            <dl className="text-sm">
              <Fact
                label="Calls flagged"
                value={count(report.anomalies.flagged)}
              />
              <Fact
                label="Reviewed and resolved"
                value={count(report.anomalies.resolved)}
              />
              <Fact label="Still open" value={count(report.anomalies.open)} />
            </dl>
          </Section>

          <Section
            title="Lines"
            description="The inventory as it stands today."
          >
            <dl className="text-sm">
              {company ? (
                <>
                  <Fact label="SIM cards" value={count(report.lines.total)} />
                  <Fact label="In service" value={count(report.lines.active)} />
                </>
              ) : null}
              <Fact
                label="Allocated to staff"
                value={count(report.lines.allocated)}
              />
              {company ? (
                <Fact
                  label="In service, unallocated"
                  value={count(report.lines.unallocated)}
                />
              ) : null}
              <Fact
                label="Call spend per allocated line"
                value={
                  report.lines.cost_per_allocated_line_kes === null
                    ? "—"
                    : `KES ${money(report.lines.cost_per_allocated_line_kes)}`
                }
              />
            </dl>
          </Section>

          <Section title="How to read this report">
            <ul className="list-disc space-y-1 ps-4 text-xs text-neutral-700">
              <li>
                Only answered calls placed from a company extension are counted.
              </li>
              <li>
                List price is the {report.home_network_name} tariff including
                tax; the contract discount is taken off that.
              </li>
              <li>Internal extension-to-extension calls are free.</li>
              <li>No individual is named; figures are totals.</li>
            </ul>
          </Section>
        </div>
        {footer(pages)}
      </ReportPage>
    </div>
  );
}

function DepartmentTable({
  report,
  previousMonth,
}: {
  report: MonthlyReport;
  previousMonth: string | undefined;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-neutral-400 text-left text-xs text-neutral-600">
          <th className="py-1.5 font-medium">Department</th>
          <th className="py-1.5 text-right font-medium">Staff</th>
          <th className="py-1.5 text-right font-medium">Before discount</th>
          <th className="py-1.5 text-right font-medium">After discount</th>
          <th className="py-1.5 text-right font-medium">
            vs {previousMonth ? monthLabel(previousMonth, true) : "prev."}
          </th>
          <th className="py-1.5 text-right font-medium">Budget</th>
        </tr>
      </thead>
      <tbody>
        {report.departments.map((d) => (
          <tr key={d.id} className="border-b border-neutral-200">
            <td className="py-1.5">{d.name}</td>
            <td className="font-tabular py-1.5 text-right">{count(d.staff)}</td>
            <td className="font-tabular py-1.5 text-right">
              {money(d.list_cost_kes)}
            </td>
            <td className="font-tabular py-1.5 text-right font-medium">
              {money(d.cost_kes)}
            </td>
            <td className="font-tabular py-1.5 text-right">
              {change(d.cost_kes, d.previous_cost_kes) ?? "—"}
            </td>
            <td className="font-tabular py-1.5 text-right">
              {d.budget_ceiling_kes === null
                ? "—"
                : `${money(d.budget_ceiling_kes)} (${(d.budget_used_pct ?? 0).toFixed(0)}%)`}
            </td>
          </tr>
        ))}
      </tbody>
      {report.scope.type === "company" ? (
        <tfoot>
          <tr className="border-t-2 border-neutral-900 font-semibold">
            <td className="py-1.5">Total</td>
            <td className="font-tabular py-1.5 text-right">
              {count(report.staff_with_spend)}
            </td>
            <td className="font-tabular py-1.5 text-right">
              {money(report.bill.calls_list_cost_kes)}
            </td>
            <td className="font-tabular py-1.5 text-right">
              {money(report.bill.calls_cost_kes)}
            </td>
            <td className="font-tabular py-1.5 text-right">
              {change(
                report.bill.calls_cost_kes,
                report.bill.previous_calls_cost_kes,
              ) ?? "—"}
            </td>
            <td />
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

function ReportPage({ children }: { children: ReactNode }) {
  return (
    <section className="report-page mx-auto flex w-full max-w-[210mm] flex-col bg-white px-5 py-8 text-neutral-900 shadow-md sm:px-12 sm:py-12 md:min-h-[297mm] print:min-h-0 print:max-w-none print:px-0 print:py-0 print:shadow-none">
      {children}
    </section>
  );
}

function PageTitle({
  title,
  period,
  description,
}: {
  title: string;
  period: string;
  description: string;
}) {
  return (
    <header className="border-b border-neutral-400 pb-3">
      <p className="text-xs font-medium tracking-widest text-neutral-500 uppercase">
        {period}
      </p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-neutral-600">{description}</p>
    </header>
  );
}

function PageFooter({ left, right }: { left: string; right: string }) {
  return (
    <footer className="mt-auto flex justify-between gap-4 border-t border-neutral-300 pt-3 text-[11px] text-neutral-500">
      <span>{left}</span>
      <span className="shrink-0">{right}</span>
    </footer>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-7 break-inside-avoid">
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? (
        <p className="mt-0.5 text-xs text-neutral-600">{description}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Figure({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: string;
  note: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`rounded border px-3 py-2.5 ${strong ? "border-neutral-900" : "border-neutral-300"}`}
    >
      <p className="text-[11px] text-neutral-600">{label}</p>
      <p className="font-tabular mt-0.5 text-lg font-semibold">{value}</p>
      <p className="text-[11px] text-neutral-500">{note}</p>
    </div>
  );
}

function BillRow({
  label,
  value,
  subtotal,
  total,
}: {
  label: string;
  value: string;
  subtotal?: boolean;
  total?: boolean;
}) {
  return (
    <tr
      className={
        total
          ? "border-t-2 border-neutral-900 text-base font-semibold"
          : subtotal
            ? "border-y border-neutral-400 font-medium"
            : "border-b border-neutral-200"
      }
    >
      <td className="py-2">{label}</td>
      <td className="font-tabular py-2 text-right">{value}</td>
    </tr>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-neutral-200 py-1.5">
      <dt>{label}</dt>
      <dd className="font-tabular font-medium">{value}</dd>
    </div>
  );
}
