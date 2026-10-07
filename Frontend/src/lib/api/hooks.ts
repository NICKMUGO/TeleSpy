"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
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
  reconciliationApi,
  rolesApi,
  simsApi,
  telcoPlansApi,
  tutorialApi,
  usageApi,
} from "@/lib/api/resources";

// One hook per read, one mutation per write — thin wrappers so screens
// never import lib/api/resources.ts directly and every cache key lives in
// exactly one place.

export const queryKeys = {
  employees: ["employees"] as const,
  directory: ["directory"] as const,
  departments: ["departments"] as const,
  departmentSpend: (id: string) => ["departments", id, "spend"] as const,
  sims: ["sims"] as const,
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
  audit: ["audit"] as const,
  tutorial: ["tutorial", "progress"] as const,
  localCallRate: ["call-rates", "local"] as const,
  internationalCallRates: ["call-rates", "international"] as const,
};

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.employees });
      queryClient.invalidateQueries({ queryKey: queryKeys.directory });
    },
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: employeesApi.create,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.employees }),
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: queryKeys.departments,
    queryFn: departmentsApi.list,
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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.departments }),
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
    }: {
      simId: string;
      employeeId: string;
    }) => simsApi.allocate(simId, employeeId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.sims }),
  });
}

export function useUnassignSim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (simId: string) => simsApi.unassign(simId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.sims }),
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

export function useUsage(params?: {
  classification?: string;
  extension?: string;
  search?: string;
  month?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: queryKeys.usage(params),
    queryFn: () => usageApi.list(params),
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

export function useMyUsage() {
  return useQuery({
    queryKey: queryKeys.myUsage,
    queryFn: () => usageApi.mine(),
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

export function useAuditLog() {
  return useQuery({
    queryKey: queryKeys.audit,
    queryFn: () => auditApi.list(),
  });
}

export function useIngestCdr() {
  return useMutation({
    mutationFn: ({
      records,
      sourceFile,
    }: {
      records: Record<string, unknown>[];
      sourceFile?: string;
    }) => cdrApi.ingest(records, sourceFile),
  });
}

export function useSendMonthlyInvoices() {
  return useMutation({ mutationFn: invoicesApi.sendMonthly });
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
