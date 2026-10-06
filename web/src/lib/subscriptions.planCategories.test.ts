import { describe, expect, it } from "vitest";
import { splitPlansByStudio, type Plan } from "./subscriptions";

function plan(id: number, designerStudio: boolean): Plan {
  return {
    id,
    name: `Plan ${id}`,
    price: 1000,
    duration_days: 30,
    features: { designer_studio: designerStudio },
    is_active: true,
  };
}

describe("splitPlansByStudio", () => {
  it("keeps ordinary plans separate from Designer Studio plans", () => {
    const result = splitPlansByStudio([plan(1, false), plan(2, true), plan(3, false)]);

    expect(result.businessPlans.map(({ id }) => id)).toEqual([1, 3]);
    expect(result.designerPlans.map(({ id }) => id)).toEqual([2]);
  });

  it("fails closed when a plan has no explicit Studio entitlement", () => {
    const missingEntitlement = { ...plan(1, false), features: null };

    const result = splitPlansByStudio([missingEntitlement]);

    expect(result.businessPlans).toEqual([missingEntitlement]);
    expect(result.designerPlans).toEqual([]);
  });
});
