/**
 * Script-context JSON encoding for structured data (JSON-LD).
 *
 * WHY THIS EXISTS: the homepage renders a `<script type="application/ld+json">`
 * whose description comes from the CMS (`homepage.hero.subtitle`). JSON and
 * HTML have different escaping rules, and `JSON.stringify` does NOT escape `<`
 * — so a value like `</script><script>…</script>` used to close the element
 * early and be parsed as executable HTML. This is an output-encoding problem,
 * not a sanitisation problem: the correct fix is to serialise the same data
 * with the escapes that a script context requires.
 *
 * The replacements below are all legal JSON string escapes, so the payload is
 * decoded back to the identical value by any JSON parser (structured data is
 * preserved exactly), while `<`, `>` and `&` can never appear in the emitted
 * text — a script element therefore cannot be terminated or re-opened:
 *
 *   <  → \u003c     (cannot start a tag or close `</script`)
 *   >  → \u003e
 *   &  → \u0026     (blocks HTML-entity re-decoding tricks)
 *   U+2028 / U+2029 → \u2028 / \u2029  (line separators that are literal
 *                    newlines in a JavaScript string context)
 *
 * Anything else — including `javascript:` strings, quotes, backslashes and
 * HTML-looking payloads — is already inert inside a JSON script block.
 */

const SCRIPT_UNSAFE = /[<>&\u2028\u2029]/g;

const SCRIPT_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * Serialise a value for a `<script>` element. Always returns valid JSON text
 * that is safe to place inside the element regardless of its content.
 */
export function jsonLdScript(value: unknown): string {
  // JSON.stringify is total for our graph (plain objects/strings); `undefined`
  // would yield undefined, so fall back to the JSON null literal.
  const json = JSON.stringify(value) ?? "null";

  return json.replace(SCRIPT_UNSAFE, (char) => SCRIPT_ESCAPES[char]);
}
