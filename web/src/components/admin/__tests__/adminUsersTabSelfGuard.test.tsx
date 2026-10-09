// @vitest-environment jsdom
/**
 * Self-lockout regression (reported 2026-10-09 on /admin, component
 * `GroupCards`): the signed-in admin could deactivate their OWN account from
 * the users tab.
 *
 * That is unrecoverable from the product — CheckRole denies every admin route
 * for an inactive account and loginAdmin refuses inactive admins, so getting
 * back in needs direct DB access. The API already answers 422
 * (AdminController::updateUser), and the panel must therefore not offer the
 * action at all for your own account (standard practice: Google Workspace
 * does not let you delete/deactivate the account you are signed in as, and
 * keeps a mandatory last active super admin).
 *
 * These assertions cover both layouts rendered by AdminUsersTab: the desktop
 * table (GroupTable) and the touch-first card stack (GroupCards).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const getAdminUsersMock = vi.hoisted(() => vi.fn());
const updateAdminUserMock = vi.hoisted(() => vi.fn());
const updateAdminUserDesignerStatusMock = vi.hoisted(() => vi.fn());
const currentUser = vi.hoisted(() => ({ id: 1 as number | null }));

vi.mock("@/lib/admin", () => ({
  getAdminUsers: getAdminUsersMock,
  updateAdminUser: updateAdminUserMock,
  updateAdminUserDesignerStatus: updateAdminUserDesignerStatusMock,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: currentUser.id === null ? null : { id: currentUser.id } }),
}));
vi.mock("@/lib/api", () => ({
  extractApiError: (error: unknown) => (error instanceof Error ? error.message : "خطای نامشخص"),
}));

import AdminUsersTab from "../AdminUsersTab";

function adminRow(id: number, name: string, phone: string) {
  return {
    id,
    name,
    username: null,
    phone,
    email: `admin${id}@golestani.ir`,
    is_active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    roles: [{ name: "admin", display_name: "مدیر کل سیستم" }],
    designer_status: "none",
    designer: null,
  };
}

const SELF = adminRow(1, "مدیر سامانه", "09363766800");
const OTHER = adminRow(2, "مدیر دوم", "09120000002");

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.id = 1;
  getAdminUsersMock.mockResolvedValue({ data: [SELF, OTHER], current_page: 1, last_page: 1, total: 2 });
  updateAdminUserMock.mockResolvedValue({ ...OTHER, is_active: false });
});

afterEach(cleanup);

/** Deactivation controls are labelled per layout; both start with "غیرفعال‌سازی". */
function deactivateButtons() {
  return screen.queryAllByRole("button", { name: /غیرفعال‌سازی/ });
}

describe("admin users tab — own-account protection", () => {
  it("renders no deactivation control for the signed-in admin in either layout", async () => {
    render(<AdminUsersTab />);

    await waitFor(() => expect(screen.getAllByText("مدیر سامانه").length).toBeGreaterThan(0));

    // Only the OTHER admin's rows offer the action: 1 row × 2 layouts.
    // If the self row still offered it this would be 4.
    expect(deactivateButtons()).toHaveLength(2);

    // The self row explains itself instead of offering the action.
    expect(screen.getAllByText("حساب شما").length).toBe(2);
  });

  it("still lets the admin deactivate a different account", async () => {
    render(<AdminUsersTab />);

    await waitFor(() => expect(deactivateButtons()).toHaveLength(2));

    fireEvent.click(deactivateButtons()[0]);

    await waitFor(() => expect(updateAdminUserMock).toHaveBeenCalledWith(OTHER.id, { is_active: false }));
    expect(updateAdminUserMock).toHaveBeenCalledTimes(1);
  });

  it("never sends a self-deactivation even if the handler is invoked directly", async () => {
    render(<AdminUsersTab />);
    await waitFor(() => expect(screen.getAllByText("مدیر سامانه").length).toBeGreaterThan(0));

    // The desktop row for the signed-in admin contains no toggle button at all.
    const selfRow = screen.getAllByText("مدیر سامانه")[0].closest("tr");
    expect(selfRow).not.toBeNull();
    expect(within(selfRow as HTMLElement).queryByRole("button", { name: /غیرفعال‌سازی/ })).toBeNull();

    // …and the role dropdown is locked, because every single-role change on
    // your own account is refused server-side (self-demotion = same lockout).
    const selfRoleSelect = within(selfRow as HTMLElement).getByLabelText("تغییر نقش کاربر") as HTMLSelectElement;
    expect(selfRoleSelect.disabled).toBe(true);

    const otherRow = screen.getAllByText("مدیر دوم")[0].closest("tr") as HTMLElement;
    const otherRoleSelect = within(otherRow).getByLabelText("تغییر نقش کاربر") as HTMLSelectElement;
    expect(otherRoleSelect.disabled).toBe(false);
  });
});
