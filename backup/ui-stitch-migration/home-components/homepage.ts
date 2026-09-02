import { useEffect, useState } from "react";
import { getHomepageContent } from "@/lib/businesses";

/**
 * Shared homepage CMS content.
 * All homepage text is read from CMS `site_settings` keys (prefix `homepage.`).
 * Nothing is hard-coded here; empty values render as empty strings.
 */
export type HomepageContent = Record<string, string>;

let cache: HomepageContent | null = null;
let inflight: Promise<HomepageContent> | null = null;

async function fetchHomepageContent(): Promise<HomepageContent> {
  if (cache) return cache;
  if (!inflight) {
    inflight = getHomepageContent()
      .then((data) => {
        cache = data;
        return data;
      })
      .catch(() => {
        inflight = null;
        return {} as HomepageContent;
      });
  }
  return inflight;
}

/** Single-fetch shared hook for all homepage sections. */
export function useHomepageContent(): HomepageContent {
  const [content, setContent] = useState<HomepageContent>(cache ?? {});

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    void fetchHomepageContent().then((data) => {
      if (!cancelled) setContent(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return content;
}

/** Convenience: read a CMS key with the `homepage.` prefix applied. */
export function cms(content: HomepageContent, slot: string): string {
  return content[`homepage.${slot}`] ?? "";
}

/** Parse a JSON-array CMS value (e.g. showcase card lists) with a safe fallback. */
export function cmsList<T = string>(content: HomepageContent, slot: string, fallback: T[] = []): T[] {
  const raw = cms(content, slot);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}
