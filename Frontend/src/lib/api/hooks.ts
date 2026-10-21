"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  analyticsApi,
  auditApi,
  budgetsApi,
  callRatesApi,
  cdrApi,
  departmentsApi,
  directoryApi,
  employeesApi,
  invoicesApi,
  numberFormatApi,
  reconciliationApi,
  reportsApi,
  rolesApi,
  simsApi,
  stepUpApi,
  telcoPlansApi,
  ticketsApi,
  tutorialApi,
  usageApi,
  type TicketScope,
} from "@/lib/api/resources";
import type { HandoverFields, TicketStatus } from "@/lib/api/types";

// One hook per read, one mutation per write — thin wrappers so screens
// never import lib/api/resources.ts directly and every cache key lives in
// exactly one place.

export const queryKeys = {
  employees: ["employees"] as const,
  directory: ["directory"] as const,
  departments: ["departments"] as const,
  departmentSpend: (id: string) => ["departments", id, "spend"] as const,
  departmentsOverview: (month?: string) =>
    ["departments", "overview", month] as const,
  sims: ["sims"] as const,
  unassignedUsage: ["sims", "unassigned-usage"] as const,
  telcoPlans: ["telco-plans"] as const,
  usage: (params?: Record<string, unknown>) => ["usage", params] as const,
  usageMonths: ["usage", "months"] as const,
  myUsage: ["me", "usage"] as const,
  anomalies: (resolved?: boolean) =>
    ["analytics", "anomalies", resolved] as const,
  profiles: ["analytics", "profiles"] as const,
  usageSummary: (month?: string) =>
    ["analytics", "usage-summary", month] as const,
  forecast: (departmentId: string) => ["forecast", departmentId] as const,
  reconciliation: ["reconciliation"] as const,
  overLimit: (month?: string) => ["budgets", "over-limit", month] as const,
  roles: ["roles"] as const,
  audit: (params?: Record<string, unknown>) => ["audit", params] as const,
  tutorial: ["tutorial", "progress"] as const,
  localCallRate: ["call-rates", "local"] as const,
  internationalCallRates: ["call-rates", "international"] as const,
  numberFormat: ["settings", "number-format"] as const,
  monthlyReport: (month?: string) => ["reports", "monthly", month] as const,
  tickets: ["tickets"] as const,
  ticketAccess: ["tickets", "me"] as const,
  ticketList: (scope: TicketScope, status?: TicketStatus) =>
    ["tickets", "list", scope, status] as const,
  ticket: (id: string) => ["tickets", "detail", id] as const,
  ticketStats: (month?: string) => ["tickets", "stats", month] as const,
  ticketCategories: (includeInactive: boolean) =>
    ["tickets", "categories", includeInactive] as const,
};

/** Who holds which line shows up on three screens — the employee list, the
 * SIM inventory and the directory — so any change to it refreshes all
 * three. */
function invalidateLineHolders(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.employees });
  queryClient.invalidateQueries({ queryKey: queryKeys.sims });
  queryClient.invalidateQueries({ queryKey: queryKeys.directory });
}

/** The name + extension directory behind the Ctrl+K search. Only fetched
 * once it's wanted (`enabled`), then kept for a few minutes — it changes
 * rarely, and reopening the search should be instant. */
export function useDirectory(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.directory,
    queryFn: directoryApi.list,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEmployees() {
  return useQuery({
    queryKey: queryKeys.employees,
    queryFn: employeesApi.list,
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof employeesApi.update>[1];
    }) => employeesApi.update(id, body),
    onSettled: () => invalidateLineHolders(queryClient),
  });
}

/** Removes an employee who left the company (step-up required). */
export function useRemoveEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof employeesApi.removeLeaver>[1];
    }) => employeesApi.removeLeaver(id, body),
    onSettled: () => invalidateLineHolders(queryClient),
  });
}

/** Emails the signed-in Admin a step-up code. */
export function useRequestStepUpCode() {
  return useMutation({ mutationFn: stepUpApi.requestCode });
}

/** Spend on lines nobody held — Admin only. */
export function useUnassignedUsage(enabled = true) {
  return useQuery({
    queryKey: queryKeys.unassignedUsage,
    queryFn: simsApi.unassignedUsage,
    enabled,
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: employeesApi.create,
    onSettled: () => invalidateLineHolders(queryClient),
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: queryKeys.departments,
    queryFn: departmentsApi.list,
  });
}

