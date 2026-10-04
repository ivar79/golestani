import { beforeEach, describe, expect, it, vi } from "vitest";

// The api module is mocked so these tests assert the CLIENT CONTRACT
// (endpoint + payload) without a network. Studio access is UX-only; the server
// re-checks every Level B write, so these tests never imply authorization.
const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api", () => ({ default: apiMock }));

import { getStudioReport, updateAdminUserDesignerStatus } from "@/lib/admin";
import {
  canOpenStudio,
  describeStudioErrors,
  describeStudioStatus,
  extractStudioErrors,
  type StudioStatus,
} from "@/lib/entitlements";

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.patch.mockReset();
});

describe("describeStudioErrors", () => {
  it("explains a not-approved designer refusal", () => {
    expect(describeStudioErrors({ studio: "not_approved" })).toContain("طراحان تأییدشده");
  });

  it("explains a missing-capability refusal", () => {
    expect(describeStudioErrors({ studio: "no_capability" })).toContain("استودیو طراحی");
  });

  it("stays silent when the gate is simply dormant (stage_off)", () => {
    expect(describeStudioErrors({ studio: "stage_off" })).toBeNull();
  });

  it("returns null when there is no studio error at all", () => {
    expect(describeStudioErrors(null)).toBeNull();
    expect(describeStudioErrors(undefined)).toBeNull();
  });

  it("falls back to a generic sentence for an unknown reason", () => {
    expect(describeStudioErrors({ studio: "something_new" })).toContain("استودیوی طراحی");
  });
});

describe("extractStudioErrors", () => {
  it("reads the studio_errors block from a 403 body", () => {
    const error = { response: { data: { studio_errors: { studio: "no_capability" } } } };
    expect(extractStudioErrors(error)).toEqual({ studio: "no_capability" });
  });

  it("returns null for a non-studio error", () => {
    expect(extractStudioErrors({ response: { data: {} } })).toBeNull();
    expect(extractStudioErrors(new Error("boom"))).toBeNull();
  });
});

// The client mirror of the server decision. UX ONLY: these tests assert which
// SENTENCE the page shows and whether the workspace may OPEN — the server
// re-checks every Level B write, so a passing mirror never grants access.
describe("studio UI gate mirror", () => {
  const decision = (over: Partial<StudioStatus>): StudioStatus => ({
    enforced: true,
    allowed: true,
    bypass: false,
    reason: "designer",
    designer_status: "approved",
    capability: true,
    ...over,
  });

  it("ordinary user without the capability is blocked with the plan message", () => {
    const s = decision({ allowed: false, reason: "no_capability", designer_status: "none", capability: false });
    expect(canOpenStudio(s)).toBe(false);
    expect(describeStudioStatus(s)).toContain("پلن این کسب‌وکار");
  });

  it("ordinary user WITH the business capability is still blocked (not approved)", () => {
    const s = decision({ allowed: false, reason: "not_approved", designer_status: "none", capability: true });
    expect(canOpenStudio(s)).toBe(false);
    expect(describeStudioStatus(s)).toContain("طراحان تأییدشده");
  });

  it("approved designer without the entitlement is blocked", () => {
    const s = decision({ allowed: false, reason: "no_capability", capability: false });
    expect(canOpenStudio(s)).toBe(false);
  });

  it("rejected or suspended designer is blocked", () => {
    expect(canOpenStudio(decision({ allowed: false, reason: "not_approved", designer_status: "rejected" }))).toBe(false);
    expect(canOpenStudio(decision({ allowed: false, reason: "not_approved", designer_status: "suspended" }))).toBe(false);
  });

  it("approved designer on the SAME business entitlement opens the studio", () => {
    expect(canOpenStudio(decision({}))).toBe(true);
    expect(describeStudioStatus(decision({}))).toBeNull();
  });

  it("admin bypass opens the studio and is still a server-audited decision", () => {
    const s = decision({ bypass: true, reason: "admin_bypass", designer_status: "none", capability: false });
    expect(canOpenStudio(s)).toBe(true);
    expect(describeStudioStatus(s)).toBeNull();
  });

  it("a dormant gate (stage_off) keeps the legacy studio available", () => {
    const s = decision({ enforced: false, reason: "stage_off", designer_status: "none", capability: false });
    expect(canOpenStudio(s)).toBe(true);
  });

  it("a missing decision never locks (server still authoritative)", () => {
    expect(canOpenStudio(null)).toBe(true);
    expect(canOpenStudio(undefined)).toBe(true);
    expect(describeStudioStatus(null)).toBeNull();
  });
});

describe("designer-approval + studio-report client contract", () => {
  it("PATCHes the canonical designer-status endpoint with status + reason", async () => {
    apiMock.patch.mockResolvedValue({ data: { id: 7 } });

    await updateAdminUserDesignerStatus(7, "rejected", "تخلف");

    expect(apiMock.patch).toHaveBeenCalledWith("/admin/users/7/designer-status", {
      designer_status: "rejected",
      reason: "تخلف",
    });
  });

  it("GETs the read-only studio rollout report", async () => {
    apiMock.get.mockResolvedValue({ data: { gate: { enforced: false, setting: "studio_designer_only" } } });

    const report = await getStudioReport();

    expect(apiMock.get).toHaveBeenCalledWith("/admin/studio/report");
    expect(report.gate.enforced).toBe(false);
  });
});
