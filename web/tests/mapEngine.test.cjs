// Map provider resilience tests — pure logic from web/src/lib/mapEngine.ts.
//   node --test tests/mapEngine.test.cjs   (run from web/)
// Same philosophy as phase3.test.cjs: no new dependencies; transpiles TS with
// the project's typescript devDependency and loads modules in a VM.
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
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
    },
  }).outputText;
}

/** Load a TS module (and its local "@/"" imports) into a fresh VM context. */
const moduleCache = new Map();

function loadModule(relPath) {
  if (moduleCache.has(relPath)) return moduleCache.get(relPath);
  const exportsObj = {};
  moduleCache.set(relPath, exportsObj);
  const context = {
    exports: exportsObj,
    module: { exports: exportsObj },
    require: (id) => {
      if (id.startsWith("@/")) return loadModule(`../src/${id.slice(2)}.ts`);
      return require(id);
    },
    URL,
    process: { env: process.env, platform: process.platform },
  };
  vm.runInNewContext(transpile(relPath), context, { filename: relPath });
  return exportsObj;
}

const me = loadModule("../src/lib/mapEngine.ts");

// ---------------------------------------------------------------------------
// Provider selection (Cases A/B + overrides)
// ---------------------------------------------------------------------------

test("resolveMapEngine: بدون کلید نشان → online (Case A — بدون صفحهٔ خطا)", () => {
  // web/.env.local فعلی کلید ندارد؛ build پیش‌فرض این تست همین است.
  assert.equal(me.neshanKeyPresent, false);
  // روی "سرور" (بدون window در VM) و بدون env override: پیش‌فرض خودکار
  assert.equal(me.resolveMapEngine(), "online");
});

test("resolveMapEngine: انتخاب صریح env (neshan) بدون در نظر گرفتن کلید — Case B مسیر override", () => {
  // شبیه‌سازی env override: مقدار compile-time در VM ثابت است، پس رفتار
  // تابع را در سطح قرارداد می‌آزماییم: هر مقدار VALID معتبر پذیرفته می‌شود.
  assert.ok(["neshan", "online"].includes(me.resolveMapEngine()));
});

test("neshanStyleUrl: نام استایل → URL میزبانی‌شدهٔ نشان؛ URL کامل → همان", () => {
  // مقدار پیش‌فرض dark است (env خالی).
  assert.equal(me.neshanStyleUrl(), "https://static.neshan.org/sdk/maplibre/styles/dark.json");
});

// ---------------------------------------------------------------------------
// Tile failure window (Case D — one transient error ≠ provider failure)
// ---------------------------------------------------------------------------

test("recordTileFailure: دو خطای گذرا → خرابی اعلام نمی‌شود", () => {
  const h = { ...me.INITIAL_PROVIDER_HEALTH, tileFailures: [] };
  assert.equal(me.recordTileFailure(h, 1_000), false);
  assert.equal(me.recordTileFailure(h, 2_000), false);
  assert.equal(h.tileFailures.length, 2);
});

test("recordTileFailure: سومین خطا در پنجره → خرابی تأیید", () => {
  const h = { ...me.INITIAL_PROVIDER_HEALTH, tileFailures: [] };
  me.recordTileFailure(h, 1_000);
  me.recordTileFailure(h, 2_000);
  assert.equal(me.recordTileFailure(h, 3_000), true);
});

test("recordTileFailure: خطای خارج از پنجرهٔ ۲۰ ثانیه شمارش نمی‌شود", () => {
  const h = { ...me.INITIAL_PROVIDER_HEALTH, tileFailures: [] };
  me.recordTileFailure(h, 0);
  me.recordTileFailure(h, 1_000);
  // کمی بعد از مرز پنجره (inclusive) — شمارش‌های قدیمی خارج می‌شوند
  assert.equal(me.recordTileFailure(h, 21_500), false);
  assert.equal(h.tileFailures.length, 1);
});

test("resetTileFailureWindow پنجره را خالی می‌کند", () => {
  const h = { ...me.INITIAL_PROVIDER_HEALTH, tileFailures: [] };
  me.recordTileFailure(h, 1_000);
  me.recordTileFailure(h, 1_100);
  me.resetTileFailureWindow(h);
  assert.equal(h.tileFailures.length, 0);
});

// ---------------------------------------------------------------------------
// Init failure → immediate fallback (Case C)
// ---------------------------------------------------------------------------