export function useDepartmentsOverview(month?: string) {
  return useQuery({
    queryKey: queryKeys.departmentsOverview(month),
    queryFn: () => departmentsApi.overview(month),
    placeholderData: keepPreviousData,
  });
}

export function useDepartmentSpend(id: string) {
  return useQuery({
    queryKey: queryKeys.departmentSpend(id),
    queryFn: () => departmentsApi.spend(id),
    enabled: !!id,
  });
}

export function useUpdateDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof departmentsApi.update>[1];
    }) => departmentsApi.update(id, body),
    // A rename or the desk switch also changes the ticket desk/queues.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.departments });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tickets });
    },
  });
}

export function useSims() {
  return useQuery({ queryKey: queryKeys.sims, queryFn: simsApi.list });
}

export function useTelcoPlans() {
  return useQuery({
    queryKey: queryKeys.telcoPlans,
    queryFn: telcoPlansApi.list,
  });
}

export function useAllocateSim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      simId,
      employeeId,
      handover,
    }: {
      simId: string;
      employeeId: string;
      handover?: HandoverFields;
    }) => simsApi.allocate(simId, employeeId, handover),
    onSettled: () => invalidateLineHolders(queryClient),
  });
}

export function useUnassignSim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (simId: string) => simsApi.unassign(simId),
    onSettled: () => invalidateLineHolders(queryClient),
  });
}

export function useCreateSim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: simsApi.create,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.sims }),
  });
}

export function useUsage(
  params?: {
    classification?: string;
    extension?: string;
    search?: string;
    month?: string;
    page?: number;
    limit?: number;
  },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.usage(params),
    queryFn: () => usageApi.list(params),
    enabled: options?.enabled ?? true,
    // Keep the current page on screen while the next one loads, instead of
    // dropping back to the loading skeleton on every page change.
    placeholderData: keepPreviousData,
  });
}

export function useUsageMonths() {
  return useQuery({
    queryKey: queryKeys.usageMonths,
    queryFn: usageApi.months,
  });
}

/** `month` ("YYYY-MM") narrows the returned calls to that month; cost
 * summaries always cover every month. */
export function useMyUsage(month?: string) {
  return useQuery({
    queryKey: [...queryKeys.myUsage, month ?? "latest"],
    queryFn: () => usageApi.mine(month ? { month } : undefined),
    placeholderData: keepPreviousData,
  });
}

export function useAnomalies(resolved?: boolean) {
  return useQuery({
    queryKey: queryKeys.anomalies(resolved),
    queryFn: () => analyticsApi.anomalies(resolved),
  });
}

export function useResolveAnomaly() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: analyticsApi.resolveAnomaly,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["analytics", "anomalies"] }),
  });
}

export function useUsageProfiles() {
  return useQuery({
    queryKey: queryKeys.profiles,
    queryFn: analyticsApi.profiles,
  });
}

export function useUsageSummary(month?: string) {
  return useQuery({
    queryKey: queryKeys.usageSummary(month),
    queryFn: () => analyticsApi.usageSummary(month),
  });
}

export function useDepartmentForecast(departmentId: string) {
  return useQuery({
    queryKey: queryKeys.forecast(departmentId),
    queryFn: () => analyticsApi.forecast(departmentId),
    enabled: !!departmentId,
  });
}

export function useOverLimit(month?: string) {
  return useQuery({
    queryKey: queryKeys.overLimit(month),
    queryFn: () => budgetsApi.overLimit(month),
  });
}

export function useRoles() {
  return useQuery({ queryKey: queryKeys.roles, queryFn: rolesApi.list });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof rolesApi.update>[1];
    }) => rolesApi.update(id, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.roles }),
  });
}

export function useLocalCallRate() {
  return useQuery({
    queryKey: queryKeys.localCallRate,
    queryFn: callRatesApi.getLocal,
  });
}

export function useUpdateLocalCallRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: callRatesApi.updateLocal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.localCallRate });
      // The fixed charge and tax rates feed the rebuilt bill.
      queryClient.invalidateQueries({ queryKey: queryKeys.reconciliation });
    },
  });
}

export function useNumberFormat() {
  return useQuery({
    queryKey: queryKeys.numberFormat,
    queryFn: numberFormatApi.get,
  });
}

export function useUpdateNumberFormat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: numberFormatApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.numberFormat });
      // Renumbering changes the numbers the SIM and employee lists show.
      invalidateLineHolders(queryClient);
    },
  });
}

