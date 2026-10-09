"use client";

/**
 * useSiteOrigin — the address the user is ACTUALLY on right now.
 *
 * Why not a state + effect: `window.location.origin` is external browser state,
 * and copying it into React state from an effect trips
 * `react-hooks/set-state-in-effect` (the project rule) and races any fast
 * async render — the value would land one tick late. `useSyncExternalStore` is
 * React's own answer for exactly this: the server snapshot keeps SSR/hydration
 * consistent, and the client snapshot is read during render, so the first
 * client paint already carries the real origin.
 *
 * A canonical origin is preferred for the SERVER snapshot only when it was
 * explicitly configured; otherwise the server snapshot is empty rather than the
 * dev fallback `http://localhost:3000` — a user-visible share link must never
 * transiently advertise an address the site is not at.
 */

import { useSyncExternalStore } from "react";
import { SITE_URL, SITE_URL_CONFIGURED } from "./siteUrl";

/** The origin never changes during a document's life — nothing to subscribe to. */
const subscribe = () => () => {};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function clientSnapshot(): string {
  return trimTrailingSlashes(window.location.origin);
}

function serverSnapshot(): string {
  return SITE_URL_CONFIGURED ? SITE_URL : "";
}

export function useSiteOrigin(): string {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
