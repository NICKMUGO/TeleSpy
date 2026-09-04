// Placeholder until the data layer wires real auth/session (mock adapter +
// eventual ASP.NET Core API). RBAC in this client is a convenience — it
// hides nav items a role can't use — never a control; the API is what
// actually enforces access.

export type Role =
  "SuperAdmin" | "Admin" | "DepartmentManager" | "Employee" | "Auditor";

export interface CurrentUser {
  name: string;
  email: string;
  role: Role;
  initials: string;
}

export const mockCurrentUser: CurrentUser = {
  name: "Grace Wanjiru",
  email: "grace.wanjiru@kenya-airways.com",
  role: "SuperAdmin",
  initials: "GW",
};
