"use client";

/**
 * Owner-session QR registration.
 *
 * The QR of a NOT-YET-APPROVED business is owner-only on the API, so the
 * anonymous same-origin proxy (`/api/qr/{slug}`) answers 404 for it and the
 * layer used to render its empty placeholder — in the editor AND in the
 * export. While the studio is open we fetch each referenced slug through the
 * authenticated client (bearer token, same account that owns the business) and
 * register the resulting data URL, which the renderer/exporter consult first.
 *
 * Failure is silent and honest: the public proxy stays the fallback, so an
 * approved business still renders through the cached route and a genuinely
 * missing QR keeps its placeholder.
 */

import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import type { CardDocument, QrLayer } from "../domain/document";
import { qrSlug, registerQrAsset, registeredQrSrc } from "../domain/qrAssets";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("unreadable blob"));
    reader.readAsDataURL(blob);
  });
}

/** Every distinct QR payload referenced by the document. */
export function documentQrSlugs(doc: CardDocument | null | undefined): string[] {
  const slugs = new Set<string>();
  for (const layer of doc?.layers ?? []) {
    if (layer.kind !== "qr") continue;
    const slug = qrSlug((layer as QrLayer).payload);
    if (slug) slugs.add(slug);
  }
  return [...slugs];
}

/**
 * Register authenticated QR assets for the document's payloads.
 * Returns a monotonically increasing revision so the caller re-renders (the
 * registry is plain module state, read by the renderer while it renders).
 */
export function useQrAssets(doc: CardDocument | null | undefined): number {
  const slugs = useMemo(() => documentQrSlugs(doc).sort().join("|"), [doc]);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const targets = slugs ? slugs.split("|") : [];
    if (targets.length === 0) return;
    let cancelled = false;
    const pending = targets.filter((slug) => !registeredQrSrc(slug));
    if (pending.length === 0) return;

    void Promise.all(
      pending.map(async (slug) => {
        try {
          const res = await api.get<Blob>(`/public/businesses/${encodeURIComponent(slug)}/qr`, {
            responseType: "blob",
          });
          registerQrAsset(slug, await blobToDataUrl(res.data));
        } catch {
          // Draft/foreign/unknown slug: the public proxy (or the placeholder)
          // stays in charge — never a fabricated QR.
        }
      }),
    ).then(() => {
      if (!cancelled) setRevision((value) => value + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [slugs]);

  return revision;
}
