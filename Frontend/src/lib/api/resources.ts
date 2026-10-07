// Every non-auth BackendDotNet endpoint the frontend uses. Request bodies
// are snake_case (RequestBody.JsonOptions uses JsonNamingPolicy.SnakeCaseLower
// — confirmed against BackendDotNet/Core/RequestBody.cs), matching the
// snake_case response shapes already documented in ./types.ts.
import { apiRequest } from "@/lib/api/client";
import type {
  AnomalyFlag,
  ApiEnvelope,
  AuditLogEntry,
  Department,
  DepartmentForecast,
  DirectoryEntry,
  Employee,
  InternationalCallRate,
  LocalCallRateSettings,
  OverLimitEntry,
  Reconciliation,
  RoleRecord,
  SimCard,
  TutorialProgress,
  UsageEvent,
  UsageMonth,
  UsageProfile,
  UsageSummary,
} from "@/lib/api/types";

// The API pages its lists (25 rows by default, 100 at most — see
// Pagination in BackendDotNet/Core/Responses.cs). Screens that show or look
// up the whole list (every employee, every SIM) use this to walk all the
// pages and hand back one combined list.
const ALL_PAGES_LIMIT = 100;

async function fetchAllPages<T>(path: string): Promise<ApiEnvelope<T[]>> {
  const first = await apiRequest<ApiEnvelope<T[]>>(path, {
    query: { page: 1, limit: ALL_PAGES_LIMIT },
  });
  const pages = first.meta?.pages ?? 1;
  if (pages <= 1) return first;
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      apiRequest<ApiEnvelope<T[]>>(path, {
        query: { page: i + 2, limit: ALL_PAGES_LIMIT },
      }),
    ),
  );
  return { ...first, data: [first, ...rest].flatMap((page) => page.data) };
}

// --- Employees --------------------------------------------------------
export const employeesApi = {
  list: () => fetchAllPages<Employee>("/employees"),
  get: (id: string) => apiRequest<ApiEnvelope<Employee>>(`/employees/${id}`),
  create: (body: {
    email: string;
    role: string;
    full_name: string;
    department_id?: string;
    staff_number?: string;
    extension?: string;
  }) =>
    apiRequest<ApiEnvelope<Employee>>("/employees", { method: "POST", body }),
  update: (
    id: string,
    body: Partial<{
      full_name: string;
      department_id: string;
      staff_number: string;
      is_active: boolean;
    }>,
  ) =>
    apiRequest<ApiEnvelope<Employee>>(`/employees/${id}`, {
      method: "PATCH",
      body,
    }),
  remove: (id: string) =>
    apiRequest<ApiEnvelope<null>>(`/employees/${id}`, { method: "DELETE" }),
};

// --- Directory (name + extension lookup, every role) ---------------------
export const directoryApi = {
  list: () => apiRequest<ApiEnvelope<DirectoryEntry[]>>("/directory"),
};

// --- Departments --------------------------------------------------------
export const departmentsApi = {
  list: () => apiRequest<ApiEnvelope<Department[]>>("/departments"),
  create: (body: {
    name: string;
    cost_centre_code?: string;
    budget_ceiling?: number;
  }) =>
    apiRequest<ApiEnvelope<Department>>("/departments", {
      method: "POST",
      body,
    }),
  update: (
    id: string,
    body: Partial<{
      name: string;
      cost_centre_code: string;
      budget_ceiling: number;
    }>,
  ) =>
    apiRequest<ApiEnvelope<Department>>(`/departments/${id}`, {
      method: "PATCH",
      body,
    }),
  spend: (id: string) =>
    apiRequest<
      ApiEnvelope<{
        department_id: string;
        month: string;
        total_spend: number;
        budget_ceiling: number | null;
        budget_status: "unmonitored" | "over_budget" | "within_budget";
      }>
    >(`/departments/${id}/spend`),
};

