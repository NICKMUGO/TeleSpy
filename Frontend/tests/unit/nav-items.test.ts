import { describe, expect, it } from "vitest";
import { ALL_NAV_ITEMS, isNavItemVisible } from "@/components/layout/nav-items";

describe("isNavItemVisible", () => {
  it("is visible to every role when the item declares no roles", () => {
    const item = ALL_NAV_ITEMS.find((i) => i.href === "/dashboard")!;
    expect(isNavItemVisible(item, "Employee")).toBe(true);
    expect(isNavItemVisible(item, "Admin")).toBe(true);
  });

  it("is hidden from roles not in the item's allow-list", () => {
    const item = ALL_NAV_ITEMS.find((i) => i.href === "/reconciliation")!;
    expect(isNavItemVisible(item, "Employee")).toBe(false);
    expect(isNavItemVisible(item, "Admin")).toBe(true);
  });
});
