// Phase 3 frontend pure-logic tests — same philosophy as phase2-safety.test.cjs:
// node --test tests/phase3.test.cjs   (run from web/)
// No new dependencies: transpiles TS sources with the project's typescript devDependency.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function transpile(relPath) {
  const source = fs.readFileSync(path.join(__dirname, relPath), "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      // license.ts imports businessSafety.ts — resolve relative imports too.
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
    },
  }).outputText;
}

/** Load a TS module (and its local "@/" imports) into a fresh VM context. */
const moduleCache = new Map();

function loadModule(relPath) {
  if (moduleCache.has(relPath)) return moduleCache.get(relPath);
  const exportsObj = {};
  moduleCache.set(relPath, exportsObj); // set before requiring (cycle-safe)
  const context = {
    exports: exportsObj,
    module: { exports: exportsObj },
    require: (id) => {
      if (id.startsWith("@/")) {
        // "@/lib/businessSafety" → "../src/lib/businessSafety.ts"
        return loadModule(`../src/${id.slice(2)}.ts`);
      }
      return require(id);
    },
    URL,
  };
  vm.runInNewContext(transpile(relPath), context, { filename: relPath });
  return exportsObj;
}

// ---------------------------------------------------------------------------
// formatDistance — the approved human distance format
// ---------------------------------------------------------------------------
const { formatDistance } = loadModule("../src/lib/format.ts");

test("formatDistance: زیر ۱ کیلومتر → متر", () => {
  assert.equal(formatDistance(850), "۸۵۰ متر");
});

test("formatDistance: زیر ۱ کیلومتر → گرد شدن به متر", () => {
  assert.equal(formatDistance(999.6), "۱٬۰۰۰ متر");
});

test("formatDistance: مرز ۱ کیلومتر → کیلومتر اعشاری", () => {
  assert.equal(formatDistance(1000.4), "۱ کیلومتر");
});

test("formatDistance: بالای ۱ کیلومتر → یک رقم اعشار", () => {
  // toLocaleString("fa-IR") renders the Arabic decimal separator ٫ (U+066B).
  assert.equal(formatDistance(2400), "۲٫۴ کیلومتر");
});

test("formatDistance: فاصله طولانی", () => {
  assert.equal(formatDistance(12500), "۱۲٫۵ کیلومتر");
});

// ---------------------------------------------------------------------------
// buildLicenseTrackUrl — the approved qr.mojavez.ir badge deep link
// ---------------------------------------------------------------------------
const { buildLicenseTrackUrl } = loadModule("../src/lib/license.ts");

test("license URL: مسیر استاندارد با کد ساده", () => {
  assert.equal(
    buildLicenseTrackUrl("IR-123456"),
    "https://qr.mojavez.ir/track/IR-123456"
  );
});

test("license URL: کد با نویسه‌های خاص percent-encode می‌شود", () => {
  assert.equal(
    buildLicenseTrackUrl("IR 12/34"),
    "https://qr.mojavez.ir/track/IR%2012%2F34"
  );
});

test("license URL: کد فارسی encode می‌شود", () => {
  assert.equal(
    buildLicenseTrackUrl("۱۲۳۴۵"),
    "https://qr.mojavez.ir/track/%DB%B1%DB%B2%DB%B3%DB%B4%DB%B5"
  );
});

test("license URL: whitespace حاشیه‌ای حذف می‌شود", () => {
  assert.equal(
    buildLicenseTrackUrl("  IR-777  "),
    "https://qr.mojavez.ir/track/IR-777"
  );
});

for (const bad of [null, undefined, "", "   "]) {
  test(`license URL: ورودی نامعتبر → null (${JSON.stringify(bad)})`, () => {
    assert.equal(buildLicenseTrackUrl(bad), null);
  });
}

test("license URL: کد با کنترل‌نویسه/بک‌اسلش رد می‌شود (safeHttpUrl)", () => {
  assert.equal(buildLicenseTrackUrl("IR\t123"), null);
  assert.equal(buildLicenseTrackUrl("IR\\123"), null);
});

test("license URL: با URL یکپارچه‌سازی شده و امن است", () => {
  const url = buildLicenseTrackUrl("IR-1");
  assert.match(url, /^https:\/\/qr\.mojavez\.ir\/track\//);
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
});

// ---------------------------------------------------------------------------
// Map provider resilience — contract tests (XSS source scan + engine files)
// Cross-file invariants of the resilient provider layer (mapEngine.ts):
//   - no business-controlled value is interpolated into innerHTML anywhere
//     in the map components (the DOM-safe builder is the only popup path)
//   - both engines share the same normalized MapMarker type (state preserved
//     across provider switches — no data refetch on fallback)
// ---------------------------------------------------------------------------
const mapNeshanSource = fs.readFileSync(
  path.join(__dirname, "../src/components/map/MapNeshan.tsx"),
  "utf8"
);
const leafletSource = fs.readFileSync(
  path.join(__dirname, "../src/components/map/MapViewLeaflet.tsx"),
  "utf8"
);

for (const bad of ["item.title", "item.category", "item.subtitle"]) {
  test(`XSS guard: innerHTML با دادهٔ کسب‌وکار (${bad}) در MapNeshan ممنوع`, () => {
    // The DOM-safe builder must be used; no `${item.title}`-style interpolation
    // may reach innerHTML strings in the Neshan engine.
    const innerHTMLCalls = mapNeshanSource.match(/\.innerHTML\s*=/g) ?? [];
    assert.equal(
      innerHTMLCalls.length,
      0,
      "MapNeshan must not assign innerHTML (use buildPopupDom/DOM APIs)"
    );
    assert.ok(
      mapNeshanSource.includes("buildPopupDom"),
      "MapNeshan must render popups via the DOM-safe builder"
    );
  });
}

test("fallback contract: هر دو موتور MapViewProps مشترک دارند (حفظ وضعیت)", () => {
  // Both engines consume the same shared props type so a provider switch
  // passes identical markers/center/zoom — no refetch, no state loss.
  assert.ok(leafletSource.includes("export type MapViewProps"));
  assert.ok(
    mapNeshanSource.includes('import type { MapMarker, MapViewProps } from "./MapView"'),
  );
});

test("fallback contract: منبع تایل Leaflet از mapEngine می‌آید (قابل تعویض با env)", () => {
  assert.ok(leafletSource.includes("osmRasterUrl"));
  const mapEngineSource = fs.readFileSync(
    path.join(__dirname, "../src/lib/mapEngine.ts"),
    "utf8"
  );
  // Independent default + env override present.
  assert.ok(mapEngineSource.includes("NEXT_PUBLIC_LEAFLET_TILE_URL"));
  assert.ok(mapEngineSource.includes("tile.openstreetmap.org"));
});

test("fallback contract: MapView دیسپچر هر دو موتور را با همان props می‌سازد", () => {
  const dispatcher = fs.readFileSync(
    path.join(__dirname, "../src/components/map/MapView.tsx"),
    "utf8"
  );
  assert.ok(dispatcher.includes("MapViewLazy {...props}"));
  assert.ok(dispatcher.includes("MapNeshanLazy {...props}"));
  assert.ok(dispatcher.includes("onEngineFailed"));
});
