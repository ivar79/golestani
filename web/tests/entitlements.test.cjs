// Run from web/: node --test tests/entitlements.test.cjs
// Entitlement contract: catalog-driven rendering, limit helpers, no hardcoded
// prices/plan names in the UI, editor lock contract, and snapshot awareness.
// Uses the project's existing TypeScript devDependency (no extra packages).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

/** Transpile a TS module and run it in a sandbox with `@/` imports stubbed. */
function loadModule(modulePath, stubs = {}) {
  let source = read(modulePath);
  source = source.replace(/import[\s\S]*?from\s+"@\/[^"]+";/g, (match) => {
    const m = /import\s+(?:type\s+)?\{([^}]+)\}/.exec(match);
    if (!m) return "";
    const names = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "")).filter(Boolean);
    const provided = Object.keys(stubs);
    const missing = names.filter((n) => !provided.includes(n));
    if (missing.length) return "";
    return `const { ${names.join(", ")} } = stubs;`;
  });
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const sandbox = { stubs, exports: {}, module: { exports: {} }, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(js, sandbox);
  return sandbox.exports;
}

/* ------------------------------------------------------------------ */
/* lib/entitlements.ts — helper behavior                               */
/* ------------------------------------------------------------------ */

const entitlements = loadModule("src/lib/entitlements.ts");

const FREE_CAPS = entitlements.FREE_TIER_FALLBACK.capabilities;

test("free tier fallback mirrors the backend free tier contract", () => {
  assert.equal(FREE_CAPS.card_editor, true);
  assert.deepEqual([...FREE_CAPS.card_templates], ["classic", "local"]);
  assert.equal(FREE_CAPS.print_file, false);
  assert.equal(FREE_CAPS.max_cards, 1);
  assert.equal(FREE_CAPS.showcase, false);
});

test("isAllowedValue checks list membership", () => {
  assert.equal(entitlements.isAllowedValue(FREE_CAPS, "card_templates", "classic"), true);
  assert.equal(entitlements.isAllowedValue(FREE_CAPS, "card_templates", "midnight"), false);
});

test("limitOf: positive number, zero, and unlimited (null)", () => {
  assert.equal(entitlements.limitOf(FREE_CAPS, "max_cards"), 1);
  assert.equal(entitlements.limitOf(FREE_CAPS, "max_showcases"), 0);
  assert.equal(entitlements.limitOf({ max_cards: null }, "max_cards"), null);
  assert.equal(entitlements.limitOf({ max_cards: undefined }, "max_cards"), null);
});

test("isLimitReached honors quota and unlimited", () => {
  assert.equal(entitlements.isLimitReached(FREE_CAPS, "max_cards", 1), true);
  assert.equal(entitlements.isLimitReached(FREE_CAPS, "max_cards", 0), false);
  assert.equal(entitlements.isLimitReached({ max_cards: null }, "max_cards", 99), false);
});

test("planFeatureLines renders from server labels — no hardcoded feature names", () => {
  const labels = {
    showcase: { label: "ویترین محصولات و خدمات", type: "bool", group: "بازاریابی" },
    max_cards: { label: "حداکثر کارت ویزیت", type: "int", group: "محدودیت‌ها" },
    card_templates: { label: "قالب‌های کارت", type: "list", group: "کارت ویزیت" },
  };
  const lines = entitlements.planFeatureLines(
    { showcase: true, max_cards: 10, card_templates: ["classic"] },
    labels,
  );
  assert.equal(
    lines.map((l) => String(l.state)).join(","),
    "on,value,value",
  );
  assert.ok(lines.every((l) => Object.values(labels).some((meta) => meta.label === l.label)));
});

test("extractEntitlementErrors pulls machine-readable 403 bodies", () => {
  const error = { response: { status: 403, data: { message: "x", entitlement_errors: { template: "locked" } } } };
  assert.deepEqual(entitlements.extractEntitlementErrors(error), { template: "locked" });
  assert.equal(entitlements.extractEntitlementErrors({ response: { data: { message: "no" } } }), null);
  assert.equal(entitlements.extractEntitlementErrors(new Error("network")), null);
});

/* ------------------------------------------------------------------ */
/* Hardcode bans — the contract is server-driven, never baked into UI  */
/* ------------------------------------------------------------------ */

const pricingSource = read("src/components/ui/pricing-section.tsx");

test("pricing section renders feature lines from the server catalog, not hardcoded checks", () => {
  assert.ok(pricingSource.includes("planFeatureLines"), "pricing must use planFeatureLines(labels)");
  assert.ok(!pricingSource.includes("plan.features?.showcase"), "hardcoded features?.showcase check must be gone");
  assert.ok(!pricingSource.includes("plan.features?.ads"), "hardcoded features?.ads check must be gone");
});

