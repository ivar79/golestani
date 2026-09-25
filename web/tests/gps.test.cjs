// GPS acquisition tests — the laptop used for this project has no GPS receiver,
// so the browser Geolocation API is mocked throughout. This proves the app
// handles a *browser-provided* geolocation result correctly; it does NOT depend
// on physical hardware.
//
//   node --test tests/gps.test.cjs   (run from web/)
//
// Example fixture (Amsterdam): 52.3676, 4.9041 — accuracies 20m (good),
// 50m (acceptable), 500m+ (poor). These are test fixtures, not product claims.
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
      esModuleInterop: true,
    },
  }).outputText;
}

// gps.ts is a pure module (no React, no DOM) — it only needs timers, which the
// vm context does not provide by default (setTimeout is a Web/Node API, not a
// V8 built-in). Node's real timers let us await the async acquisition.
function loadGps() {
  const exportsObj = {};
  const context = {
    exports: exportsObj,
    module: { exports: exportsObj },
    require,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(transpile("../src/lib/gps.ts"), context, {
    filename: "gps.ts",
  });
  return exportsObj;
}

const {
  acquireBestFix,
  GpsError,
  ERR_PERMISSION_DENIED,
  ERR_POSITION_UNAVAILABLE,
  ERR_TIMEOUT,
} = loadGps();

const AMS = { latitude: 52.3676, longitude: 4.9041 };

/**
 * A fake `navigator.geolocation`. Positions/errors are queued and delivered
 * asynchronously (like a real browser — it never calls back synchronously).
 *
 * `positions[i]` / `errors[i]` are aligned per slot: slot i first delivers
 * positions[i] (if any), then errors[i] (if any). A permission denial or
 * service-unavailable normally carries NO position, so those tests pass an
 * errors-only queue — exactly what a real browser does.
 */
function fakeGeolocation({ positions = [], errors = [] } = {}) {
  const calls = {
    watchCount: 0,
    cleared: [],
    lastOptions: null,
  };
  let idSeq = 1;
  const api = {
    watchPosition(success, onError, options) {
      const id = idSeq++;
      calls.watchCount += 1;
      calls.lastOptions = options;
      const total = Math.max(positions.length, errors.length);
      let slot = 0;
      const deliverNext = () => {
        if (slot >= total) return;
        const i = slot++;
        if (i < positions.length && positions[i] !== null) {
          const p = positions[i];
          success({
            coords: {
              latitude: p.latitude,
              longitude: p.longitude,
              accuracy: p.accuracy,
            },
          });
        }
        if (i < errors.length && errors[i] !== null) {
          onError({ code: errors[i], message: "fake" });
        }
        if (slot < total) {
          setTimeout(deliverNext, 0);
        }
      };
      setTimeout(deliverNext, 0);
      return id;
    },
    clearWatch(id) {
      calls.cleared.push(id);
    },
  };
  return { api, calls };
}

// ---------------------------------------------------------------------------
// 1. GPS success — a good fix resolves with the browser-provided coordinates
// ---------------------------------------------------------------------------
test("GPS success: fix خوب با مختصات مرورگر برمی‌گردد", async () => {
  const { api, calls } = fakeGeolocation({
    positions: [{ ...AMS, accuracy: 20 }],
  });

  const fix = await acquireBestFix(api, { goodAccuracyM: 50 });

  assert.equal(fix.latitude, AMS.latitude);
  assert.equal(fix.longitude, AMS.longitude);
  assert.equal(fix.accuracy, 20);
  // A precise fix short-circuits: only one fix was needed.
  assert.equal(calls.watchCount, 1);
  // The watch is always cleaned up on resolve.
  assert.equal(calls.cleared.length, 1);
});

test("GPS success: تقدم دقت — best fix با کمترین متر نگه داشته می‌شود", async () => {
  // Device first reports a poor network fix, then a precise GPS fix. The poor
  // one must NOT be accepted as final; the better fix wins.
  const { api } = fakeGeolocation({
    positions: [
      { ...AMS, accuracy: 500 },
      { ...AMS, accuracy: 20 },
    ],
  });

  const fix = await acquireBestFix(api, { goodAccuracyM: 50 });

  assert.equal(fix.accuracy, 20, "must keep the most accurate fix seen");
});

// ---------------------------------------------------------------------------
// 5. Best-fix when nothing is "good enough" — budget expires with the best one
// ---------------------------------------------------------------------------
test("best-fix: هیچ fixی خوب نیست → با بهترین fix زمان تمام می‌شود", async () => {
  const { api, calls } = fakeGeolocation({
    positions: [
      { ...AMS, accuracy: 500 },
      { ...AMS, accuracy: 200 },
    ],
  });

  // Threshold no fix can meet, tiny budget so the test stays fast.
  const fix = await acquireBestFix(api, { goodAccuracyM: 10, timeoutMs: 60 });

  assert.equal(fix.accuracy, 200, "resolves with the best (lowest-metre) fix");
  assert.equal(calls.cleared.length, 1, "watch cleared when the budget expires");
});

test("best-fix: اولین fix ضعیف پذیرفته نمی‌شود اگر دنبال بهتر هستیم", async () => {
  const { api } = fakeGeolocation({
    positions: [{ ...AMS, accuracy: 800 }],
  });

  const fix = await acquireBestFix(api, { goodAccuracyM: 10, timeoutMs: 60 });

  // The poor fix is still the best we saw, so it resolves — but only after the
  // budget, never eagerly.
  assert.equal(fix.accuracy, 800);
});

// ---------------------------------------------------------------------------
// 2. GPS permission denied
// ---------------------------------------------------------------------------
test("GPS permission denied: خطای ۱ → permission_denied", async () => {
  // A denial delivers NO position — only the error, like a real browser.
  const { api, calls } = fakeGeolocation({
    positions: [],
    errors: [ERR_PERMISSION_DENIED],
  });

  await assert.rejects(
    () => acquireBestFix(api, { goodAccuracyM: 50 }),
    (err) => err instanceof GpsError && err.code === "permission_denied",
  );
  assert.equal(calls.cleared.length, 1, "watch cleared on permission denial");
});

// ---------------------------------------------------------------------------
// 3. GPS unavailable
// ---------------------------------------------------------------------------
test("GPS unavailable: خطای ۲ → unavailable", async () => {
  const { api } = fakeGeolocation({
    positions: [],
    errors: [ERR_POSITION_UNAVAILABLE],
  });

  await assert.rejects(
    () => acquireBestFix(api, { goodAccuracyM: 50 }),
    (err) => err instanceof GpsError && err.code === "unavailable",
  );
});

// ---------------------------------------------------------------------------
// 4. Timeout — no usable fix within the budget
// ---------------------------------------------------------------------------
test("timeout: هیچ fixی نرسید → timeout", async () => {
  const { api, calls } = fakeGeolocation({ positions: [] });

  await assert.rejects(
    () => acquireBestFix(api, { timeoutMs: 40 }),
    (err) => err instanceof GpsError && err.code === "timeout",
  );
  assert.equal(calls.cleared.length, 1);
});

test("watchPosition timeout قابل بازی‌گیری است: fix دیرتر می‌رسد", async () => {
  // The browser reports a per-fix TIMEOUT (code 3) after a coarse fix, but the
  // watch stays alive and a good fix arrives right after — must resolve, not
  // reject. The coarse first fix (800m) does not meet the 50m threshold.
  const { api } = fakeGeolocation({
    positions: [
      { ...AMS, accuracy: 800 },
      { ...AMS, accuracy: 20 },
    ],
    errors: [ERR_TIMEOUT, null],
  });

  const fix = await acquireBestFix(api, { goodAccuracyM: 50, timeoutMs: 500 });
  assert.equal(fix.accuracy, 20);
});

// ---------------------------------------------------------------------------
// Invalid coordinates are ignored, not fatal
// ---------------------------------------------------------------------------
test("fix با مختصات نامعتبر نادیده گرفته می‌شود، fix بعدی پذیرفته می‌شود", async () => {
  const { api } = fakeGeolocation({
    positions: [
      { latitude: NaN, longitude: 4.9041, accuracy: 5 },
      { ...AMS, accuracy: 30 },
    ],
  });

  const fix = await acquireBestFix(api, { goodAccuracyM: 50 });
  assert.equal(fix.latitude, AMS.latitude);
  assert.equal(fix.accuracy, 30);
});

// ---------------------------------------------------------------------------
// 6. Cleanup — abort (unmount / superseded request) stops the watch
// ---------------------------------------------------------------------------
test("abort: signal از قبل لغو شده → بدون شروع watch رد می‌شود", async () => {
  const { api, calls } = fakeGeolocation({ positions: [{ ...AMS, accuracy: 20 }] });

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => acquireBestFix(api, { signal: controller.signal }),
    (err) => err instanceof GpsError && err.code === "aborted",
  );
  assert.equal(calls.watchCount, 0, "no watch started for an aborted request");
});

