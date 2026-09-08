import { useEffect, useState } from "react";
import { getAdminUsers, updateAdminUser, type AdminUser } from "@/lib/admin";
import { extractApiError } from "@/lib/api";
import { Shield, UserX, UserCheck, Loader2 } from "lucide-react";

export default function AdminUsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);

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
    setTimeout(() => fetchUsers(page), 0);
  }, [page]);

  const handleToggleStatus = async (user: AdminUser) => {
    try {
      const updated = await updateAdminUser(user.id, { is_active: !user.is_active });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
    } catch (err) {
      alert(extractApiError(err));
    }
  };

  if (loading && users.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">کاربران سامانه ({total} نفر)</h2>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-6 py-4 font-medium">کاربر</th>
                <th className="px-6 py-4 font-medium">شماره تماس</th>
                <th className="px-6 py-4 font-medium">نقش‌ها</th>
                <th className="px-6 py-4 font-medium">وضعیت</th>
                <th className="px-6 py-4 font-medium text-left">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">
                      {user.name || "کاربر ناشناس"}
                    </div>
                    <div className="text-xs text-gray-500">{user.email || "بدون ایمیل"}</div>
                  </td>
                  <td className="px-6 py-4 font-mono text-gray-700">{user.phone}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((r) => (
                        <span
                          key={r.name}
                          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700"
                        >
                          <Shield className="h-3 w-3" />
                          {r.display_name}
                        </span>
                      ))}
                      {user.roles.length === 0 && (
                        <span className="text-gray-400">بدون نقش</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        user.is_active
                          ? "bg-green-50 text-green-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {user.is_active ? "فعال" : "غیرفعال"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-left">
                    <button
                      onClick={() => handleToggleStatus(user)}
                      className={`inline-flex items-center gap-1 text-sm font-medium transition-colors ${
                        user.is_active
                          ? "text-red-600 hover:text-red-700"
                          : "text-green-600 hover:text-green-700"
                      }`}
                    >
                      {user.is_active ? (
                        <>
                          <UserX className="h-4 w-4" /> غیرفعال‌سازی
                        </>
                      ) : (
                        <>
                          <UserCheck className="h-4 w-4" /> فعال‌سازی
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500">
                    هیچ کاربری یافت نشد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {lastPage > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
            <button
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="text-sm font-medium text-gray-600 disabled:opacity-50"
            >
              صفحه قبل
            </button>
            <span className="text-sm text-gray-500">
              صفحه {page} از {lastPage}
            </span>
            <button
              disabled={page === lastPage}
              onClick={() => setPage(page + 1)}
              className="text-sm font-medium text-gray-600 disabled:opacity-50"
            >
              صفحه بعد
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
