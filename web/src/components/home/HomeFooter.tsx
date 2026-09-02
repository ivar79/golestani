"use client";
import { cms, cmsList, useHomepageContent } from "@/lib/homepage";
import HomeIcon, { type HomeIconName } from "./HomeIcon";

export default function HomeFooter() {
  const content = useHomepageContent();
  const about = cms(content, "footer.about");
  const copyright = cms(content, "footer.copyright");
  const links = cmsList<{ label: string; href: string }>(content, "footer.links");
  const socialsTitle = cms(content, "footer.socials_title");
  const socials = cmsList<{ icon: string; href: string; label?: string }>(content, "footer.socials");

  return (
    <footer className="mt-24 w-full border-t border-white/5 bg-panel/60 py-16 backdrop-blur-2xl">
      <div className="mx-auto w-full px-[clamp(1.25rem,5vw,6rem)]">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-4">
          <div className="col-span-1 md:col-span-2">
            <div className="mb-6 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-sm font-black text-white">اَ</span>
              <span className="text-xl font-bold text-white">{cms(content, "brand")}</span>
            </div>
            <p className="max-w-md text-sm leading-6 text-surface-variant">{about}</p>
          </div>
          <div>
            <h4 className="mb-6 text-lg font-semibold text-white">{cms(content, "footer.links_title")}</h4>
            <ul className="space-y-4">
              {links.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="text-sm text-surface-variant transition-colors hover:text-secondary">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-6 text-lg font-semibold text-white">{socialsTitle}</h4>
            <div className="flex gap-4">
              {socials.map((social, i) => (
                <a
                  key={i}
                  href={social.href}
                  aria-label={social.label ?? social.icon}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-all hover:bg-secondary/20"
                >
                  <HomeIcon name={(social.icon as HomeIconName) || "share"} className="h-5 w-5 text-white" />
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-16 border-t border-white/5 pt-8 text-center text-sm text-surface-variant">
          {copyright}
        </div>
      </div>
    </footer>
  );
}
