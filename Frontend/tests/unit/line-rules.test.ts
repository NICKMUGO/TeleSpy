import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  describeLine,
  hasLine,
  lineHeldBy,
  lineRuleError,
  stepUpError,
} from "@/lib/api/line-rules";
import type { Employee, SimCard } from "@/lib/api/types";

const sim = (id: string, employeeId: string | null): SimCard => ({
  id,
  provider: null,
  plan_id: null,
  lifecycle_state: "active",
  employee_id: employeeId,
  created_at: "2026-10-01T00:00:00Z",
});

describe("lineHeldBy", () => {
  it("finds the SIM an employee holds", () => {
    const sims = [sim("a", "anthony"), sim("b", null)];
    expect(lineHeldBy("anthony", sims)?.id).toBe("a");
  });

  it("is null for someone without a line, or no one", () => {
    const sims = [sim("a", "anthony")];
    expect(lineHeldBy("alexandrea", sims)).toBeNull();
    expect(lineHeldBy(null, sims)).toBeNull();
  });
});

describe("lineRuleError", () => {
  it("turns a one-line-rule refusal into popup content", () => {
    const error = new ApiError({
      error_type: "employee_already_has_line",
      message: "This employee already holds a line.",
      hint: "Refresh and try again.",
      status: 409,
    });
    expect(lineRuleError(error)).toEqual({
      title: "This employee already has a line",
      message: "This employee already holds a line.",
      hint: "Refresh and try again.",
    });
  });

  it("leaves every other error to the usual toast", () => {
    const other = new ApiError({
      error_type: "validation_error",
      message: "Bad.",
      status: 422,
    });
    expect(lineRuleError(other)).toBeNull();
    expect(lineRuleError(new Error("network"))).toBeNull();
  });
});

const employee = (overrides: Partial<Employee>): Employee => ({
  id: "e1",
  staff_number: null,
  full_name: "New Hire",
  department_id: null,
  extension_code: null,
  ...overrides,
});

describe("hasLine", () => {
  it("is false for a new hire with no SIM or extension", () => {
    expect(hasLine(employee({}))).toBe(false);
  });

  it("is true for someone holding a SIM or just an extension code", () => {
    expect(hasLine(employee({ sim_id: "s1" }))).toBe(true);
    expect(hasLine(employee({ extension_code: "324" }))).toBe(true);
  });
});

describe("describeLine", () => {
  it("joins the extension and number that are known", () => {
    expect(describeLine("236", "0703083236")).toBe(
      "extension 236 · 0703083236",
    );
    expect(describeLine("236", undefined)).toBe("extension 236");
    expect(describeLine(null, null)).toBe("their line");
  });
});

describe("stepUpError", () => {
  it("keeps a wrong password or code retryable in a popup", () => {
    const error = new ApiError({
      error_type: "step_up_code_invalid",
      message: "That confirmation code is wrong or has expired.",
      status: 403,
    });
    expect(stepUpError(error)?.title).toBe("That code didn't work");
    expect(lineRuleError(error)).toBeNull();
  });
});
