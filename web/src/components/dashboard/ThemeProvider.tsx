"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type Theme = "dark" | "warm";

const STORAGE_KEY = "incart-theme";

function normalizeStored(value: string | null): Theme {
  // "light" is the legacy key from the first warm-theme iteration.
  return value === "warm" || value === "light" ? "warm" : "dark";
}

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "dark", setTheme: () => {} });

/**
 * Dashboard-scoped theme state. Never touches <html> — the active theme is
 * exposed as `data-theme` so the dashboard root div (`.dashboard-shell`)
 * can carry it; tokens in globals.css resolve per-shell, which keeps the
 * warm/dark switch confined to the dashboard.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // First render is always "dark" so the client output matches the SSR HTML
  // (no hydration mismatch). The persisted choice is restored right after
  // mount — the shell cross-fades to it, so there is no jarring flash.
  const [theme, setThemeState] = useState<Theme>("dark");
  // Guards against stacking transition timers on rapid toggles.
  const moving = useRef(false);

  // Restore the persisted theme once, after hydration.
  useEffect(() => {
    const stored = normalizeStored(window.localStorage.getItem(STORAGE_KEY));
    if (stored !== "dark") setThemeState(stored);
  }, []);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".dashboard-shell");
    if (!shell) return;
    shell.setAttribute("data-theme", theme);

    // Flag the shell so CSS applies a smooth 500ms cross-fade only for
    // this switch (everyday hover states stay snappy).
    if (!moving.current && typeof matchMedia !== "undefined") {
      moving.current = true;
      shell.classList.add("theme-transitioning");
      const timer = window.setTimeout(() => {
        shell.classList.remove("theme-transitioning");
        moving.current = false;
      }, 520);
      return () => {
        window.clearTimeout(timer);
        shell.classList.remove("theme-transitioning");
        moving.current = false;
      };
    }
  }, [theme]);

  // Persist the choice so a reload (or a later visit) restores the last
  // theme. Dashboard-scoped key — never touches the marketing pages.
  const setTheme = useCallback((t: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* Private mode: in-memory theme still works for this session. */
    }
    setThemeState(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
