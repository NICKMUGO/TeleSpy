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
  total_cost_kes?: number; // current month — Admin/self/own-manager only
}

export interface SimCard {
  id: string;
  provider: string | null;
  plan_id: string | null;
  lifecycle_state: string;
  employee_id: string | null;
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
  historical_monthly_spend: { month: string; total_cost: number }[];
  budget_ceiling: number | null;
  forecast: ForecastResult | null;
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
