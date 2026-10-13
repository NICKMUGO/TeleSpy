// Types mirroring BackendDotNet's actual ToDict() response shapes
// (BackendDotNet/Models/Entities.cs) — the frontend now talks to
// BackendDotNet only (see README). Fields marked optional either depend on
// viewer role (decrypted SIM fields, Admin-only) or an `include` query
// param the caller didn't ask for.

export type Role = "Admin" | "Manager" | "Employee";

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
  role_id: string;
  is_active: boolean;
  must_change_password: boolean;
  employee_id?: string;
  full_name?: string;
  staff_number?: string;
  department_id?: string;
}

export interface Department {
  id: string;
  name: string;
  cost_centre_code: string | null;
  budget_ceiling: number | null;
}

/** One department's row on the departments dashboard
 * (GET /departments/overview). */
export interface DepartmentOverviewRow {
  id: string;
  name: string;
  cost_centre_code: string | null;
  budget_ceiling_kes: number | null;
  headcount: number;
  /** SIMs its staff hold today. */
  lines: number;
  staff_with_spend: number;
  cost_kes: number;
  list_cost_kes: number;
  discount_kes: number;
  /** Its share of every department's spend this month. */
  share_pct: number;
  previous_cost_kes: number | null;
  cost_per_head_kes: number | null;
  budget_used_pct: number | null;
  over_budget_by_kes: number;
  status: "unmonitored" | "over_budget" | "near_ceiling" | "within_budget";
  /** Staff past their own monthly limit, and by how much in total. */
  staff_over_limit: number;
  staff_over_limit_kes: number;
  open_anomalies: number;
  calls: { type: string; calls: number; minutes: number }[];
  trend: { month: string; cost_kes: number }[];
  top_spenders: {
    employee_id: string;
    full_name: string;
    cost_kes: number;
    over_limit: boolean;
  }[];
  forecast: {
    period: string;
    forecasted_cost_kes: number | null;
    confidence_low_kes: number | null;
    confidence_high_kes: number | null;
  } | null;
}

export interface DepartmentsOverview {
  month: string;
  previous_month: string;
  /** Every month that has costs, newest first. */
  months: string[];
  trend_months: string[];
  total_cost_kes: number;
  total_budget_kes: number;
  departments: DepartmentOverviewRow[];
}

export interface Employee {
  id: string;
  staff_number: string | null;
  full_name: string;
  department_id: string | null;
  extension_code: string | null;
  email?: string;
  role?: string;
  role_id?: string;
  is_active?: boolean;
  extension?: string | null; // decrypted SIM extension — Admin/self/own-manager only
  sim_id?: string;
  /** Full number of the line this employee holds — Admin only. */
  msisdn?: string;
  total_cost_kes?: number; // current month — Admin/self/own-manager only
}

/** One line of the company phone directory (GET /directory) — visible to
 * every signed-in role. */
export interface DirectoryEntry {
  id: string;
  full_name: string;
  extension_code: string;
  department: string | null;
}

export interface SimCard {
  id: string;
  provider: string | null;
  plan_id: string | null;
  lifecycle_state: string;
  employee_id: string | null;
  /** Full name of whoever currently holds the SIM, if anyone. */
  employee_name?: string | null;
  created_at: string;
  iccid?: string; // Admin only
  msisdn?: string; // Admin only
  extension?: string | null; // Admin only
  msisdn_masked?: string; // non-Admin
}

export interface UsageEvent {
  id: string;
  allocation_id: string | null;
  msisdn_pbx: string;
  destination: string;
  occured_at: string;
  duration_minutes: number;
  computed_cost: number;
  attribution_state: string;
  call_classification: "Internal" | "External" | "International" | "Unknown";
  excluded_from_anomaly_detection: boolean;
}

/** One calendar month ("YYYY-MM") that has usage events, and how many. */
export interface UsageMonth {
  month: string;
  count: number;
}

export interface UsageSummary {
  id: string;
  employee_id: string;
  month: string; // "YYYY-MM"
  total_cost: number;
  extension_code: string | null;
  updated_at: string;
  full_name?: string; // joined in by /analytics/usage-summary
}

export interface AnomalyFlag {
  id: string;
  event_id: string;
  anomaly_score: number;
  contributing_features: Record<string, unknown>;
  resolved: boolean;
  resolved_at: string | null;
  event?: UsageEvent;
  employee?: { id: string; full_name: string } | null;
}

export interface UsageProfile {
  employee_id: string;
  full_name: string;
  cluster_label: "low_usage" | "moderate_usage" | "high_usage" | null;
}

export interface ForecastResult {
  id: string;
  department_id: string;
  period: string;
  forecasted_cost: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
}

export interface DepartmentForecast {
  department_id: string;
  department_name: string;
  /** Everyone in the department — the forecast is their combined spend. */
  employee_count: number;
  /** Department totals per month. `days_covered` < `days_in_month` marks a
   * month the call data only partly covers. */
  historical_monthly_spend: {
    month: string;
    total_cost: number;
    employees: number;
    days_covered: number;
    days_in_month: number;
  }[];
  budget_ceiling: number | null;
  forecast: ForecastResult | null;
}

