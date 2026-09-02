"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  fetchHomepageContentClient,
  type HomepageContent,
} from "@/lib/homepageContent";

// Re-exported so existing `@/lib/homepage` imports keep working.
export type { HomepageContent };
export { cms, cmsList } from "@/lib/homepageContent";

const HomepageContext = createContext<HomepageContent | null>(null);

/** Server-rendered provider: wraps homepage sections so they get CMS text synchronously. */
export function HomepageContentProvider({
  content,
  children,
}: {
  content: HomepageContent;
  children: ReactNode;
}) {
  return <HomepageContext.Provider value={content}>{children}</HomepageContext.Provider>;
}

/**
 * Client hook. Returns provider content when available (SSR-complete),
 * otherwise fetches from the CMS API on mount (non-homepage usages).
 */
export function useHomepageContent(): HomepageContent {
  const provided = useContext(HomepageContext);
  const [content, setContent] = useState<HomepageContent>(provided ?? {});

  useEffect(() => {
    if (provided) return;
    let cancelled = false;
    void fetchHomepageContentClient().then((data) => {
      if (!cancelled) setContent(data);
    });
    return () => {
      cancelled = true;
    };
  }, [provided]);

  return content;
}
