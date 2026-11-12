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
import type {
  AnomalyFlag,
  ApiEnvelope,
  Department,
  HandoverFields,
  Ticket,
  TicketCategory,
  TicketEvent,
  TicketRejectReason,
  TicketStatus,
} from "@/lib/api/types";
import { useSession } from "@/lib/auth/session-store";

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
  cdrBatches: (params?: Record<string, unknown>) =>
    ["cdr-batches", params] as const,
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
  slaTargets: ["tickets", "sla-targets"] as const,
  slaReport: (month?: string) => ["tickets", "sla", month] as const,
  ticketAssignees: (departmentId: string) =>
    ["tickets", "assignees", departmentId] as const,
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

/** Instant feedback: apply a change to the cached data straight away, so
 * the screen updates before the server answers. Returns the undo for when
 * the server refuses — the screen then snaps back (and the caller shows the
 * error). Only for simple actions the server almost never rejects. */
async function patchCache<T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  update: (old: T) => T,
  exact = false,
) {
  await queryClient.cancelQueries({ queryKey, exact });
  const before = queryClient.getQueriesData<T>({ queryKey, exact });
  queryClient.setQueriesData<T>({ queryKey, exact }, (old) =>
    old === undefined ? old : update(old),
  );
  return () =>
    before.forEach(([key, data]) => queryClient.setQueryData(key, data));
}

/** Who "I" am in an optimistic ticket event. */
function myName() {
  return useSession.getState().user?.full_name ?? "You";
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
    onMutate: async ({ id, body }) => ({
      undo: await patchCache<ApiEnvelope<Department[]>>(
        queryClient,
        queryKeys.departments,
        (old) => ({
          ...old,
          data: old.data.map((d) => (d.id === id ? { ...d, ...body } : d)),
        }),
        true,
      ),
    }),
    onError: (_error, _vars, context) => context?.undo(),
    // A rename or the desk switch also changes the ticket desk/queues.
    onSettled: () => {
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
    onMutate: async (flagId: string) => ({
      undo: await patchCache<ApiEnvelope<AnomalyFlag[]>>(
        queryClient,
        ["analytics", "anomalies"],
        (old) => ({
          ...old,
          data: old.data.map((f) =>
            f.id === flagId
              ? { ...f, resolved: true, resolved_at: new Date().toISOString() }
              : f,
          ),
        }),
      ),
    }),
    onError: (_error, _id, context) => context?.undo(),
    onSettled: () =>
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

export function useCdrBatches(params?: Parameters<typeof cdrApi.batches>[0]) {
  return useQuery({
    queryKey: queryKeys.cdrBatches(params),
    queryFn: () => cdrApi.batches(params),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cdr-batches"] });
      return invalidateLineHolders(queryClient);
    },
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

/** Hours to resolve per priority — the new ticket form shows them. */
export function useSlaTargets() {
  return useQuery({
    queryKey: queryKeys.slaTargets,
    queryFn: ticketsApi.slaTargets,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSlaReport(month?: string) {
  return useQuery({
    queryKey: queryKeys.slaReport(month),
    queryFn: () => ticketsApi.slaReport(month),
    placeholderData: keepPreviousData,
  });
}

/** Who in a department a ticket can be sent to directly. */
export function useTicketAssignees(departmentId: string) {
  return useQuery({
    queryKey: queryKeys.ticketAssignees(departmentId),
    queryFn: () => ticketsApi.assignees(departmentId),
    enabled: !!departmentId,
    staleTime: 5 * 60 * 1000,
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
  /** Optional instant change to the cache while the request runs. */
  optimistic?: (queryClient: QueryClient, args: TArgs) => Promise<() => void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: async (args: TArgs) => ({
      undo: optimistic ? await optimistic(queryClient, args) : undefined,
    }),
    onError: (_error, _args, context) => context?.undo?.(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.tickets }),
  });
}

/** Instantly add an event to an open ticket (and change its fields). */
function patchTicket(
  queryClient: QueryClient,
  id: string,
  event: Pick<TicketEvent, "kind" | "body">,
  fields: Partial<Ticket> = {},
) {
  const now = new Date().toISOString();
  return patchCache<ApiEnvelope<Ticket>>(
    queryClient,
    queryKeys.ticket(id),
    (old) => ({
      ...old,
      data: {
        ...old.data,
        ...fields,
        events: [
          ...(old.data.events ?? []),
          {
            ...event,
            id: `pending-${now}`,
            actor_user_id: useSession.getState().user?.id,
            actor_name: myName(),
            created_at: now,
          },
        ],
      },
    }),
  );
}

export function useCreateTicket() {
  return useTicketMutation(ticketsApi.create);
}

export function useClaimTicket() {
  return useTicketMutation(
    (id: string) => ticketsApi.claim(id),
    (queryClient, id) =>
      patchTicket(
        queryClient,
        id,
        { kind: "claimed", body: null },
        {
          status: "in_progress",
          claimed_by_id: useSession.getState().user?.id ?? null,
          claimed_by_name: myName(),
          claimed_at: new Date().toISOString(),
        },
      ),
  );
}

export function useAddTicketNote() {
  return useTicketMutation(
    ({ id, body }: { id: string; body: string }) =>
      ticketsApi.addNote(id, body),
    (queryClient, { id, body }) =>
      patchTicket(queryClient, id, { kind: "note", body }),
  );
}

export function useResolveTicket() {
  return useTicketMutation(({ id, note }: { id: string; note: string }) =>
    ticketsApi.resolve(id, note),
  );
}

export function useRejectTicket() {
  return useTicketMutation(
    ({
      id,
      reasonCode,
      reason,
    }: {
      id: string;
      reasonCode: TicketRejectReason;
      reason?: string;
    }) => ticketsApi.reject(id, reasonCode, reason),
  );
}

export function useReleaseTicket() {
  return useTicketMutation((id: string) => ticketsApi.release(id));
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

export function useUpdateSlaTargets() {
  return useTicketMutation(ticketsApi.updateSlaTargets);
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
    (queryClient, { id, body }) =>
      patchCache<ApiEnvelope<TicketCategory[]>>(
        queryClient,
        ["tickets", "categories"],
        (old) => ({
          ...old,
          data: old.data.map((c) => (c.id === id ? { ...c, ...body } : c)),
        }),
      ),
  );
}
