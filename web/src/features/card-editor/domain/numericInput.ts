/**
 * Numeric field input with Figma-style expressions.
 *
 * A designer types `+10`, `*2`, `50%` or `1/3` into a width field — never a
 * hand-written expression string. So this is a TINY, TOTAL parser over a fixed
 * grammar, NOT `eval` and not a general parser:
 *
 *   <expr>  := <term> (('+' | '-') <term>)*
 *   <term>  := <factor> (('*' | '/') <factor>)*
 *   <factor>:= <number> ['%'] | '(' <expr> ')'
 *
 * Semantics:
 *   - `12.5`      → absolute 12.5
 *   - `+10`       → current + 10 (relative convenience, Figma's behaviour)
 *   - `-10`       → current - 10
 *   - `*2`        → current * 2
 *   - `/4`        → current / 4
 *   - `50%`       → current * 0.5
 *   - `100`       → absolute 100 (NOT relative: a bare number replaces)
 *
 * Anything outside the grammar is REJECTED (`ok: false`) without evaluating a
 * single character — `alert(1)`, `__proto__`, `[].map`, backticks and unicode
 * lookalikes all fail the tokenizer.
 *
 * Pure: no DOM, no React, no eval.
 */

export type NumericParse = {
  ok: boolean;
  value: number;
  /** The expression was relative to the current value (`+`, `-`, `*`, `/`, `%`). */
  relative: boolean;
};

export type NumericFieldOptions = {
  min?: number;
  max?: number;
  /** Digits kept in the result (defaults to 6 — the editor's precision). */
  decimals?: number;
};

const TOKEN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, Math.max(0, Math.min(9, decimals)));
  return Math.round(value * factor) / factor;
}

/**
 * Thousands separators: "1,250" and "1،250" are one number, not two. Only a
 * separator between complete 3-digit groups counts (so "1,25" and "12,34" stay
 * rejected typos), and it is removed before tokenizing — never interpreted.
 */
function stripThousandsSeparators(text: string): string {
  return text.replace(/[,،](?=\d{3}(?!\d))/g, "");
}

function clamp(value: number, min?: number, max?: number): number {
  let result = value;
  if (typeof min === "number") result = Math.max(min, result);
  if (typeof max === "number") result = Math.min(max, result);
  return result;
}

/** Tokenize into numbers, operators and parens. Returns null on anything else. */
function tokenize(input: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if ("+-*/()%".includes(ch)) {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let number = "";
      while (i < input.length && /[0-9.]/.test(input[i])) {
        number += input[i];
        i += 1;
      }
      if (!TOKEN.test(number)) return null;
      tokens.push(number);
      continue;
    }
    return null; // letters, symbols, backticks, anything unexpected
  }
  return tokens.length > 0 ? tokens : null;
}

type Cursor = { tokens: string[]; at: number; base: number };

/** <expr> := <term> (('+' | '-') <term>)* */
function parseExpr(cursor: Cursor): number | null {
  const first = parseTerm(cursor);
  if (first === null) return null;
  let value = first.value;
  while (cursor.at < cursor.tokens.length) {
    const op = cursor.tokens[cursor.at];
    if (op !== "+" && op !== "-") break;
    cursor.at += 1;
    const next = parseTerm(cursor);
    if (next === null) return null;
    value = op === "+" ? value + next.value : value - next.value;
  }
  return value;
}

/** <term> := <factor> (('*' | '/') <factor>)* */
function parseTerm(cursor: Cursor): { value: number } | null {
  const first = parseFactor(cursor);
  if (first === null) return null;
  let value = first.value;
  while (cursor.at < cursor.tokens.length) {
    const op = cursor.tokens[cursor.at];
    if (op !== "*" && op !== "/") break;
    cursor.at += 1;
    const next = parseFactor(cursor);
    if (next === null) return null;
    if (op === "/" && next.value === 0) return null; // never produce Infinity
    value = op === "*" ? value * next.value : value / next.value;
  }
  return { value };
}

/** <factor> := <number> ['%'] | '(' <expr> ')' */
function parseFactor(cursor: Cursor): { value: number } | null {
  const token = cursor.tokens[cursor.at];
  if (token === undefined) return null;

  if (token === "(") {
    cursor.at += 1;
    const inner = parseExpr(cursor);
    if (inner === null) return null;
    if (cursor.tokens[cursor.at] !== ")") return null;
    cursor.at += 1;
    return { value: inner };
  }

  if (!TOKEN.test(token)) return null;
  cursor.at += 1;
  const percent = cursor.tokens[cursor.at] === "%";
  if (percent) cursor.at += 1;
  const numeric = Number(token);
  if (!Number.isFinite(numeric)) return null;
  // A percentage is relative to the CURRENT value (50% of 300 → 150).
  return { value: percent ? (cursor.base * numeric) / 100 : numeric };
}

/**
 * Parse a field entry against the field's current value.
 *
 * `ok: false` means "keep what you had" — the caller must NOT write anything.
 *
 * `relative` in the result reports whether the entry depended on the current
 * value (so a UI can show `+10 → 310` instead of pretending it was absolute).
 */
export function parseNumericInput(
  raw: string,
  current: number,
  options: NumericFieldOptions = {},
): NumericParse {
  const base = Number.isFinite(current) ? current : 0;
  const text = stripThousandsSeparators(String(raw ?? "").trim());
  if (text === "") return { ok: false, value: base, relative: false };

  const tokens = tokenize(text);
  if (!tokens) return { ok: false, value: base, relative: false };

  const head = tokens[0];
  // RELATIVE SHORTHAND, resolved by rewriting the token stream (never eval):
  //   `*2`  → base*2      `+10` → base+10      `50%` → base*50/100
  let stream = tokens;
  const relative = head === "+" || head === "-" || head === "*" || head === "/";
  if (relative) {
    stream = [String(base), ...tokens];
  } else if (tokens.length >= 2 && TOKEN.test(head) && tokens[1] === "%") {
    const percent = (base * Number(head)) / 100;
    if (!Number.isFinite(percent)) return { ok: false, value: base, relative: true };
    stream = [String(percent), ...tokens.slice(2)];
    if (stream.length === 1) {
      const rounded = round(percent, options.decimals ?? 6);
      return { ok: true, value: clamp(rounded, options.min, options.max), relative: true };
    }
  }

  const cursor: Cursor = { tokens: stream, at: 0, base };
  const parsed = (() => {
    const value = parseExpr(cursor);
    return value === null || cursor.at !== cursor.tokens.length ? null : value;
  })();

  if (parsed === null) return { ok: false, value: base, relative };

  const rounded = round(parsed, options.decimals ?? 6);
  if (!Number.isFinite(rounded)) return { ok: false, value: base, relative };
  return { ok: true, value: clamp(rounded, options.min, options.max), relative };
}

/** True when the entry is an absolute number (used to decide step display). */
export function isRelativeExpression(raw: string): boolean {
  const tokens = tokenize(String(raw ?? "").trim());
  if (!tokens) return false;
  return tokens[0] === "+" || tokens[0] === "-" || tokens[0] === "*" || tokens[0] === "/" || tokens.includes("%");
}