// --- SIMs --------------------------------------------------------
export const simsApi = {
  list: () => fetchAllPages<SimCard>("/sims"),
  create: (body: {
    iccid: string;
    msisdn: string;
    extension?: string;
    plan_id?: string;
    provider?: string;
  }) => apiRequest<ApiEnvelope<SimCard>>("/sims", { method: "POST", body }),
  update: (
    id: string,
    body: Partial<{
      lifecycle_state: string;
      plan_id: string;
      provider: string;
    }>,
  ) =>
    apiRequest<ApiEnvelope<SimCard>>(`/sims/${id}`, { method: "PATCH", body }),
  allocate: (id: string, employeeId: string) =>
    apiRequest<ApiEnvelope<unknown>>(`/sims/${id}/allocate`, {
      method: "POST",
      body: { employee_id: employeeId },
    }),
  unassign: (id: string) =>
    apiRequest<ApiEnvelope<unknown>>(`/sims/${id}/unassign`, {
      method: "POST",
    }),
};

// --- Telco plans --------------------------------------------------------
export const telcoPlansApi = {
  list: () =>
    apiRequest<
      ApiEnvelope<
        {
          id: string;
          name: string;
          provider: string | null;
          rate_per_minute_kes: number | null;
        }[]
      >
    >("/telco-plans"),
};

// --- Call rates (Admin only) --------------------------------------------------------
export const callRatesApi = {
  getLocal: () =>
    apiRequest<ApiEnvelope<LocalCallRateSettings>>("/call-rates/local"),
  updateLocal: (
    body: Partial<{
      peak_rate_kes: number;
      off_peak_rate_kes: number;
      peak_start_hour: number;
      peak_end_hour: number;
      default_international_rate_kes: number;
      home_network_name: string;
      on_net_prefixes: string;
      discount_on_net_peak_pct: number;
      discount_on_net_off_peak_pct: number;
      discount_off_net_peak_pct: number;
      discount_off_net_off_peak_pct: number;
      discount_international_pct: number;
      fixed_monthly_charge_kes: number;
      excise_rate_pct: number;
      vat_rate_pct: number;
    }>,
  ) =>
    apiRequest<ApiEnvelope<LocalCallRateSettings>>("/call-rates/local", {
      method: "PATCH",
      body,
    }),
  listInternational: () =>
    apiRequest<ApiEnvelope<InternationalCallRate[]>>(
      "/call-rates/international",
    ),
  updateInternational: (
    countryCode: string,
    body: Partial<{ rate_kes_per_minute: number; country_name: string }>,
  ) =>
    apiRequest<ApiEnvelope<InternationalCallRate>>(
      `/call-rates/international/${countryCode}`,
      { method: "PATCH", body },
    ),
};

// --- Bill reconciliation (Admin) -----------------------------------------
export const reconciliationApi = {
  get: () => apiRequest<ApiEnvelope<Reconciliation>>("/reconciliation"),
  /** `invoice_total_kes: null` clears the month's invoice. */
  setInvoice: (
    month: string,
    body: { invoice_total_kes: number | null; note?: string },
  ) =>
    apiRequest<ApiEnvelope<unknown>>(`/reconciliation/${month}`, {
      method: "PUT",
      body,
    }),
};

// --- Usage --------------------------------------------------------
export const usageApi = {
  list: (params?: {
    classification?: string;
    extension?: string;
    search?: string;
    month?: string;
    page?: number;
    limit?: number;
  }) => apiRequest<ApiEnvelope<UsageEvent[]>>("/usage", { query: params }),
  months: () => apiRequest<ApiEnvelope<UsageMonth[]>>("/usage/months"),
  mine: (params?: { page?: number; limit?: number }) =>
    apiRequest<
      ApiEnvelope<{
        usage: UsageEvent[];
        cost_summaries: UsageSummary[];
        current_allocation: unknown;
        current_sim: SimCard | null;
        usage_profile_cluster: string | null;
        limit_kshs: number | null;
      }>
    >("/me/usage", { query: params }),
};

