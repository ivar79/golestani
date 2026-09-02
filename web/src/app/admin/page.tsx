"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import { getAdminOverview, moderateAdminBusiness, moderateAdminSubscription, type AdminOverview } from "@/lib/admin";
import { getAdminSettings, saveAdminSetting } from "@/lib/admin";
import AdminPagesTab from "@/components/admin/AdminPagesTab";
import AdminBlogTab from "@/components/admin/AdminBlogTab";
import AdminMediaTab from "@/components/admin/AdminMediaTab";

const TABS = ["Overview", "Homepage", "Pages", "Blog", "Media"] as const;
type Tab = (typeof TABS)[number];

const HOMEPAGE_KEYS = [
  "homepage.hero.title",
  "homepage.hero.subtitle",
  "homepage.hero.badges",
  "homepage.hero.button_primary",
  "homepage.hero.button_primary_link",
  "homepage.hero.button_secondary",
  "homepage.hero.button_secondary_link",
  "homepage.hero.image",
  "homepage.hero.background",
  "homepage.hero.card_title",
  "homepage.hero.card_subtitle",
  "homepage.hero.card_phone",
  "homepage.hero.card_location",
  "homepage.feature.1.title",
  "homepage.feature.1.description",
  "homepage.feature.2.title",
  "homepage.feature.2.description",
  "homepage.feature.3.title",
  "homepage.feature.3.description",
  "homepage.showcase.title",
  "homepage.showcase.subtitle",
  "homepage.showcase.cards",
  "homepage.howitworks.title",
  "homepage.howitworks.steps",
  "homepage.cta.title",
  "homepage.cta.subtitle",
  "homepage.cta.button_primary",
  "homepage.cta.button_primary_link",
  "homepage.cta.button_secondary",
  "homepage.cta.button_secondary_link",
  "homepage.footer.about",
  "homepage.footer.links",
  "homepage.footer.copyright",
  "homepage.brand",
  "homepage.nav.features",
  "homepage.nav.showcase",
  "homepage.nav.about",
  "homepage.nav.contact",
  "homepage.header.login",
  "seo.homepage",
];

export default function AdminPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("Overview");
  const [data, setData] = useState<AdminOverview | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function refresh() {
    try {
      const [overview, rows] = await Promise.all([
        getAdminOverview(),
        getAdminSettings(),
      ]);
      setData(overview);
      setSettings(Object.fromEntries(rows.map((x) => [x.key, x.value ?? ""])));
      setError(null);
    } catch (e) {
      setError(extractApiError(e));
    }
  }

  useEffect(() => {
    if (!authLoading && (!user || !user.roles.includes("admin"))) router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user?.roles.includes("admin")) {
      const t = window.setTimeout(() => void refresh(), 0);
      return () => window.clearTimeout(t);
    }
  }, [user]);

  async function save() {
    try {
      await Promise.all(
        Object.entries(settings).map(([key, value]) =>
          saveAdminSetting(key, value),
        ),
      );
      setSaved(true);
      await refresh();
    } catch (e) {
      setError(extractApiError(e));
    }
  }

  if (authLoading || !user || !user.roles.includes("admin"))
    return <main className="p-10 text-center">در حال بررسی دسترسی…</main>;

  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-7xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between rounded-3xl border bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-emerald-600">مدیریت اینکارت</p>
          <h1 className="text-3xl font-black text-navy-900">مرکز کنترل</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void refresh()} className="btn btn-outline btn-sm">
            به‌روزرسانی
          </button>
          <button
            onClick={async () => {
              await logout();
              router.push("/login");
            }}
            className="btn btn-primary btn-sm"
          >
            خروج
          </button>
        </div>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-5 py-2 text-sm font-medium transition ${
              tab === t
                ? "btn btn-primary"
                : "border bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">
          تغییرات ذخیره شد.
        </p>
      )}

      {tab === "Overview" && (
        <section className="grid gap-5 lg:grid-cols-2">
          <Queue
            title="کسب‌وکارها"
            items={data?.queues.businesses ?? []}
            action={(id) => moderateAdminBusiness(id, "approved")}
            label="تأیید"
          />
          <Queue
            title="اشتراک‌ها"
            items={data?.queues.subscriptions ?? []}
            action={(id) => moderateAdminSubscription(id, "active")}
            label="فعال‌سازی"
          />
        </section>
      )}

      {tab === "Homepage" && (
        <section className="mb-8 rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">محتوای homepage و SEO</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {HOMEPAGE_KEYS.map((key) => (
              <label key={key} className="grid gap-1.5">
                <span className="text-sm font-medium">{key}</span>
                {key.includes("description") ||
                key.includes("subtitle") ||
                key.includes("seo") ||
                key.includes("about") ||
                key.includes("cards") ||
                key.includes("steps") ||
                key.includes("links") ? (
                  <textarea
                    value={settings[key] ?? ""}
                    onChange={(e) =>
                      setSettings((x) => ({ ...x, [key]: e.target.value }))
                    }
                    className="min-h-24 rounded-xl border p-3"
                  />
                ) : (
                  <input
                    value={settings[key] ?? ""}
                    onChange={(e) =>
                      setSettings((x) => ({ ...x, [key]: e.target.value }))
                    }
                    className="rounded-xl border p-3"
                  />
                )}
              </label>
            ))}
          </div>
          <button
            onClick={() => void save()}
        className="btn btn-primary mt-5"
      >
        ذخیره محتوای سایت
          </button>
        </section>
      )}

      {tab === "Pages" && <AdminPagesTab />}
      {tab === "Blog" && <AdminBlogTab />}
      {tab === "Media" && <AdminMediaTab />}
    </main>
  );
}

function Queue({
  title,
  items,
  action,
  label,
}: {
  title: string;
  items: Record<string, unknown>[];
  action: (id: number) => Promise<unknown>;
  label: string;
}) {
  return (
    <article className="rounded-3xl border bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {items.length ? (
        <ul className="grid gap-2">
          {items.map((x, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-xl bg-navy-50 p-3 text-sm"
            >
              <span>
                {String(
                  x.name ??
                    x.title ??
                    (x.business as { name?: string } | undefined)?.name ??
                    "",
                )}
              </span>
              <button
                onClick={() => void action(Number(x.id))}
                className="text-emerald-700"
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">موردی وجود ندارد.</p>
      )}
    </article>
  );
}
