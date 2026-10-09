import { useEffect, useMemo, useState } from "react";
import {
  getAdminUsers,
  updateAdminUser,
  updateAdminUserDesignerStatus,
  type AdminUser,
  type AdminUserRoleFilter,
} from "@/lib/admin";
import { extractApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  AtSign,
  Crown,
  Loader2,
  Lock,
  Mail,
  Palette,
  Phone,
  Search,
  Shield,
  Store,
  User,
  UserCheck,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * SELF-ACCOUNT LOCKOUT PROTECTION (2026-10-09).
 *
 * An admin deactivating or demoting their OWN account is unrecoverable from
 * the product: CheckRole denies every admin route for inactive accounts and
 * loginAdmin refuses inactive admins, so the only way back is direct DB
 * access. Standard practice is that the option is never offered for your own
 * account in the first place (Google Workspace does not let you delete or
 * deactivate the account you are signed in as, and keeps a mandatory last
 * super admin) — hiding it is the convenience layer, the API rejects it with
 * 422 either way (AdminController::updateUser).
 *
 * So for the signed-in admin's own row: the status toggle is REMOVED, not
 * disabled, and the role dropdown is locked (every single-role change on your
 * own account is refused server-side, so the control was dead anyway).
 */
const SELF_STATUS_HINT = "حساب خودتان غیرقابل غیرفعال‌سازی است (جلوگیری از قفل‌شدن کامل دسترسی مدیریتی).";
const SELF_ROLE_HINT = "نقش حساب خودتان قابل تغییر نیست (جلوگیری از حذف دسترسی مدیریتی خودتان).";

/** Canonical designer program statuses (users.designer_status). */
const DESIGNER_STATUSES = ["none", "pending", "approved", "rejected", "suspended"] as const;
const DESIGNER_STATUS_LABELS: Record<string, string> = {
  none: "بدون وضعیت",
  pending: "در انتظار بررسی",
  approved: "طراح تأییدشده",
  rejected: "ردشده",
  suspended: "تعلیق‌شده",
};
const DESIGNER_STATUS_STYLES: Record<string, string> = {
  none: "border-white/10 bg-white/5 text-slate-400",
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  suspended: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};

type RoleKey = AdminUserRoleFilter;

type RoleGroupDef = {
  key: RoleKey;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Active/inactive chip classes. */
  chipActive: string;
  chipIdle: string;
  sectionBorder: string;
  sectionHeader: string;
  iconWrap: string;
  countBadge: string;
};

/**
 * Display order and identity of the role groups. A user with several roles is
 * placed in the FIRST group it matches (admin > designer > business_owner >
 * user) so nobody is listed twice — the same priority the panels use.
 */
const ROLE_GROUPS: RoleGroupDef[] = [
  {
    key: "admin",
    label: "مدیران سامانه",
    hint: "دسترسی کامل مدیریتی",
    icon: Crown,
    chipActive: "border-amber-400/50 bg-amber-400/15 text-amber-200",
    chipIdle: "border-white/10 bg-white/[0.03] text-slate-400 hover:text-amber-200 hover:border-amber-400/30",
    sectionBorder: "border-amber-400/25",
    sectionHeader: "border-b border-amber-400/20 bg-amber-400/[0.06]",
    iconWrap: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    countBadge: "border-amber-400/30 bg-amber-400/15 text-amber-300",
  },
  {
    key: "designer",
    label: "طراحان",
    hint: "طراحان کارت و نمونه‌کار",
    icon: Palette,
    chipActive: "border-fuchsia-400/50 bg-fuchsia-400/15 text-fuchsia-200",
    chipIdle: "border-white/10 bg-white/[0.03] text-slate-400 hover:text-fuchsia-200 hover:border-fuchsia-400/30",
    sectionBorder: "border-fuchsia-400/25",
    sectionHeader: "border-b border-fuchsia-400/20 bg-fuchsia-400/[0.06]",
    iconWrap: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300",
    countBadge: "border-fuchsia-400/30 bg-fuchsia-400/15 text-fuchsia-300",
  },
  {
    key: "business_owner",
    label: "کاسب‌ها",
    hint: "صاحبان کسب‌وکار",
    icon: Store,
    chipActive: "border-cyan-400/50 bg-cyan-400/15 text-cyan-200",
    chipIdle: "border-white/10 bg-white/[0.03] text-slate-400 hover:text-cyan-200 hover:border-cyan-400/30",
    sectionBorder: "border-cyan-400/25",
    sectionHeader: "border-b border-cyan-400/20 bg-cyan-400/[0.06]",
    iconWrap: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
    countBadge: "border-cyan-400/30 bg-cyan-400/15 text-cyan-300",
  },
  {
    key: "user",
    label: "کاربران عادی",
    hint: "بدون نقش ویژه",
    icon: User,
    chipActive: "border-slate-300/40 bg-slate-300/15 text-slate-100",
    chipIdle: "border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-100 hover:border-slate-300/30",
    sectionBorder: "border-white/[0.08]",
    sectionHeader: "border-b border-white/[0.06] bg-white/[0.02]",
    iconWrap: "border-slate-400/30 bg-slate-400/10 text-slate-300",
    countBadge: "border-slate-400/30 bg-slate-400/15 text-slate-300",
  },
];

/** Highest-priority role a user holds (nobody is listed in two groups). */
function primaryRole(user: AdminUser): RoleKey {
  const names = user.roles.map((r) => r.name);
  if (names.includes("admin")) return "admin";
  if (names.includes("designer")) return "designer";
  if (names.includes("business_owner")) return "business_owner";
  return "user";
}

type Handlers = {
  busyId: number | null;
  /** Signed-in admin's id — their own row offers no lockout action. */
  currentUserId: number | null;
  onToggleStatus: (user: AdminUser) => void;
  onRoleChange: (user: AdminUser, role: string) => void;
  onDesignerStatusChange: (user: AdminUser, next: string) => void;
};

/** Desktop/tablet table for one role group. */
function GroupTable({ users, busyId, currentUserId, onToggleStatus, onRoleChange, onDesignerStatusChange }: Handlers & { users: AdminUser[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm">
        <thead className="border-b border-white/[0.08] bg-white/[0.03] text-xs font-semibold text-slate-400">
          <tr>
            <th className="px-5 py-3.5">کاربر</th>
            <th className="px-5 py-3.5">شماره تماس</th>
            <th className="px-5 py-3.5">نقش‌ها</th>
            <th className="px-5 py-3.5">وضعیت طراح</th>
            <th className="px-5 py-3.5">وضعیت</th>
            <th className="px-5 py-3.5 text-left">عملیات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.08]">
          {users.map((user) => {
            const isBusy = busyId === user.id;
            const isSelf = currentUserId !== null && user.id === currentUserId;
            return (
              <tr key={user.id} className="transition-colors hover:bg-white/[0.03]">
                <td className="px-5 py-3.5">
                  <div className="font-semibold text-white">{user.name || "کاربر ناشناس"}</div>
                  {user.username ? (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-cyan-300/90" dir="ltr">
                      <AtSign className="h-3 w-3" />
                      {user.username}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs text-slate-500">بدون نام کاربری</div>
                  )}
                  <div className="text-xs text-slate-400">{user.email || "بدون ایمیل"}</div>
                </td>
                <td className="px-5 py-3.5 font-mono text-xs text-slate-300" dir="ltr">
                  {user.phone}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {user.roles.map((r) => (
                      <span
                        key={r.name}
                        className="inline-flex items-center gap-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-xs font-medium text-cyan-300 whitespace-nowrap shadow-[0_0_10px_rgba(34,211,238,0.15)]"
                      >
                        <Shield className="h-3 w-3" />
                        {r.display_name}
                      </span>
                    ))}
                    {user.roles.length === 0 && <span className="text-xs text-slate-500">کاربر عادی</span>}
                    <span title={isSelf ? SELF_ROLE_HINT : undefined}>
                      <select
                        value={user.roles[0]?.name ?? "user"}
                        onChange={(event) => void onRoleChange(user, event.target.value)}
                        disabled={isBusy || isSelf}
                        className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-[11px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="تغییر نقش کاربر"
                      >
                        <option value="user">کاربر</option>
                        <option value="business_owner">صاحب کسب‌وکار</option>
                        <option value="designer">طراح</option>
                        <option value="support">پشتیبانی</option>
                        <option value="expert">کارشناس</option>
                        <option value="admin">مدیر</option>
                      </select>
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                          DESIGNER_STATUS_STYLES[user.designer_status ?? "none"] ?? "border-white/10 text-slate-400"
                        }`}
                      >
                        <Palette className="h-3 w-3" />
                        {DESIGNER_STATUS_LABELS[user.designer_status ?? "none"] ?? user.designer_status}
                      </span>
                      {user.designer && user.designer.status !== (user.designer_status ?? "none") && (
                        <span
                          className="inline-flex items-center rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300 whitespace-nowrap"
                          title={`وضعیت قدیمی برنامه طراحان: ${DESIGNER_STATUS_LABELS[user.designer.status] ?? user.designer.status}`}
                        >
                          ناهم‌خوانی
                        </span>
                      )}
                    </div>
                    <select
                      value={user.designer_status ?? "none"}
                      onChange={(event) => void onDesignerStatusChange(user, event.target.value)}
                      disabled={isBusy}
                      className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-[11px] text-slate-300"
                      aria-label="تغییر وضعیت طراح"
                    >
                      {DESIGNER_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {DESIGNER_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${
                      user.is_active
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                        : "bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.15)]"
                    }`}
                  >
                    {user.is_active ? "فعال" : "غیرفعال"}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-left">
                  {isSelf ? (
                    <div className="flex flex-col items-end gap-1" title={SELF_STATUS_HINT}>
                      <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-500/30 bg-slate-500/10 px-3.5 py-1.5 text-xs font-semibold text-slate-300 whitespace-nowrap">
                        <Lock className="h-3.5 w-3.5" />
                        <span>حساب شما</span>
                      </span>
                      <span className="max-w-[190px] text-right text-[10px] leading-4 text-slate-500">
                        {SELF_STATUS_HINT}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onToggleStatus(user)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-all whitespace-nowrap active:scale-95 disabled:opacity-50 cursor-pointer ${
                        user.is_active
                          ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:border-rose-500/60 hover:bg-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.1)]"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-emerald-500/60 hover:bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]"
                      }`}
                    >
                      {user.is_active ? (
                        <>
                          <UserX className="h-3.5 w-3.5" />
                          <span>غیرفعال‌سازی</span>
                        </>
                      ) : (
                        <>
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>فعال‌سازی</span>
                        </>
                      )}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Touch-first card stack for one role group (< md). */
function GroupCards({ users, busyId, currentUserId, onToggleStatus, onDesignerStatusChange }: Omit<Handlers, "onRoleChange"> & { users: AdminUser[] }) {
  return (
    <div className="grid gap-3 md:hidden">
      {users.map((user) => {
        const isBusy = busyId === user.id;
        const isSelf = currentUserId !== null && user.id === currentUserId;
        return (
          <div
            key={user.id}
            className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:border-white/[0.12]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.15)]">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">{user.name || "کاربر ناشناس"}</h4>
                  {user.username && (
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-cyan-300/90" dir="ltr">
                      <AtSign className="h-3 w-3" />
                      {user.username}
                    </span>
                  )}
                  <span
                    className={`mt-1 inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                      user.is_active
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                        : "bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.15)]"
                    }`}
                  >
                    {user.is_active ? "فعال" : "غیرفعال"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-1">
                {user.roles.map((r) => (
                  <span
                    key={r.name}
                    className="inline-flex items-center gap-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-medium text-cyan-300 whitespace-nowrap shadow-[0_0_8px_rgba(34,211,238,0.15)]"
                  >
                    <Shield className="h-2.5 w-2.5" />
                    {r.display_name}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-white/[0.08] pt-2.5 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Palette className="h-3 w-3 text-fuchsia-400" /> وضعیت طراح
              </span>
              <div className="flex items-center gap-1.5">
                {user.designer && user.designer.status !== (user.designer_status ?? "none") && (
                  <span
                    className="rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300"
                    title={`وضعیت قدیمی برنامه طراحان: ${DESIGNER_STATUS_LABELS[user.designer.status] ?? user.designer.status}`}
                  >
                    ناهم‌خوانی
                  </span>
                )}
                <select
                  value={user.designer_status ?? "none"}
                  onChange={(event) => void onDesignerStatusChange(user, event.target.value)}
                  disabled={isBusy}
                  className="rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-[11px] text-slate-300"
                  aria-label="تغییر وضعیت طراح"
                >
                  {DESIGNER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {DESIGNER_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1 text-xs text-slate-400 border-t border-white/[0.08] pt-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <Phone className="h-3 w-3 text-cyan-400" /> تماس
                </span>
                <span className="font-mono text-slate-200" dir="ltr">
                  {user.phone}
                </span>
              </div>
              {user.email && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Mail className="h-3 w-3 text-cyan-400" /> ایمیل
                  </span>
                  <span className="text-slate-300 truncate max-w-[180px]">{user.email}</span>
                </div>
              )}
            </div>

            <div className="pt-1">
              {isSelf ? (
                <div className="flex flex-col items-center gap-1 rounded-xl border border-slate-500/30 bg-slate-500/10 px-4 py-2.5" title={SELF_STATUS_HINT}>
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <Lock className="h-4 w-4" />
                    <span>حساب شما</span>
                  </span>
                  <span className="text-center text-[10px] leading-4 text-slate-500">{SELF_STATUS_HINT}</span>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void onToggleStatus(user)}
                  className={`flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-all whitespace-nowrap active:scale-[0.98] disabled:opacity-50 cursor-pointer ${
                    user.is_active
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:border-rose-500/60 hover:bg-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.1)]"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-emerald-500/60 hover:bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]"
                  }`}
                >
                  {user.is_active ? (
                    <>
                      <UserX className="h-4 w-4" />
                      <span>غیرفعال‌سازی کاربر</span>
                    </>
                  ) : (
                    <>
                      <UserCheck className="h-4 w-4" />
                      <span>فعال‌سازی مجدد کاربر</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminUsersTab() {
  // Signed-in admin: their own row must not offer a self-lockout action.
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Search is debounced; the committed value drives the request.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleKey | "">("");

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          setLoading(true);
          const res = await getAdminUsers(page, search, roleFilter);
          setUsers(res.data);
          setPage(res.current_page);
          setLastPage(res.last_page);
          setTotal(res.total);
          setError("");
        } catch (err) {
          setError(extractApiError(err));
        } finally {
          setLoading(false);
        }
      })();
    }, 0);
    return () => window.clearTimeout(t);
  }, [page, search, roleFilter]);

  const groups = useMemo(() => {
    const buckets: Record<RoleKey, AdminUser[]> = { admin: [], designer: [], business_owner: [], user: [] };
    for (const user of users) buckets[primaryRole(user)].push(user);
    return ROLE_GROUPS.map((def) => ({ def, rows: buckets[def.key] })).filter((g) => g.rows.length > 0);
  }, [users]);

  const handleToggleStatus = async (user: AdminUser) => {
    // Defense in depth: even if a self row ever renders an action again, the
    // request is never sent — the API would answer 422 (self-deactivation is
    // an unrecoverable lockout).
    if (currentUserId !== null && user.id === currentUserId) return;
    setBusyId(user.id);
    try {
      const updated = await updateAdminUser(user.id, { is_active: !user.is_active });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
    } catch (err) {
      alert(extractApiError(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleRoleChange = async (user: AdminUser, role: string) => {
    setBusyId(user.id);
    try {
      const updated = await updateAdminUser(user.id, { roles: [role] });
      setUsers((prev) => prev.map((row) => (row.id === user.id ? updated : row)));
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Canonical designer approval: status + role + legacy row + audit are
   * synced server-side in one transaction. Rejection/suspension REQUIRE a
   * reason (collected here so the admin sees the rule up front).
   */
  const handleDesignerStatusChange = async (user: AdminUser, next: string) => {
    let reason: string | undefined;
    if (next === "rejected" || next === "suspended") {
      const typed = window.prompt("دلیل رد/تعلیق وضعیت طراح را بنویسید (الزامی):", "");
      if (typed === null) return;
      if (!typed.trim()) {
        alert("ثبت دلیل الزامی است.");
        return;
      }
      reason = typed.trim();
    }

    setBusyId(user.id);
    try {
      const updated = await updateAdminUserDesignerStatus(user.id, next, reason);
      setUsers((prev) => prev.map((row) => (row.id === user.id ? updated : row)));
    } catch (err) {
      alert(extractApiError(err));
    } finally {
      setBusyId(null);
    }
  };

  const isFiltering = search !== "" || roleFilter !== "";

  if (loading && users.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 text-right">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white">کاربران سامانه</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            مجموع {total} کاربر {isFiltering ? "مطابق فیلتر" : "ثبت‌شده در پلتفرم"}
          </p>
        </div>
      </div>

      {/* Search + role grouping controls */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-3 sm:p-4 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="جست‌وجو بر اساس نام کاربری، شماره تماس، نام یا ایمیل..."
            aria-label="جست‌وجوی کاربر"
            className="w-full rounded-xl border border-white/10 bg-slate-950/60 py-2.5 pr-10 pl-10 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/15"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="پاک کردن جست‌وجو"
              className="absolute left-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setRoleFilter("");
              setPage(1);
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
              roleFilter === ""
                ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
                : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-white hover:border-white/25"
            }`}
          >
            همه کاربران
          </button>
          {ROLE_GROUPS.map((def) => {
            const Icon = def.icon;
            const active = roleFilter === def.key;
            return (
              <button
                key={def.key}
                type="button"
                onClick={() => {
                  setRoleFilter(active ? "" : def.key);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  active ? def.chipActive : def.chipIdle
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {def.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs sm:text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Role-grouped sections */}
      <div className="space-y-6">
        {groups.map(({ def, rows }) => {
          const Icon = def.icon;
          return (
            <section key={def.key} className={`overflow-hidden rounded-2xl border bg-slate-900/60 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.25)] ${def.sectionBorder}`}>
              <header className={`flex items-center justify-between gap-3 px-4 py-3 sm:px-5 ${def.sectionHeader}`}>
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${def.iconWrap}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-white">{def.label}</h3>
                    <p className="text-[11px] text-slate-400">{def.hint}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${def.countBadge}`}>
                  {rows.length}
                </span>
              </header>

              <div className="hidden md:block">
                <GroupTable
                  users={rows}
                  busyId={busyId}
                  currentUserId={currentUserId}
                  onToggleStatus={handleToggleStatus}
                  onRoleChange={handleRoleChange}
                  onDesignerStatusChange={handleDesignerStatusChange}
                />
              </div>
              <div className="p-3 md:hidden">
                <GroupCards
                  users={rows}
                  busyId={busyId}
                  currentUserId={currentUserId}
                  onToggleStatus={handleToggleStatus}
                  onDesignerStatusChange={handleDesignerStatusChange}
                />
              </div>
            </section>
          );
        })}

        {groups.length === 0 && !loading && (
          <div className="rounded-2xl border border-white/[0.08] bg-slate-900/60 backdrop-blur-xl p-8 text-center text-xs text-slate-400 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
            {isFiltering ? "هیچ کاربری با این فیلتر پیدا نشد." : "هیچ کاربری یافت نشد."}
          </div>
        )}
      </div>

      {/* Pagination */}
      {lastPage > 1 && (
        <div className="flex items-center justify-between border-t border-white/[0.08] pt-4">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="flex min-h-[38px] items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white disabled:opacity-40 whitespace-nowrap cursor-pointer"
          >
            صفحه قبل
          </button>
          <span className="text-xs text-slate-400">
            صفحه {page} از {lastPage}
          </span>
          <button
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
            className="flex min-h-[38px] items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white disabled:opacity-40 whitespace-nowrap cursor-pointer"
          >
            صفحه بعد
          </button>
        </div>
      )}
    </div>
  );
}