// --- Analytics --------------------------------------------------------
export const analyticsApi = {
  anomalies: (resolved?: boolean) =>
    apiRequest<ApiEnvelope<AnomalyFlag[]>>("/analytics/anomalies", {
      query: resolved === undefined ? undefined : { resolved },
    }),
  resolveAnomaly: (flagId: string) =>
    apiRequest<ApiEnvelope<AnomalyFlag>>(
      `/analytics/anomalies/${flagId}/resolve`,
      { method: "POST" },
    ),
  profiles: () =>
    apiRequest<ApiEnvelope<UsageProfile[]>>("/analytics/profiles"),
  usageSummary: (month?: string) =>
    apiRequest<ApiEnvelope<UsageSummary[]>>("/analytics/usage-summary", {
      query: month ? { month } : undefined,
    }),
  forecast: (departmentId: string) =>
    apiRequest<ApiEnvelope<DepartmentForecast>>(`/forecast/${departmentId}`),
};

// --- Budgets --------------------------------------------------------
export const budgetsApi = {
  overLimit: (month?: string) =>
    apiRequest<ApiEnvelope<OverLimitEntry[]>>("/budgets/over-limit", {
      query: month ? { month } : undefined,
    }),
};

// --- Roles --------------------------------------------------------
export const rolesApi = {
  list: () => apiRequest<ApiEnvelope<RoleRecord[]>>("/roles"),
  update: (
    id: string,
    body: Partial<{ call_limit_kshs: number; permissions: string[] }>,
  ) =>
    apiRequest<ApiEnvelope<RoleRecord>>(`/roles/${id}`, {
      method: "PATCH",
      body,
    }),
};

// --- Audit --------------------------------------------------------
export const auditApi = {
  list: (params?: { page?: number; limit?: number }) =>
    apiRequest<ApiEnvelope<AuditLogEntry[]>>("/audit", { query: params }),
};

// --- Settings (self-service) --------------------------------------------------------
export const settingsApi = {
  me: () =>
    apiRequest<ApiEnvelope<Employee & { email: string }>>("/settings/me"),
  updateMe: (body: { full_name?: string }) =>
    apiRequest<ApiEnvelope<unknown>>("/settings/me", { method: "PATCH", body }),
};

// --- Tutorial --------------------------------------------------------
export const tutorialApi = {
  progress: () =>
    apiRequest<ApiEnvelope<TutorialProgress>>("/tutorial/progress"),
  markStep: (stepId: string, completed: boolean) =>
    apiRequest<ApiEnvelope<{ step_id: string; completed: boolean }>>(
      "/tutorial/progress",
      {
        method: "POST",
        body: { step_id: stepId, completed },
      },
    ),
  dismiss: () =>
    apiRequest<ApiEnvelope<null>>("/tutorial/dismiss", { method: "POST" }),
  restart: () =>
    apiRequest<ApiEnvelope<null>>("/tutorial/restart", { method: "POST" }),
};

// --- CDR ingestion --------------------------------------------------------
export const cdrApi = {
  ingest: (records: Record<string, unknown>[], sourceFile?: string) =>
    apiRequest<
      ApiEnvelope<{
        ingested: number;
        attributed: number;
        unattributed: number;
      }>
    >("/cdr/ingest", {
      method: "POST",
      body: { records, source_file: sourceFile },
    }),
};

// --- Invoices --------------------------------------------------------
export const invoicesApi = {
  /** Emails an invoice to each employee over their limit in `month`
   * (the latest billed month when omitted), for the amount over. */
  sendMonthly: (month?: string) =>
    apiRequest<
      ApiEnvelope<{ month: string | null; sent: number; over_limit: number }>
    >("/invoices/send-monthly", { method: "POST", body: { month } }),
};
