// Every non-auth BackendDotNet endpoint the frontend uses. Request bodies
// are snake_case (RequestBody.JsonOptions uses JsonNamingPolicy.SnakeCaseLower
// — confirmed against BackendDotNet/Core/RequestBody.cs), matching the
// snake_case response shapes already documented in ./types.ts.
import { apiRequest } from "@/lib/api/client";
import type {
  AnomalyFlag,
  ApiEnvelope,
  CdrIngestBatch,
  Department,
  DepartmentForecast,
  DepartmentsOverview,
  DirectoryEntry,
  FeedbackView,
  TicketRejectReason,
  Employee,
  HandoverFields,
  InternationalCallRate,
  LocalCallRateSettings,
  MonthlyReport,
  NumberFormat,
  OverLimitEntry,
  Reconciliation,
  RemovalReason,
  RoleRecord,
  SimCard,
  SlaReport,
  Ticket,
  TicketAccess,
  TicketAssignee,
  TicketCategory,
  TicketPriority,
  TicketStats,
  TicketStatus,
  TutorialProgress,
  UnassignedLineUsage,
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
/** Create/update also name anyone stepped down to Employee because this
 * person became their department's Manager (one Manager per department). */
type EmployeeSaved = ApiEnvelope<Employee> & {
  replaced_managers?: string[];
  /** True when this save made someone else Admin: the caller is now an
   * Employee and their session has been ended. */
  admin_handed_over?: boolean;
};

export const employeesApi = {
  list: () => fetchAllPages<Employee>("/employees"),
  get: (id: string) => apiRequest<ApiEnvelope<Employee>>(`/employees/${id}`),
  create: (
    body: {
      email: string;
      role: string;
      full_name: string;
      department_id?: string;
      staff_number?: string;
      extension?: string;
    } & HandoverFields,
  ) => apiRequest<EmployeeSaved>("/employees", { method: "POST", body }),
  update: (
    id: string,
    body: Partial<{
      full_name: string;
      /** The sign-in email. Changing it ends their session and tells the
       * old address. */
      email: string;
      department_id: string;
      staff_number: string;
      role: string;
      is_active: boolean;
      /** The extension this employee answers on; `null` gives their line
       * up. A code a SIM carries brings that SIM with it. */
      extension_code: string | null;
    }> &
      HandoverFields,
  ) =>
    apiRequest<EmployeeSaved>(`/employees/${id}`, {
      method: "PATCH",
      body,
    }),
  remove: (id: string) =>
    apiRequest<ApiEnvelope<null>>(`/employees/${id}`, { method: "DELETE" }),
  /** They left the company: line back to the pool, login off, history
   * kept. Needs the step-up (see authApi.stepUp). */
  removeLeaver: (
    id: string,
    body: {
      removal_reason: RemovalReason;
      confirm_name: string;
      password: string;
      code: string;
    },
  ) =>
    apiRequest<ApiEnvelope<Employee>>(`/employees/${id}/remove`, {
      method: "POST",
      body,
    }),
};

// --- Step-up confirmation (Admin) ------------------------------------
export const stepUpApi = {
  /** Emails the signed-in Admin a one-time code for a sensitive action. */
  requestCode: () =>
    apiRequest<ApiEnvelope<{ expires_minutes: number }>>("/auth/step-up", {
      method: "POST",
    }),
};

// --- Directory (name + extension lookup, every role) ---------------------
export const directoryApi = {
  list: () => apiRequest<ApiEnvelope<DirectoryEntry[]>>("/directory"),
};

// --- Departments --------------------------------------------------------
export const departmentsApi = {
  list: () => apiRequest<ApiEnvelope<Department[]>>("/departments"),
  /** The departments dashboard; the latest month with costs when `month`
   * is omitted. */
  overview: (month?: string) =>
    apiRequest<ApiEnvelope<DepartmentsOverview>>("/departments/overview", {
      query: month ? { month } : undefined,
    }),
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
      handles_customer_service: boolean;
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
  /** `msisdn` may be left out when `extension` is given — the number then
   * follows the company number format. */
  create: (body: {
    iccid: string;
    msisdn?: string;
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
  allocate: (id: string, employeeId: string, handover?: HandoverFields) =>
    apiRequest<ApiEnvelope<unknown>>(`/sims/${id}/allocate`, {
      method: "POST",
      body: { employee_id: employeeId, ...handover },
    }),
  unassignedUsage: () =>
    apiRequest<ApiEnvelope<UnassignedLineUsage[]>>("/sims/unassigned-usage"),
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

// --- Company number format (Admin only) -----------------------------------
export const numberFormatApi = {
  get: () => apiRequest<ApiEnvelope<NumberFormat>>("/settings/number-format"),
  /** `apply_to_existing` also renumbers every SIM that has an extension. */
  update: (body: { prefix: string; apply_to_existing?: boolean }) =>
    apiRequest<ApiEnvelope<NumberFormat>>("/settings/number-format", {
      method: "PATCH",
      body,
    }),
};

// --- Monthly report (Admin: company; Manager: own department) -------------
export const reportsApi = {
  /** The latest month with costs when `month` is omitted. */
  monthly: (month?: string) =>
    apiRequest<ApiEnvelope<MonthlyReport>>("/reports/monthly", {
      query: month ? { month } : undefined,
    }),
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
  mine: (params?: { month?: string; page?: number; limit?: number }) =>
    apiRequest<
      ApiEnvelope<{
        usage: UsageEvent[];
        cost_summaries: UsageSummary[];
        /** Every month the company has costs for, newest first. */
        billed_months: string[];
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
        /** Lines set up for extensions this batch was the first to
         * mention: a SIM, plus a generated stand-in employee holding it. */
        lines_created: number;
        new_extensions: string[];
      }>
    >("/cdr/ingest", {
      method: "POST",
      body: { records, source_file: sourceFile },
    }),
  /** Past uploads, newest first. Admin only. */
  batches: (params?: { page?: number; limit?: number }) =>
    apiRequest<ApiEnvelope<CdrIngestBatch[]>>("/cdr/batches", {
      query: params,
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
  /** Emails the HR manager the employees over their limit in `month`. */
  reportToHr: (month?: string) =>
    apiRequest<
      ApiEnvelope<{ month: string; over_limit: number; recipients: number }>
    >("/invoices/report-to-hr", { method: "POST", body: { month } }),
};

// --- Customer service tickets --------------------------------------------
export type TicketScope = "mine" | "desk" | "team" | "forwarded" | "all";

/** Where a transfer or forward goes: a department, optionally one person. */
export interface TicketPassBody {
  department_id: string;
  assigned_to_user_id?: string;
  /** Transfer: optional context. Forward: what's needed (required). */
  note?: string;
  /** Forward only: hours they have to send it back (required). */
  reply_hours?: number;
}

// --- Customer feedback (public: the emailed rating link) ------------------
export const feedbackApi = {
  lookup: (token: string) =>
    apiRequest<ApiEnvelope<FeedbackView>>("/feedback/lookup", {
      method: "POST",
      body: { token },
      unauthenticated: true,
    }),
  submit: (body: { token: string; rating: number; comment?: string }) =>
    apiRequest<ApiEnvelope<FeedbackView>>("/feedback", {
      method: "POST",
      body,
      unauthenticated: true,
    }),
};

export const ticketsApi = {
  me: () => apiRequest<ApiEnvelope<TicketAccess>>("/tickets/me"),
  list: (scope: TicketScope, status?: TicketStatus) =>
    apiRequest<ApiEnvelope<Ticket[]>>("/tickets", {
      query: { scope, status },
    }),
  get: (id: string) => apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}`),
  /** I've read the conversation up to its newest message. */
  markRead: (id: string) =>
    apiRequest<void>(`/tickets/${id}/read`, { method: "POST" }),
  stats: (month?: string) =>
    apiRequest<ApiEnvelope<TicketStats>>("/tickets/stats", {
      query: { month },
    }),
  create: (body: {
    subject: string;
    description: string;
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    booking_reference?: string;
    /** A quick category, or leave it out and give custom_reason plus
     * department_id. */
    category_id?: string;
    custom_reason?: string;
    department_id?: string;
    /** One person in the department; left out, the whole department. */
    assigned_to_user_id?: string;
    priority?: TicketPriority;
    /** Hours from now until it breaches the SLA, instead of the
     * priority's target (the server counts from its own clock). */
    sla_hours?: number;
    /** ISO deadline instead of the priority's SLA target. */
    due_at?: string;
  }) =>
    apiRequest<ApiEnvelope<Ticket> & { message?: string }>("/tickets", {
      method: "POST",
      body,
    }),
  claim: (id: string) =>
    apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}/claim`, {
      method: "POST",
    }),
  addNote: (id: string, body: string) =>
    apiRequest<ApiEnvelope<{ ticket_id: string }>>(`/tickets/${id}/notes`, {
      method: "POST",
      body: { body },
    }),
  resolve: (id: string, resolutionNote: string) =>
    apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}/resolve`, {
      method: "POST",
      body: { resolution_note: resolutionNote },
    }),
  /** Reject back to the raiser: wrong department, duplicate or invalid.
   * Missing details are asked in the chat instead. */
  reject: (id: string, reasonCode: TicketRejectReason, reason?: string) =>
    apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}/return`, {
      method: "POST",
      body: { reason_code: reasonCode, reason },
    }),
  /** Put a claimed ticket back in its department's queue. */
  /** Moves it for good: they own it and resolve it. */
  transfer: (id: string, body: TicketPassBody) =>
    apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}/transfer`, {
      method: "POST",
      body,
    }),
  /** Sends it for something to be done; it comes back to the sender. */
  forward: (id: string, body: TicketPassBody) =>
    apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}/forward`, {
      method: "POST",
      body,
    }),
  returnForward: (id: string, forwardId: string, note: string) =>
    apiRequest<ApiEnvelope<Ticket>>(
      `/tickets/${id}/forwards/${forwardId}/return`,
      { method: "POST", body: { note } },
    ),
  recallForward: (id: string, forwardId: string) =>
    apiRequest<ApiEnvelope<Ticket>>(
      `/tickets/${id}/forwards/${forwardId}/recall`,
      { method: "POST" },
    ),
  withdraw: (id: string, note?: string) =>
    apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}/withdraw`, {
      method: "POST",
      body: { note },
    }),
  reopen: (
    id: string,
    body: { reason: string; sla_hours?: number; due_at?: string },
  ) =>
    apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}/reopen`, {
      method: "POST",
      body,
    }),
  /** Admin only. */
  close: (id: string, note: string) =>
    apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}/close`, {
      method: "POST",
      body: { note },
    }),
  release: (id: string) =>
    apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}/release`, {
      method: "POST",
    }),
  resend: (
    id: string,
    body: {
      category_id?: string;
      custom_reason?: string;
      department_id?: string;
      note?: string;
    },
  ) =>
    apiRequest<ApiEnvelope<Ticket>>(`/tickets/${id}/resend`, {
      method: "POST",
      body,
    }),
  slaReport: (month?: string) =>
    apiRequest<ApiEnvelope<SlaReport>>("/tickets/sla", { query: { month } }),
  assignees: (departmentId: string) =>
    apiRequest<ApiEnvelope<TicketAssignee[]>>("/tickets/assignees", {
      query: { department_id: departmentId },
    }),
  categories: (includeInactive = false) =>
    apiRequest<ApiEnvelope<TicketCategory[]>>("/tickets/categories", {
      query: includeInactive ? { all: "true" } : undefined,
    }),
  createCategory: (body: { name: string; department_id: string }) =>
    apiRequest<ApiEnvelope<TicketCategory>>("/tickets/categories", {
      method: "POST",
      body,
    }),
  updateCategory: (
    id: string,
    body: Partial<{ name: string; department_id: string; is_active: boolean }>,
  ) =>
    apiRequest<ApiEnvelope<TicketCategory>>(`/tickets/categories/${id}`, {
      method: "PATCH",
      body,
    }),
};
