import Link from "next/link";
import HomeIcon from "./HomeIcon";

export default function HomeFooter() {
  return (
    <footer className="mt-24 w-full border-t border-white/5 bg-panel/60 py-16 backdrop-blur-2xl">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-4">
          <div className="col-span-1 md:col-span-2">
            <div className="mb-6 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-sm font-black text-white">a</span>
              <span className="text-xl font-bold text-white">Inkart</span>
            </div>
            <p className="max-w-md text-sm leading-6 text-surface-variant">
              Platform kartu nama digital cerdas untuk usaha modern Indonesia. Jadikan merek Anda dikenal dunia dengan Inkart.
            </p>
          </div>
          <div>
            <h4 className="mb-6 text-lg font-semibold text-white">Akses Cepat</h4>
            <ul className="space-y-4">
              {["Dukungan", "Syarat & Ketentuan", "FAQ"].map((label) => (
                <li key={label}>
                  <Link href="/contact" className="text-sm text-surface-variant transition-colors hover:text-secondary">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-6 text-lg font-semibold text-white">Media Sosial</h4>
            <div className="flex gap-4">
              <a href="/contact" aria-label="Share" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-all hover:bg-secondary/20">
                <HomeIcon name="share" className="h-5 w-5 text-white" />
              </a>
              <a href="mailto:hello@inkart.ir" aria-label="Email" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-all hover:bg-secondary/20">
                <HomeIcon name="at" className="h-5 w-5 text-white" />
              </a>
            </div>
          </div>
        </div>
        <div className="mt-16 border-t border-white/5 pt-8 text-center text-sm text-surface-variant">
          (c) 2026 Inkart. Hak cipta dilindungi.
        </div>
      </div>
    </footer>
  );
}
