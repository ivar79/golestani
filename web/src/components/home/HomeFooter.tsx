"use client";
import { cms, cmsList, useHomepageContent } from "@/lib/homepage";
import HomeIcon, { type HomeIconName } from "./HomeIcon";

export default function HomeFooter() {
  const content = useHomepageContent();
  const about = cms(content, "footer.about");
  const copyrightRaw = cms(content, "footer.copyright");
  const copyright = copyrightRaw
    ? copyrightRaw.replace(/۱۴۰۳|1403/g, "۱۴۰۵")
    : "© ۱۴۰۵ تمامی حقوق برای اینکارت محفوظ است.";
  const links = cmsList<{ label: string; href: string }>(content, "footer.links");
  const socialsTitle = cms(content, "footer.socials_title");
  const socials = cmsList<{ icon: string; href: string; label?: string }>(content, "footer.socials");

  return (
    <footer className="mt-14 sm:mt-16 w-full border-t border-white/5 bg-panel/60 py-10 sm:py-12 backdrop-blur-2xl">
      <div className="mx-auto w-full px-[clamp(1.25rem,5vw,6rem)]">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12 items-start">
          <div className="col-span-1 md:col-span-6">
            <div className="mb-3.5 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-sm font-black text-white">اَ</span>
              <span className="text-xl font-bold text-white">{cms(content, "brand")}</span>
            </div>
            <p className="max-w-md text-sm leading-6 text-surface-variant">{about}</p>
          </div>
          <div className="col-span-1 md:col-span-3">
            <h4 className="mb-3.5 text-base font-semibold text-white">{cms(content, "footer.links_title")}</h4>
            <ul className="space-y-2.5">
              {links.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="text-sm text-surface-variant transition-colors hover:text-secondary">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="col-span-1 md:col-span-3 flex flex-col items-start md:items-end">
            {socialsTitle && (
              <h4 className="mb-3.5 text-base font-semibold text-white">{socialsTitle}</h4>
            )}
            <div className="flex items-center gap-3">
              {socials.map((social, i) => (
                <a
                  key={i}
                  href={social.href}
                  aria-label={social.label ?? social.icon}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-all hover:bg-secondary/20 hover:border-white/20"
                >
                  <HomeIcon name={(social.icon as HomeIconName) || "share"} className="h-5 w-5 text-white" />
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-8 sm:mt-10 border-t border-white/5 pt-5 text-center text-sm text-surface-variant">
          {copyright}
        </div>
      </div>
    </footer>
  );
}
