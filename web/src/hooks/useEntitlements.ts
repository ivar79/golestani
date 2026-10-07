"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EntitlementPayload } from "@/lib/entitlements";
import { FREE_TIER_FALLBACK } from "@/lib/entitlements";
import api from "@/lib/api";

/**
 * STANDARD Dashboard entitlement contract (endpoint: GET
 * /businesses/{id}/entitlements — the FeatureGate payload + subscription
 * time lifecycle in one read-only response).
 *
 * STALE-STATE FIX (requirement G): previously the dashboard fetched the
 * entitlement mirror ONCE per selected business and never refreshed — after
 * a successful payment the panels kept the OLD limits until a full reload.
 * This hook re-syncs on mount AND on focus/visibility (the same wake pattern
 * the greeting ticker uses), so a user returning from the payment result
 * page immediately sees the new plan — no logout/login, no window.reload().
 * The backend remains the security authority: these values drive UX only
 * (locked overlays, upgrade CTAs, remaining-time display).
 */

export type EntitlementSubscriptionInfo = {
  id: number;
  plan_id: number;
  plan_name: string | null;
  status: string;
  effective_status: string;
  started_at: string | null;
  expires_at: string | null;
  remaining_seconds: number | null;
  price_amount: number | null;
  price_currency: string | null;
  duration_days: number | null;
  /** The plan waiting to take over at the current period's end (downgrade). */
  scheduled: {
    plan_id: number;
    plan_name: string;
    starts_at: string;
    expires_at: string;
  } | null;
};

export type EntitlementsResponse = {
  entitlements: EntitlementPayload;
  subscription: EntitlementSubscriptionInfo | null;
};

export type UseEntitlementsResult = {
  entitlements: EntitlementPayload;
  subscription: EntitlementSubscriptionInfo | null;
  /** True while a request is in flight. */
  loading: boolean;
  /**
   * True once the server has answered at least once for the CURRENT business.
   * Until then `entitlements` is only the free-tier placeholder: UI that says
   * "plan inactive / upgrade" must wait for `ready`, otherwise a refresh flashes
   * a paid account as free.
   */
  ready: boolean;
  error: string | null;
  /** Manual re-sync (e.g. after the payment result page reports success). */
  refresh: () => void;
};

export function useEntitlements(businessId: number | undefined): UseEntitlementsResult {
  const [entitlements, setEntitlements] = useState<EntitlementPayload>(FREE_TIER_FALLBACK);
  const [subscription, setSubscription] = useState<EntitlementSubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [readyForBusiness, setReadyForBusiness] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Monotonic request counter: focus + visibility + mount can fire several
  // overlapping requests; only the NEWEST answer may write state, otherwise a
  // slow older response overwrites a newer one (active ↔ inactive flicker).
  const seq = useRef(0);
  // Which business the current state belongs to (never show business A's plan
  // while business B is loading).
  const stateFor = useRef<number | undefined>(undefined);

  const fetchOnce = useCallback(async () => {
    if (!businessId) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const data = (await api.get<EntitlementsResponse>(`/businesses/${businessId}/entitlements`)).data;
      if (!mounted.current || mine !== seq.current) return;
      if (data.entitlements) setEntitlements(data.entitlements);
      setSubscription(data.subscription ?? null);
      stateFor.current = businessId;
      setReadyForBusiness(businessId);
      setReady(true);
      setError(null);
    } catch (e) {
      if (!mounted.current || mine !== seq.current) return;
      // Keep the previous mirror for the SAME business (never crash the
      // dashboard for a UX mirror); `ready` stays as it was so a failed
      // refetch does not pretend the account is free.
      setError(e instanceof Error ? e.message : "entitlements fetch failed");
    } finally {
      if (mounted.current && mine === seq.current) setLoading(false);
    }
  }, [businessId]);

  const refresh = useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  // Initial fetch per business (deferred tick, project pattern). A business
  // switch first drops the previous business' mirror.
  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => {
      if (stateFor.current !== businessId) {
        setEntitlements(FREE_TIER_FALLBACK);
        setSubscription(null);
        setReady(false);
        setReadyForBusiness(undefined);
        stateFor.current = undefined;
      }
      void fetchOnce();
    }, 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
    };
  }, [businessId, fetchOnce]);

  // Wake re-sync: returning to the tab / window after a payment (or any
  // absence) refetches so limits and remaining time can never go stale.
  useEffect(() => {
    if (!businessId) return;
    const onWake = () => {
      if (document.visibilityState === "visible") void fetchOnce();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [businessId, fetchOnce]);

  const stateMatchesBusiness = readyForBusiness === businessId;

  return {
    entitlements: stateMatchesBusiness ? entitlements : FREE_TIER_FALLBACK,
    subscription: stateMatchesBusiness ? subscription : null,
    loading,
    ready: ready && stateMatchesBusiness,
    error,
    refresh,
  };
}
