"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "./ThemeProvider";

const OPTIONS: { value: Theme; label: string; icon: typeof Moon }[] = [
  { value: "dark", label: "حالت تیره", icon: Moon },
  { value: "warm", label: "حالت گرم", icon: Sun },
];

/**
 * Segmented theme switch — icon-only with tooltips (per the design reference).
 *
 * Geometry: fixed bounding box with overflow-hidden on the track; the thumb
 * is a half-width absolute pane inside [3px] insets, so it can never clip or
 * overflow the track. RTL-safe via logical properties; a keyboard-operable
 * radiogroup. Both segments are icon-only (moon / sun) with descriptive
 * aria-labels and tooltips; `compact` just tightens the paddings for the
 * collapsed sidebar.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  const select = (next: Theme) => {
    setTheme(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === " ") {
      e.preventDefault();
      select(theme === "dark" ? "warm" : "dark");
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="حالت نمایش"
      onKeyDown={onKeyDown}
      className={`relative inline-flex h-9 shrink-0 items-center overflow-hidden rounded-full border transition-colors ${
        theme === "dark"
          ? "border-ik-border bg-ik-panel-soft"
          : "border-[#d8ccbd] bg-[#ede4d7]"
      } ${compact ? "w-[64px]" : "w-[72px]"}`}
    >
      {/* Sliding thumb — half the inner width, always fully inside the track */}
      <span
        aria-hidden
        className={`absolute h-[calc(100%-6px)] w-[calc(50%-3px)] rounded-full transition-[inset-inline-start] duration-500 ease-out motion-reduce:transition-none ${
          theme === "dark" ? "start-[3px] bg-ik-wash-hover" : "start-[calc(50%)] bg-[#fbf8f2] shadow-sm"
        } ${compact ? "hidden" : ""}`}
      />
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            tabIndex={active ? 0 : -1}
            onClick={() => select(opt.value)}
            title={opt.label}
            className={`relative z-10 flex h-full flex-1 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ik-accent ${
              theme === "dark"
                ? active
                  ? "text-ik-text"
                  : "text-ik-muted hover:text-ik-text"
                : active
                  ? "text-[#2a211b]"
                  : "text-[#6f6256] hover:text-[#2a211b]"
            }`}
          >
            {/* Moon → cyan in dark theme, Sun → terracotta in warm theme */}
            <Icon
              size={compact ? 13 : 15}
              aria-hidden
              className={
                opt.value === "dark"
                  ? theme === "dark" && active
                    ? "text-cyan-300"
                    : ""
                  : theme === "warm" && active
                    ? "text-[#a85f3f]"
                    : ""
              }
            />
          </button>
        );
      })}
    </div>
  );
}
