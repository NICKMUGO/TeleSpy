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
  /** Its people work the customer service ticket desk. */
  handles_customer_service: boolean;
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
  /** Set once they've left the company; removed employees are never listed. */
  removed_at?: string | null;
  removal_reason?: RemovalReason | null;
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
  /** Part of calls_cost_kes made on lines nobody held — billed to no one. */
  unassigned_lines_cost_kes: number;
  fixed_charge_kes: number;
  /** Null for a month with an invoice entered but no call costs yet. */
  rebuilt_total_kes: number | null;
  invoice_total_kes: number | null;
  note: string | null;
  difference_kes: number | null;
  difference_pct: number | null;
}

/** GET /sims/unassigned-usage — spend on a line nobody held (a pool SIM
 * still in use), per extension per month, from the billing run. */
export interface UnassignedLineUsage {
  id: string;
  extension_code: string;
  month: string;
  total_cost_kes: number;
  list_cost_kes: number;
  calls: number;
  updated_at: string;
}

/** Why someone left — Employee.removal_reason. */
export type RemovalReason =
  "resigned" | "terminated" | "contract_ended" | "retired" | "other";

/** Sent when a line someone holds goes to another person: the holder
 * either swaps lines with them, or left the company and is removed — which
 * needs a reason and the Admin's step-up (password + emailed code). */
