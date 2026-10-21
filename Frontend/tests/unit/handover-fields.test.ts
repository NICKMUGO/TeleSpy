import { describe, expect, it } from "vitest";
import {
  EMPTY_REMOVAL,
  handoverFields,
  removalComplete,
} from "@/features/employees/handover-fields";

describe("handoverFields", () => {
  it("sends just the choice for a swap", () => {
    expect(handoverFields("swap", EMPTY_REMOVAL)).toEqual({
      displaced_holder: "swap",
    });
  });

  it("sends the reason and step-up for a removal", () => {
    const removal = {
      reason: "resigned" as const,
      password: "pw",
      code: " 123456 ",
    };
    expect(removalComplete(removal)).toBe(true);
    expect(handoverFields("remove", removal)).toEqual({
      displaced_holder: "remove",
      removal_reason: "resigned",
      password: "pw",
      code: "123456",
    });
  });

  it("sends nothing until a removal has a reason", () => {
    expect(removalComplete(EMPTY_REMOVAL)).toBe(false);
    expect(handoverFields("remove", EMPTY_REMOVAL)).toBeUndefined();
    expect(handoverFields(null, EMPTY_REMOVAL)).toBeUndefined();
  });
});
