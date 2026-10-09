/**
 * Template client + shared domain types — the frontend mirror of the
 * server's ONE apply contract (GET /card-templates, POST …/apply).
 *
 * SECURITY NOTE: `entitled` in gallery payloads is UX ONLY. The server
 * re-authorizes every apply and every save; nothing here is trusted.
 */

import type { CardDocument } from "./document";
import { readStoredToken } from "@/lib/session";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

export type TemplateSource = "builtin" | "db" | "personal";

/** One gallery row (builtin + DB templates; personal templates are private). */
export type GalleryTemplate = {
  id: string;
  db_id?: number;
  source: TemplateSource;
  origin?: "admin" | "designer";
  name_fa: string;
  category: string;
  description?: string;
  background: string;
  entitled: boolean;
};

/** The consumer entitlement shape returned with every applied document. */
export type ApplyLimits = {
  max_layers: number | null;
  layer_kinds: string[];
  max_premium_elements: number | null;
};

export type ApplyResponse = {
  template: { id: string; db_id?: number; source: TemplateSource };
  document: { background: string; layers: CardDocument["layers"] };
  limits: ApplyLimits;
};

function authHeaders(): Record<string, string> {
  const token = readStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `درخواست قالب ناموفق بود (${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

/**
 * Gallery with per-business entitlement flags (anonymous-safe).
 *
 * Deadline-bound and cancellable: callers pass a signal tied to the panel's
 * lifetime, so unmounting the studio never leaves this request hanging (it used
 * to answer after 42s on a saturated API and then set state on a dead tree).
 */
export async function fetchGallery(businessId?: number, signal?: AbortSignal): Promise<GalleryTemplate[]> {
  const qs = businessId ? `?business_id=${businessId}` : "";
  const res = await fetchWithTimeout(`${API}/card-templates${qs}`, {
    headers: authHeaders(),
    cache: "no-store",
    signal,
  });
  const body = await parse<{ templates: GalleryTemplate[] }>(res);
  return body.templates;
}

/**
 * THE apply call — server authorizes, clones, regenerates layer ids and
 * fills placeholders; the frontend merely installs the returned document
 * through the engine's one-record apply (applyTemplateDoc).
 */
export async function applyTemplate(input: {
  source: TemplateSource;
  id: string;
  businessId: number;
}): Promise<ApplyResponse> {
  const path =
    input.source === "builtin"
      ? `${API}/card-templates/builtin/${encodeURIComponent(input.id)}/apply`
      : input.source === "personal"
        ? `${API}/my/templates/${encodeURIComponent(input.id)}/apply`
        : `${API}/card-templates/${encodeURIComponent(input.id)}/apply`;

  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ business_id: input.businessId }),
  });

  return parse<ApplyResponse>(res);
}