test("abort وسط session: watch پاک‌سازی می‌شود", async () => {
  const { api, calls } = fakeGeolocation({
    positions: [{ ...AMS, accuracy: 800 }],
  });

  const controller = new AbortController();
  const pending = acquireBestFix(api, {
    signal: controller.signal,
    goodAccuracyM: 10, // nothing resolves eagerly
    timeoutMs: 2000,
  });
  controller.abort();

  await assert.rejects(
    () => pending,
    (err) => err instanceof GpsError && err.code === "aborted",
  );
  assert.equal(calls.cleared.length, 1, "watch cleared on abort");
});

// ---------------------------------------------------------------------------
// Acquisition options reach the browser API
// ---------------------------------------------------------------------------
test("گزینه‌های درخواست به watchPosition پاس داده می‌شوند", async () => {
  const { api, calls } = fakeGeolocation({
    positions: [{ ...AMS, accuracy: 20 }],
  });

  await acquireBestFix(api, {
    goodAccuracyM: 50,
    enableHighAccuracy: true,
    maximumAge: 0,
    timeoutMs: 5000,
  });

  // Compared field-by-field: the options object is created inside the VM
  // (a different realm), so deepStrictEqual across realms fails on prototype.
  assert.equal(calls.lastOptions.enableHighAccuracy, true);
  assert.equal(calls.lastOptions.timeout, 5000);
  assert.equal(calls.lastOptions.maximumAge, 0);
});