export interface HandoverFields {
  displaced_holder?: "swap" | "remove";
  removal_reason?: RemovalReason;
  password?: string;
  code?: string;
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

/** One CDR upload, from GET /cdr/batches. */
export interface CdrIngestBatch {
  id: string;
  uploaded_by_role: string | null;
  source_file: string | null;
  ingested: number;
  attributed: number;
  unattributed: number;
  skipped_unanswered: number;
  lines_created: number;
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
  /** data-tour="…" anchor to spotlight on `href`; null = no spotlight. */
  target: string | null;
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

// --- Customer service tickets ---------------------------------------------

export type TicketStatus = "open" | "in_progress" | "returned" | "resolved";

/** Why a handling team rejects a ticket (stored as status "returned"). */
export type TicketRejectReason = "wrong_department" | "duplicate" | "invalid";

export const REJECT_REASON_LABELS: Record<TicketRejectReason, string> = {
  wrong_department: "Wrong department",
  duplicate: "Duplicate of another ticket",
  invalid: "Not a real issue",
};

export type TicketPriority = "high" | "medium" | "low";

/** Where a ticket stands against its SLA deadline. "paused" while it's
 * returned to the raiser — the clock stops until it's sent again. */
export type SlaStatus = "on_track" | "overdue" | "paused" | "met" | "missed";

export interface TicketCategory {
  id: string;
  name: string;
  department_id: string;
  department_name: string | null;
  is_active: boolean;
}

/** How far one person has read a ticket's conversation (read ticks). */
export interface TicketRead {
  user_id: string;
  name: string | null;
  read_at: string;
}

/** The handler sent the ticket to someone for something they need done;
 * it comes back when they send it back with a note. */
export interface TicketForward {
  id: string;
  from_user_id: string;
  from_name: string | null;
  to_department_id: string;
  to_department_name: string | null;
  /** Null: anyone in the department can do it. */
  to_user_id: string | null;
  to_user_name: string | null;
  message: string;
  status: "pending" | "returned" | "recalled";
  reply_note: string | null;
  replied_by_name: string | null;
  created_at: string;
  replied_at: string | null;
}

export interface TicketEvent {
  id: string;
  kind:
    | "raised"
    | "assigned"
    | "claimed"
    | "note"
    | "returned"
    | "released"
    | "resent"
    | "resolved"
    | "transferred"
    | "forwarded"
    | "forward_returned"
    | "forward_recalled";
  body: string | null;
  /** Absent on a message still being sent (shown at once, before the
   * server confirms it). */
  actor_user_id?: string;
  actor_name: string | null;
  created_at: string;
}

export interface Ticket {
  id: string;
  /** "TKT-000042" */
  number: string;
  subject: string;
  description: string;
  /** Null on an internal ticket (not for a customer). */
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  booking_reference: string | null;
  /** Null when the raiser wrote their own reason (custom_reason). */
  category_id: string | null;
  /** The category's name, or the custom reason. */
  category_name: string | null;
  custom_reason: string | null;
  department_id: string;
  department_name: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  /** The SLA deadline. */
  due_at: string;
  sla_status: SlaStatus;
  raised_by_id: string;
  raised_by_name: string | null;
  claimed_by_id: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  /** Raised to resolved, null until resolved. */
  resolution_minutes: number | null;
  resolution_note: string | null;
  return_count: number;
  /** Out with someone else right now (a pending forward). */
  forwarded: boolean;
  /** Every time it was forwarded, oldest first. */
  forwards: TicketForward[];
  created_at: string;
  updated_at: string;
  /** Only on GET /tickets/{id}. */
  events?: TicketEvent[];
  /** Detail only: how far each person has read the conversation. */
  reads?: TicketRead[];
}

/** GET /tickets/me — what the ticket desk means for the caller. */
export interface TicketAccess {
  on_desk: boolean;
  desk_manager: boolean;
  is_admin: boolean;
  department_id: string | null;
  department_name: string | null;
  /** Their department is sent tickets, so they get the team queue. */
  handles_tickets: boolean;
}

/** GET /tickets/assignees — someone a ticket can be sent to directly. */
export interface TicketAssignee {
  user_id: string;
  name: string;
}

export interface TicketAgentStats {
  user_id: string;
  name: string;
  raised: number;
  /** Tickets they raised that were resolved this month. */
  resolved: number;
  /** Successful escalations: resolved without ever being rejected. */
  successful: number;
  /** successful ÷ resolved, %; null with nothing resolved. */
  success_pct: number | null;
  /** Times the handling team rejected one of their tickets this month. */
  returned: number;
  open: number;
  /** Of their tickets resolved this month: % within the SLA deadline. */
  sla_met_pct: number | null;
  /** Of their tickets resolved this month: average raised → resolved. */
  avg_resolution_minutes: number | null;
  /** Customer rating (1-5) on their tickets, answered this month. */
  csat_avg: number | null;
  csat_responses: number;
}

export interface TicketStats {
  month: string;
  /** Every agent for the desk Manager and Admin; only yourself otherwise. */
  agents: TicketAgentStats[];
  /** The average agent on the desk this month. */
  team: {
    agents: number;
    raised: number | null;
    successful: number | null;
    success_pct: number | null;
    csat_avg: number | null;
  };
  /** Where you rank on each figure (1 = best), if you're on the desk. */
  me: {
    ranks: {
      successful: number | null;
      success_pct: number | null;
      csat_avg: number | null;
    };
  } | null;
}

/** GET /tickets/sla-targets — hours to resolve, per priority. */
export interface SlaTargets {
  high_hours: number;
  medium_hours: number;
  low_hours: number;
}

export interface SlaFigures {
  resolved: number;
  met: number;
  missed: number;
  /** Null when nothing was resolved. */
  compliance_pct: number | null;
  avg_resolution_minutes: number | null;
}

export interface CsatFigures {
  csat_avg: number | null;
  csat_responses: number;
}

/** Customer satisfaction for the month, in GET /tickets/sla. */
export interface CsatReport {
  /** Rating emails sent this month. */
  asked: number;
  responses: number;
  average: number | null;
  /** Share rating 4 or 5. */
  satisfied_pct: number | null;
  distribution: { rating: number; count: number }[];
  recent: {
    ticket_id: string;
    number: string;
    department_name: string | null;
    rating: number;
    comment: string;
    responded_at: string;
  }[];
}

/** POST /feedback/lookup and /feedback — the public rating page. */
export interface FeedbackView {
  number: string;
  subject: string;
  department_name: string | null;
  rating: number | null;
  comment: string | null;
  responded: boolean;
  expired: boolean;
}

/** GET /tickets/sla — the organisation against the SLA for a month. */
export interface SlaReport {
  month: string;
  targets: SlaTargets;
  totals: SlaFigures & { overdue_open: number };
  by_priority: (SlaFigures & {
    priority: TicketPriority;
    target_hours: number;
    overdue_open: number;
  })[];
  by_department: (SlaFigures &
    CsatFigures & {
      department_id: string;
      department_name: string | null;
      overdue_open: number;
    })[];
  by_resolver: (SlaFigures &
    CsatFigures & {
      user_id: string;
      name: string | null;
      department_name: string | null;
    })[];
  csat: CsatReport;
  /** Resolved that month — only tickets the caller can open. */
  resolved: Ticket[];
  /** Open past the deadline right now — only tickets the caller can open. */
  overdue: Ticket[];
}