test("pricing section takes plans from GET /plans payload", () => {
  assert.ok(pricingSource.includes("getPlansPricing"), "must load the enriched pricing payload");
  assert.ok(pricingSource.includes("free_tier"), "must render the free tier from the server");
});

test("pricing card price comes from API data, not a constant", () => {
  assert.ok(/toman\(plan\.price\)/.test(pricingSource), "price must render plan.price from the API");
  assert.ok(!/price\s*=\s*5000000/.test(pricingSource), "no literal plan price in the UI");
});

test("no plan-name conditionals anywhere in the web app", () => {
  const appFiles = ["src/components/ui/pricing-section.tsx", "src/app/card-maker/page.tsx", "src/components/cards/FeatureGate.tsx", "src/lib/entitlements.ts"];
  for (const file of appFiles) {
    const src = read(file);
    assert.ok(!/plan\s*===\s*["'](gold|premium|professional|business)["']/.test(src), `${file} branches on a plan name`);
    assert.ok(!/is_premium|isPaid|is_paid/.test(src), `${file} uses a boolean premium flag`);
  }
});

/* ------------------------------------------------------------------ */
/* FeatureGate.tsx — the UX mirror, never a security boundary          */
/* ------------------------------------------------------------------ */

const gateSource = read("src/components/cards/FeatureGate.tsx");

test("EntitlementGate exposes provider, hooks, and locked-UI atoms", () => {
  for (const symbol of ["EntitlementProvider", "useEntitlements", "useCapabilities", "useCardEntitlements", "PremiumBadge", "LockedOverlay", "UsageMeter"]) {
    assert.ok(gateSource.includes(`export function ${symbol}`) || gateSource.includes(`export type { ${symbol}`) || new RegExp(`export (function|const) ${symbol}`).test(gateSource), `missing export: ${symbol}`);
  }
});

test("gate documents that it is UX-only", () => {
  assert.ok(/NEVER decides security|not a security boundary|security authority/.test(gateSource), "the UX-only contract must be documented in the component");
});

test("locked overlay explains unavailability and links to pricing", () => {
  assert.ok(gateSource.includes('href="/pricing"'), "locked UI must offer the upgrade path");
  assert.ok(gateSource.includes("aria-label"), "locked UI must be accessible");
});

/* ------------------------------------------------------------------ */
/* card-maker — consumes the contract and handles stale 403s           */
/* ------------------------------------------------------------------ */

const makerSource = read("src/app/card-maker/page.tsx");

test("card-maker locks templates from the entitlement contract", () => {
  assert.ok(makerSource.includes("isAllowedValue(entitlements.capabilities, \"card_templates\""), "template tiles must consult the contract");
  assert.ok(makerSource.includes("LockedOverlay"), "locked templates must render the overlay");
});

test("card-maker locks exports and the print-file panel", () => {
  assert.ok(makerSource.includes('isAllowedValue(entitlements.capabilities, "card_exports"'), "export buttons must consult the contract");
  assert.ok(makerSource.includes("entitlements.capabilities.print_file"), "print-file panel must consult the contract");
});

test("card-maker keeps grandfathered (saved) values visible and re-savable", () => {
  assert.ok(makerSource.includes("grandfathered"), "grandfathering must be represented in the UI");
});

test("card-maker syncs the contract after a server 403 (stale-cap safety)", () => {
  assert.ok(makerSource.includes("extractEntitlementErrors"), "must parse machine-readable 403 bodies");
  assert.ok(makerSource.includes("staleError"), "stale-cap banner state must exist");
});

test("card-maker wraps the editor in the EntitlementProvider", () => {
  assert.ok(makerSource.includes("<EntitlementProvider value={entitlements}>"), "editor must be inside the provider");
});

/* ------------------------------------------------------------------ */
/* Admin — catalog-driven plan editor                                  */
/* ------------------------------------------------------------------ */

const adminSource = read("src/components/admin/AdminPlansTab.tsx");

test("admin plan editor renders entitlement fields from the server catalog", () => {
  assert.ok(adminSource.includes("getEntitlementCatalog"), "must load GET /admin/entitlements/catalog");
  assert.ok(adminSource.includes("FeatureField"), "catalog-driven field component must exist");
  assert.ok(!/features:\s*\{\s*showcase:\s*true,\s*ads:\s*true\s*\}/.test(adminSource), "hardcoded {showcase:true,ads:true} on create must be gone");
});

test("admin editor surfaces snapshot semantics to the operator", () => {
  assert.ok(adminSource.includes("snapshot"), "the editor must warn that active subscriptions keep their snapshot");
});

test("admin lib exposes the catalog types", () => {
  const lib = read("src/lib/admin.ts");
  assert.ok(lib.includes("EntitlementCatalogEntry"), "catalog entry type missing");
  assert.ok(lib.includes("getEntitlementCatalog"), "catalog fetcher missing");
});