export interface LocalCallRateSettings {
  peak_rate_kes: number;
  off_peak_rate_kes: number;
  peak_start_hour: number; // 0-23, inclusive
  peak_end_hour: number; // 0-23, exclusive
  default_international_rate_kes: number;
  /** The telco the organisation's line is with, e.g. "Safaricom". */
  home_network_name: string;
  /** Number prefixes on that network: 3-digit prefixes or ranges, comma-
   * separated, e.g. "700-729, 748". A call to one is "on-net". */
  on_net_prefixes: string;
  /** Contract discount per call type, 0-100. "On-net" = to a number on the
   * home network; "off-net" = any other Kenyan network or fixed line. */
  discount_on_net_peak_pct: number;
  discount_on_net_off_peak_pct: number;
  discount_off_net_peak_pct: number;
  discount_off_net_off_peak_pct: number;
  discount_international_pct: number;
  /** The line's fixed monthly rental, before tax. */
  fixed_monthly_charge_kes: number;
  /** Read-only: the rental with excise and VAT added. */
  fixed_monthly_charge_with_tax_kes: number;
  excise_rate_pct: number;
  vat_rate_pct: number;
  updated_at: string;
}

/** The company's standard number format (GET /settings/number-format):
 * every staff line is `prefix` followed by the 3-digit extension. */
export interface NumberFormat {
  prefix: string;
  extension_digits: number;
  example: string;
  updated_at: string;
  /** Only on the response to a save. */
  sims_renumbered?: number;
}

/** One month of GET /reconciliation: the bill rebuilt from the app's own
 * records beside the telco's invoice total, if one has been entered. */
export interface ReconciliationMonth {
  month: string;
  days_covered: number;
  days_in_month: number;
  employees: number;
  calls_list_cost_kes: number;
  discount_kes: number;
  calls_cost_kes: number;
  fixed_charge_kes: number;
  /** Null for a month with an invoice entered but no call costs yet. */
  rebuilt_total_kes: number | null;
  invoice_total_kes: number | null;
  note: string | null;
  difference_kes: number | null;
  difference_pct: number | null;
}

export interface Reconciliation {
  months: ReconciliationMonth[];
  fixed_monthly_charge_kes: number;
  fixed_monthly_charge_with_tax_kes: number;
  excise_rate_pct: number;
  vat_rate_pct: number;
}

/** GET /reports/monthly — one month summarised for the printable
 * management report. An Admin's covers the company; a Manager's covers
 * their department and has no company-level bill lines (the optional
 * fields on `bill`). No employee is named anywhere in it. */
export interface MonthlyReport {
  month: string;
  /** Every month that has costs, newest first. */
  months: string[];
  scope: { type: "company" | "department"; department_name: string | null };
  home_network_name: string;
  days_covered: number;
  days_in_month: number;
  staff_with_spend: number;
  bill: {
    calls_list_cost_kes: number;
    discount_kes: number;
    discount_pct: number;
    calls_cost_kes: number;
    previous_calls_cost_kes: number | null;
    fixed_charge_kes?: number;
    excise_rate_pct?: number;
    excise_kes?: number;
    vat_rate_pct?: number;
    vat_kes?: number;
    fixed_charge_with_tax_kes?: number;
    total_kes?: number;
    invoice_total_kes?: number | null;
    invoice_note?: string | null;
    difference_kes?: number | null;
    difference_pct?: number | null;
  };
  departments: {
    id: string;
    name: string;
    cost_centre_code: string | null;
    staff: number;
    list_cost_kes: number;
    cost_kes: number;
    share_pct: number;
    previous_cost_kes: number | null;
    budget_ceiling_kes: number | null;
    budget_used_pct: number | null;
  }[];
  unassigned_cost_kes: number;
  trend: {
    month: string;
    list_cost_kes: number;
    cost_kes: number;
    days_covered: number;
    days_in_month: number;
  }[];
  call_types: {
    type: "Internal" | "External" | "International";
    calls: number;
    minutes: number;
  }[];
  local_mix: {
    network: "on_net" | "off_net";
    band: "peak" | "off_peak";
    calls: number;
    minutes: number;
    discount_pct: number;
  }[];
  international_destinations: {
    country_code: string | null;
    country_name: string;
    rate_kes_per_minute: number;
    calls: number;
    minutes: number;
  }[];
  limits: { over_limit_count: number; over_limit_total_kes: number };
  anomalies: { flagged: number; resolved: number; open: number };
  lines: {
    total: number;
    active: number;
    allocated: number;
    unallocated: number;
    cost_per_allocated_line_kes: number | null;
  };
  generated_at: string;
}

export interface InternationalCallRate {
  id: string;
  country_code: string;
  country_name: string | null;
  rate_kes_per_minute: number;
  updated_at: string;
}

export interface RoleRecord {
  id: string;
  role_name: string;
  permissions: string[];
  call_limit_kshs: number | null;
}

export interface AuditLogEntry {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  resource: string | null;
  resource_id: string | null;
  meta: Record<string, unknown>;
  occured_at: string;
}

export interface OverLimitEntry {
  employee_id: string;
  full_name: string;
  department_id: string | null;
  month: string;
  total_cost: number;
  limit_kshs: number;
  overage_kshs: number;
}

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  href: string;
}

export interface TutorialProgress {
  steps: TutorialStep[];
  completed_step_ids: string[];
  next_step_id: string | null;
  dismissed: boolean;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface ApiEnvelope<T> {
  data: T;
  message?: string;
  meta?: PaginationMeta;
}

export interface ApiErrorBody {
  error_type: string;
  message: string;
  field?: string;
  hint?: string;
  status: number;
  path?: string;
  method?: string;
  timestamp?: string;
}
