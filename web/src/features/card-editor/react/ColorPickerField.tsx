"use client";

import { useState } from "react";
import { HexAlphaColorPicker } from "react-colorful";
import {
  parseColor,
  formatHex,
  formatRgb,
  formatHsl,
  formatHsv,
  parseColorText,
  ColorFormat,
} from "../domain/color";

export function ColorPickerField({
  value,
  onChange,
  onGestureEnd,
}: {
  value: string | null;
  onChange: (color: string) => void;
  onGestureEnd: () => void;
}) {
  const [format, setFormat] = useState<ColorFormat>("hex");
  // The text field is a LOCAL edit buffer: it only re-syncs to the committed
  // value when the value or the format actually changes. Tracking the synced
  // pair as state (not a ref, not an effect) keeps in-progress typing intact
  // without a setState-in-effect render cascade.
  const [synced, setSynced] = useState<{ value: string | null; format: ColorFormat }>({
    value: null,
    format: "hex",
  });
  const [textValue, setTextValue] = useState("");

  const parsed = parseColor(value) || { r: 0, g: 0, b: 0, a: 1 };
  const hex8 = formatHex(parsed);

  if (synced.value !== value || synced.format !== format) {
    setSynced({ value, format });
    if (format === "hex") setTextValue(formatHex(parsed));
    else if (format === "rgb") setTextValue(formatRgb(parsed));
    else if (format === "hsl") setTextValue(formatHsl(parsed));
    else if (format === "hsv") setTextValue(formatHsv(parsed));
  }

  const handleTextCommit = () => {
    const newParsed = parseColorText(textValue, format);
    if (newParsed) {
      onChange(formatHex(newParsed));
      onGestureEnd();
    } else {
      // Revert to the committed value on an unparseable edit.
      if (format === "hex") setTextValue(formatHex(parsed));
      else if (format === "rgb") setTextValue(formatRgb(parsed));
      else if (format === "hsl") setTextValue(formatHsl(parsed));
      else if (format === "hsv") setTextValue(formatHsv(parsed));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
      {/* react-colorful HexAlphaPicker */}
      <div
        onPointerUp={onGestureEnd}
        // Also catch mouse leave during drag just in case
        onPointerLeave={(e) => {
          if (e.buttons > 0) onGestureEnd();
        }}
        className="[&_.react-colorful]:w-full [&_.react-colorful]:h-40 [&_.react-colorful\_\_pointer]:w-4 [&_.react-colorful\_\_pointer]:h-4"
      >
        <HexAlphaColorPicker
          color={hex8}
          onChange={(newHex8) => {
            const c = parseColor(newHex8);
            if (c) onChange(formatHex(c));
          }}
        />
      </div>

      {/* Format Tabs */}
      <div className="flex gap-1 rounded-lg bg-black/20 p-1">
        {(["hex", "rgb", "hsl", "hsv"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFormat(f)}
            className={`flex-1 rounded-md py-1 text-[10px] font-bold uppercase transition ${
              format === f ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Text Input */}
      <div className="flex items-center gap-2">
        <div
          className="h-8 w-8 shrink-0 rounded-lg border border-white/10"
          style={{ background: hex8 }}
        />
        <input
          type="text"
          dir="ltr"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={handleTextCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleTextCommit();
          }}
          className="flex-1 rounded-lg border border-white/15 bg-black/20 p-2 text-xs font-mono text-white outline-none focus:border-cyan-400 text-left"
          placeholder={format}
        />
      </div>
    </div>
  );
}
