import { useEffect, useState } from "react";
import { getAdminUsers, updateAdminUser, type AdminUser } from "@/lib/admin";
import { extractApiError } from "@/lib/api";
import { Shield, UserX, UserCheck, Loader2, Phone, Mail, User } from "lucide-react";

export default function AdminUsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchUsers = async (p = 1) => {
    try {
      setLoading(true);
      const res = await getAdminUsers(p);
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
  };

  useEffect(() => {
    const t = window.setTimeout(() => void fetchUsers(page), 0);
    return () => window.clearTimeout(t);
  }, [page]);

  const handleToggleStatus = async (user: AdminUser) => {
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
            مجموع {total} کاربر ثبت‌شده در پلتفرم
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs sm:text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Desktop & Tablet Table (md and up) */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-slate-800 bg-[#0b1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80 text-xs font-semibold text-slate-400">
              <tr>
                <th className="px-5 py-3.5">کاربر</th>
                <th className="px-5 py-3.5">شماره تماس</th>
                <th className="px-5 py-3.5">نقش‌ها</th>
                <th className="px-5 py-3.5">وضعیت</th>
                <th className="px-5 py-3.5 text-left">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {users.map((user) => {
                const isBusy = busyId === user.id;
                return (
                  <tr key={user.id} className="transition-colors hover:bg-slate-850/50">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-white">
                        {user.name || "کاربر ناشناس"}
                      </div>
                      <div className="text-xs text-slate-400">{user.email || "بدون ایمیل"}</div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-300" dir="ltr">
                      {user.phone}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((r) => (
                          <span
                            key={r.name}
                            className="inline-flex items-center gap-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-xs font-medium text-cyan-300 whitespace-nowrap"
                          >
                            <Shield className="h-3 w-3" />
                            {r.display_name}
                          </span>
                        ))}
                        {user.roles.length === 0 && (
                          <span className="text-xs text-slate-500">کاربر عادی</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
                          user.is_active
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                        }`}
                      >
                        {user.is_active ? "فعال" : "غیرفعال"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-left">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleAction(user)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap active:scale-95 disabled:opacity-50 cursor-pointer ${
                          user.is_active
                            ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
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
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-slate-400">
                    هیچ کاربری یافت نشد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card Stack (< md) for touch-first experience */}
      <div className="grid gap-3 md:hidden">
        {users.map((user) => {
          const isBusy = busyId === user.id;
          return (
            <div
              key={user.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-[#0b1120] p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-850 text-cyan-400">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      {user.name || "کاربر ناشناس"}
                    </h4>
                    <span
                      className={`mt-1 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                        user.is_active
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
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
                      className="inline-flex items-center gap-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-medium text-cyan-300 whitespace-nowrap"
                    >
                      <Shield className="h-2.5 w-2.5" />
                      {r.display_name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1 text-xs text-slate-400 border-t border-slate-800/60 pt-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Phone className="h-3 w-3" /> تماس
                  </span>
                  <span className="font-mono text-slate-200" dir="ltr">
                    {user.phone}
                  </span>
                </div>
                {user.email && (
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <Mail className="h-3 w-3" /> ایمیل
                    </span>
                    <span className="text-slate-300 truncate max-w-[180px]">
                      {user.email}
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleAction(user)}
                  className={`flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-all whitespace-nowrap active:scale-[0.98] disabled:opacity-50 cursor-pointer ${
                    user.is_active
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
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
              </div>
            </div>
          );
        })}

        {users.length === 0 && !loading && (
          <div className="rounded-xl border border-slate-800 bg-[#0b1120] p-8 text-center text-xs text-slate-400">
            هیچ کاربری یافت نشد.
          </div>
        )}
      </div>

      {/* Pagination */}
      {lastPage > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 pt-4">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="flex min-h-[38px] items-center justify-center rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-700 hover:text-white disabled:opacity-40 whitespace-nowrap cursor-pointer"
          >
            صفحه قبل
          </button>
          <span className="text-xs text-slate-400">
            صفحه {page} از {lastPage}
          </span>
          <button
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
            className="flex min-h-[38px] items-center justify-center rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-700 hover:text-white disabled:opacity-40 whitespace-nowrap cursor-pointer"
          >
            صفحه بعد
          </button>
        </div>
      )}
    </div>
  );

  async function handleAction(u: AdminUser) {
    await handleToggleStatus(u);
  }
}