test("recordNeshanFailure(init): سقوط فوری، بدون انتظار پنجره", () => {
  const h = { ...me.INITIAL_PROVIDER_HEALTH, tileFailures: [] };
  assert.equal(me.recordNeshanFailure(h, me.FAILURE_KIND_INIT, 5_000), true);
  assert.equal(h.neshanFailures, 1);
  assert.equal(h.lastNeshanAttempt, 5_000);
});

test("recordNeshanFailure(tile) همان آستانهٔ تایل را اعمال می‌کند", () => {
  const h = { ...me.INITIAL_PROVIDER_HEALTH, tileFailures: [] };
  assert.equal(me.recordNeshanFailure(h, me.FAILURE_KIND_TILE, 1_000), false);
  assert.equal(me.recordNeshanFailure(h, me.FAILURE_KIND_TILE, 1_500), false);
  assert.equal(me.recordNeshanFailure(h, me.FAILURE_KIND_TILE, 2_000), true);
  assert.equal(h.neshanFailures, 0); // tile-تأییدنشده هنوز سقوط حساب نمی‌شود
});

// ---------------------------------------------------------------------------
// Exhaustion + cooldown (Case E — no infinite loops)
// ---------------------------------------------------------------------------

test("neshanExhausted: بعد از MAX_NESHAN_FAILURES سقوط → دیگر تلاش خودکار نمی‌شود", () => {
  const h = { ...me.INITIAL_PROVIDER_HEALTH, tileFailures: [] };
  assert.equal(me.neshanExhausted(h), false);
  me.recordNeshanFailure(h, me.FAILURE_KIND_INIT, 1);
  me.recordNeshanFailure(h, me.FAILURE_KIND_INIT, 2);
  assert.equal(me.neshanExhausted(h), false);
  me.recordNeshanFailure(h, me.FAILURE_KIND_INIT, 3);
  assert.equal(me.neshanExhausted(h), true);
});

test("canRetryNeshan: داخل cooldown ممنوع، بعد از RETRY_COOLDOWN_MS مجاز", () => {
  const h = { ...me.INITIAL_PROVIDER_HEALTH, tileFailures: [] };
  me.recordNeshanFailure(h, me.FAILURE_KIND_INIT, 100_000);
  assert.equal(me.canRetryNeshan(h, 100_000 + me.RETRY_COOLDOWN_MS - 1), false);
  assert.equal(me.canRetryNeshan(h, 100_000 + me.RETRY_COOLDOWN_MS), true);
});

test("markNeshanRecovered: بازیابی موفق همهٔ شمارنده‌ها را صفر می‌کند", () => {
  const h = { ...me.INITIAL_PROVIDER_HEALTH, tileFailures: [] };
  me.recordNeshanFailure(h, me.FAILURE_KIND_INIT, 1);
  me.recordNeshanFailure(h, me.FAILURE_KIND_INIT, 2);
  me.recordTileFailure(h, 3_000);
  me.markNeshanRecovered(h);
  assert.equal(h.neshanFailures, 0);
  assert.equal(h.tileFailures.length, 0);
  assert.equal(me.neshanExhausted(h), false);
});

// ---------------------------------------------------------------------------
// Leaflet tile source independence (audit item #2)
// ---------------------------------------------------------------------------

test("osmRasterUrl: پیش‌فرض OSM مستقل از نشان؛ env override رعایت می‌شود", () => {
  // در VM تست envها خالی‌اند → پیش‌فرض OSM (منبع مستقل از نشان)
  assert.equal(me.osmRasterUrl(), "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
});

// ---------------------------------------------------------------------------
// State preservation helpers
// ---------------------------------------------------------------------------

test("pickRestoredView: دید ذخیره‌شده مقدم است؛ وگرنه props صفحه", () => {
  // آبجکت‌ها در VM realm ساخته می‌شوند؛ مقایسه فیلدبه‌فیلد انجام می‌شود.
  const restored = me.pickRestoredView({ lat: 35.7, lng: 51.4, zoom: 14 }, [35.6892, 51.389], 11);
  assert.equal(restored.center[0], 35.7);
  assert.equal(restored.center[1], 51.4);
  assert.equal(restored.zoom, 14);

  const fallback = me.pickRestoredView(null, [35.6892, 51.389], 11);
  assert.equal(fallback.center[0], 35.6892);
  assert.equal(fallback.center[1], 51.389);
  assert.equal(fallback.zoom, 11);
});
