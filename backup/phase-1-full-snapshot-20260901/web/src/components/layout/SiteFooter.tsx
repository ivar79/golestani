import Link from "next/link";
import { BrandMark } from "./SiteHeader";

export default function SiteFooter() {
  return (
    <footer className="border-t border-outline-variant/50 bg-surface-container-low">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between lg:px-10">
        <div className="flex items-center gap-3">
          <BrandMark size="sm" />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/about" className="transition hover:text-navy-700">درباره ما</Link>
          <Link href="/contact" className="transition hover:text-navy-700">تماس با ما</Link>
          <Link href="/privacy" className="transition hover:text-navy-700">حریم خصوصی</Link>
        </div>
        <div className="text-left" dir="ltr">
          <a href="mailto:hello@inkart.ir" className="block transition hover:text-navy-700">hello@inkart.ir</a>
        </div>
      </div>
    </footer>
  );
}