export function useMonthlyReport(month?: string) {
  return useQuery({
    queryKey: queryKeys.monthlyReport(month),
    queryFn: () => reportsApi.monthly(month),
    placeholderData: keepPreviousData,
  });
}

export function useReconciliation() {
  return useQuery({
    queryKey: queryKeys.reconciliation,
    queryFn: reconciliationApi.get,
  });
}

export function useSetMonthlyInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      month,
      invoiceTotalKes,
    }: {
      month: string;
      invoiceTotalKes: number | null;
    }) =>
      reconciliationApi.setInvoice(month, {
        invoice_total_kes: invoiceTotalKes,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.reconciliation }),
  });
}

export function useInternationalCallRates() {
  return useQuery({
    queryKey: queryKeys.internationalCallRates,
    queryFn: callRatesApi.listInternational,
  });
}

export function useUpdateInternationalCallRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      countryCode,
      body,
    }: {
      countryCode: string;
      body: Parameters<typeof callRatesApi.updateInternational>[1];
    }) => callRatesApi.updateInternational(countryCode, body),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.internationalCallRates,
      }),
  });
}

export function useAuditLog(params?: Parameters<typeof auditApi.list>[0]) {
  return useQuery({
    queryKey: queryKeys.audit(params),
    queryFn: () => auditApi.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useIngestCdr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      records,
      sourceFile,
    }: {
      records: Record<string, unknown>[];
      sourceFile?: string;
    }) => cdrApi.ingest(records, sourceFile),
    // A batch sets up a SIM and a holder for any extension it's the first
    // to mention.
    onSuccess: () => invalidateLineHolders(queryClient),
  });
}

export function useSendMonthlyInvoices() {
  return useMutation({ mutationFn: invoicesApi.sendMonthly });
}

export function useReportOverLimitToHr() {
  return useMutation({ mutationFn: invoicesApi.reportToHr });
}

export function useTutorialProgress() {
  return useQuery({
    queryKey: queryKeys.tutorial,
    queryFn: tutorialApi.progress,
  });
}

export function useMarkTutorialStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      stepId,
      completed,
    }: {
      stepId: string;
      completed: boolean;
    }) => tutorialApi.markStep(stepId, completed),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.tutorial }),
  });
}

export function useDismissTutorial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: tutorialApi.dismiss,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.tutorial }),
  });
}

export function useRestartTutorial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: tutorialApi.restart,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.tutorial }),
  });
}

// --- Customer service tickets --------------------------------------------

/** What the ticket desk means for the signed-in person: whether they work
 * the desk, and whether their department gets a team queue. */
export function useTicketAccess() {
  return useQuery({
    queryKey: queryKeys.ticketAccess,
    queryFn: ticketsApi.me,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTickets(
  scope: TicketScope,
  status?: TicketStatus,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.ticketList(scope, status),
    queryFn: () => ticketsApi.list(scope, status),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: queryKeys.ticket(id),
    queryFn: () => ticketsApi.get(id),
    enabled: !!id,
  });
}

export function useTicketStats(month?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ticketStats(month),
    queryFn: () => ticketsApi.stats(month),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTicketCategories(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.ticketCategories(includeInactive),
    queryFn: () => ticketsApi.categories(includeInactive),
  });
}

/** Every ticket action changes lists, counts and the detail view at once,
 * so each one refreshes everything ticket-shaped. */
function useTicketMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.tickets }),
  });
}

export function useCreateTicket() {
  return useTicketMutation(ticketsApi.create);
}

export function useClaimTicket() {
  return useTicketMutation((id: string) => ticketsApi.claim(id));
}

export function useAddTicketNote() {
  return useTicketMutation(({ id, body }: { id: string; body: string }) =>
    ticketsApi.addNote(id, body),
  );
}

export function useResolveTicket() {
  return useTicketMutation(({ id, note }: { id: string; note: string }) =>
    ticketsApi.resolve(id, note),
  );
}

export function useReturnTicket() {
  return useTicketMutation(({ id, reason }: { id: string; reason: string }) =>
    ticketsApi.returnToDesk(id, reason),
  );
}

export function useResendTicket() {
  return useTicketMutation(
    ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof ticketsApi.resend>[1];
    }) => ticketsApi.resend(id, body),
  );
}

export function useCreateTicketCategory() {
  return useTicketMutation(ticketsApi.createCategory);
}

export function useUpdateTicketCategory() {
  return useTicketMutation(
    ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof ticketsApi.updateCategory>[1];
    }) => ticketsApi.updateCategory(id, body),
  );
}
