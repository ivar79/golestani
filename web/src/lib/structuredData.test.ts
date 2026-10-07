import { describe, expect, it } from "vitest";
import { jsonLdScript } from "./structuredData";

/**
 * Regression suite for the homepage JSON-LD script-context injection
 * (audit finding `homepage-jsonld-script-context-injection`).
 *
 * The invariant under test is twofold:
 *   1. the emitted text can never terminate or re-open the <script> element,
 *   2. it is still VALID JSON that decodes back to the exact original value,
 *      so structured data / schema.org output is preserved.
 */

const PAYLOADS: { name: string; value: string }[] = [
  { name: "the audit payload (script-context breakout)", value: "</script><script>fetch('/EXECUTED_JSONLD')</script>" },
  { name: "closing tag with whitespace and case variance", value: "</SCRIPT >" },
  { name: "HTML element payload", value: "<img src=x onerror=alert(1)>" },
  { name: "javascript: URL", value: "javascript:alert(1)" },
  { name: "attribute-breaking quotes", value: `" onmouseover="alert(1)` },
  { name: "single quotes", value: "it's a 'test'" },
  { name: "backslashes", value: "C:\\temp\\..\\secret and \\u003c" },
  { name: "unicode line separators", value: "line\u2028separator\u2029end" },
  { name: "unicode text", value: "اینکارت 👨‍👩‍👧 بانک مشاغل" },
  { name: "HTML comment / CDATA tails", value: "<!-- comment --> ]]> <![CDATA[" },
  { name: "entity re-decoding attempt", value: "&lt;script&gt;&amp;#60;" },
];

describe("jsonLdScript", () => {
  it.each(PAYLOADS)("emits nothing that can break out of the script element: $name", ({ value }) => {
    const out = jsonLdScript({ description: value });

    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    // The exact string a browser would use to end the element.
    expect(out.toLowerCase()).not.toContain("</script");
    expect(out.toLowerCase()).not.toContain("<script");
  });

  it.each(PAYLOADS)("stays valid JSON and preserves the value verbatim: $name", ({ value }) => {
    const graph = {
      "@context": "https://schema.org",
      "@graph": [{ "@type": "WebSite", name: "اینکارت", description: value }],
    };

    const serialised = jsonLdScript(graph);

    // A browser/JSON parser decodes the escapes back to the identical payload.
    expect(JSON.parse(serialised)).toEqual(graph);
    expect(JSON.parse(serialised)["@graph"][0].description).toBe(value);
  });

  it("escapes the exact audit payload into inert escapes", () => {
    const payload = "</script><script>fetch('/EXECUTED_JSONLD')</script>";
    const out = jsonLdScript({ description: payload });

    expect(out).toContain("\\u003c/script\\u003e");
    expect(out).toContain("\\u003cscript\\u003e");
    expect(JSON.parse(out).description).toBe(payload);
  });

  it("keeps a benign schema.org graph byte-identical to JSON.stringify", () => {
    const benign = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          "@id": "https://example.test/#website",
          url: "https://example.test",
          name: "اینکارت",
          description: "بانک مشاغل و کارت ویزیت‌های دیجیتال ایران",
          inLanguage: "fa-IR",
          publisher: { "@id": "https://example.test/#organization" },
        },
        { "@type": "Organization", "@id": "https://example.test/#organization", name: "اینکارت" },
      ],
    };

    // No <, > or & in benign copy → the serialiser must not alter it at all.
    expect(jsonLdScript(benign)).toBe(JSON.stringify(benign));
  });

  it("preserves non-string JSON types untouched", () => {
    const graph = { count: 3, promoted: true, ratio: 1.5, nested: null, list: ["a", 2] };

    expect(JSON.parse(jsonLdScript(graph))).toEqual(graph);
    expect(jsonLdScript(graph)).toBe(JSON.stringify(graph));
  });

  it("never throws on undefined and returns the JSON null literal", () => {
    expect(jsonLdScript(undefined)).toBe("null");
  });
});
