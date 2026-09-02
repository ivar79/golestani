import Link from "next/link";
import HomeIcon from "./HomeIcon";

const nav = [
  { label: "خانه", href: "/", active: true },
  { label: "ویژگی‌ها", href: "#features" },
  { label: "نمونه کارها", href: "#showcase" },
  { label: "درباره ما", href: "/about" },
  { label: "تماس با ما", href: "/contact" },
];

const navItems: { label: string; href: string; active?: boolean }[] = nav;

export default function HomeHeader() {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-white/5 bg-night/40 shadow-[0_1px_20px_rgba(0,0,0,0.2)] backdrop-blur-xl">
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3" aria-label="اینکارت — صفحه اصلی">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-lg font-black text-white shadow-lg shadow-secondary/20">
              اَ
            </span>
            <span className="text-xl font-bold text-white lg:text-2xl">اینکارت</span>
          </Link>
          <nav className="mr-12 hidden items-center gap-8 xl:flex">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={
                  item.active
                    ? "font-bold text-secondary"
                    : "text-sm text-surface-variant transition-colors hover:text-white"
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="rounded-xl bg-secondary px-6 py-2 text-sm font-medium text-white shadow-lg shadow-secondary/20 transition-all hover:bg-secondary-container hover:text-night"
          >
            ورود / ثبت‌نام
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-primary">
            <HomeIcon name="person" className="h-5 w-5 text-white" />
          </div>
        </div>
      </div>
    </header>
  );
}
