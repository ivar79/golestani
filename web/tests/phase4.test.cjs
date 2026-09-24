// Run from web/: node --test tests/phase4.test.cjs
// Phase 4 — Card Builder: template contract, XSS guards, private print-file
// download behavior, and UI invariants. Uses the project's existing
// TypeScript devDependency (no extra packages).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

/* ------------------------------------------------------------------ */
/* Template contract — five genuinely distinct templates               */
/* ------------------------------------------------------------------ */

const canvasSource = read("src/components/cards/CardCanvas.tsx");

test("CardTemplate union contains exactly the five approved templates", () => {
  const match = /export type CardTemplate = ([^;]+);/.exec(canvasSource);
  assert.ok(match, "CardTemplate union not found");
  const keys = match[1].split("|").map((s) => s.trim().replace(/"/g, ""));
  assert.deepEqual(keys.sort(), ["classic", "creative", "emerald", "local", "midnight"]);
});

test("themeTokens defines all five template families", () => {
  for (const key of ["classic", "midnight", "emerald", "local", "creative"]) {
    assert.ok(
      new RegExp(`${key}: "`).test(canvasSource),
      `themeTokens missing "${key}" family`
    );
  }
});

test("every template branch renders the shared QRBox (real QR everywhere)", () => {
  const qrUsages = (canvasSource.match(/<QRBox/g) || []).length;
  assert.ok(qrUsages >= 5, `expected QRBox in all 5 templates, found ${qrUsages}`);
});

test("verification badge renders from Phase 3 fields", () => {
  assert.ok(canvasSource.includes("license_verified || business.verification_badge"));
});

/* ------------------------------------------------------------------ */
/* XSS — business data is never raw HTML                               */
/* ------------------------------------------------------------------ */

test("only one raw-HTML sink exists and it is the QR SVG from our own API", () => {
  const sinks = (canvasSource.match(/dangerouslySetInnerHTML/g) || []).length;
  assert.equal(sinks, 1, "business data must never be rendered as raw HTML");
  const sinkLine = canvasSource.split("\n").findIndex((l) => l.includes("dangerouslySetInnerHTML"));
  const context = canvasSource.split("\n").slice(sinkLine - 6, sinkLine).join("\n");
  assert.ok(context.includes("qrSvg"), "the only raw sink must be the QR code");
});

/* ------------------------------------------------------------------ */
/* Card Maker page invariants                                          */
/* ------------------------------------------------------------------ */

const makerSource = read("src/app/card-maker/page.tsx");

test("template picker offers all five templates with previews", () => {
  for (const key of ["classic", "midnight", "emerald", "local", "creative"]) {
    assert.ok(makerSource.includes(`key: "${key}"`), `picker missing ${key}`);
  }
});

test("print file download is authorized (no public URL anchors)", () => {
  assert.ok(makerSource.includes("downloadPrintFile"), "must use authorized blob download");
  assert.ok(!makerSource.includes("print_file_url) ? ("), "legacy public URL anchor must be gone");
  assert.ok(!/<a\s+href=\{cardData/.test(makerSource), "no <a> around private file");
});

test("print file deletion requires an in-app confirmation modal", () => {
  assert.ok(makerSource.includes("confirmDelete"), "confirm state missing");
  assert.ok(!makerSource.includes("window.confirm"), "raw window.confirm is not allowed");
});

test("client-side upload validation mirrors backend rules", () => {
  assert.ok(makerSource.includes("10 * 1024 * 1024"), "10MB limit missing");
  assert.ok(makerSource.includes('application/pdf'), "PDF type missing");
  assert.ok(makerSource.includes('image/webp'), "webp type missing");
});

test("unsaved-changes guard is wired", () => {
  assert.ok(makerSource.includes("isDirty"), "dirty tracking missing");
  assert.ok(makerSource.includes("beforeunload"), "leave-guard missing");
});

test("responsive preview: device widths and fit-to-screen exist", () => {
  assert.ok(makerSource.includes("mobile: 375"), "mobile width missing");
  assert.ok(makerSource.includes("tablet: 768"), "tablet width missing");
  assert.ok(makerSource.includes("ResizeObserver"), "fit-to-screen needs ResizeObserver");
});

/* ------------------------------------------------------------------ */
/* Authorized download helper — real behavior with a stubbed API       */
/* ------------------------------------------------------------------ */

function loadPhase4Module(mockResponse) {
  let source = read("src/lib/phase4.ts");
  source = source.replace(
    'import api from "@/lib/api";',
    "const api = { get: async () => mockResponse };"
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const clicked = [];
  const sandbox = {
    mockResponse,
    URL: {
      createObjectURL: () => "blob:mock",
      revokeObjectURL: () => {},
    },
    document: {
      createElement: () => {
        const el = { click: () => clicked.push(el), href: "", download: "", remove: () => {} };
        return el;
      },
      body: { appendChild: () => {}, removeChild: () => {} },
    },
    exports: {},
    module: { exports: {} },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(js, sandbox);
  return { fn: sandbox.exports.downloadPrintFile, clicked };
}

test("downloadPrintFile fetches a blob with auth and uses the server filename", async () => {
  const { fn, clicked } = loadPhase4Module({
    headers: { "content-disposition": "attachment; filename=\"khas-e-chapi.pdf\"" },
    data: { blob: true },
  });
  await fn(7);
  assert.equal(clicked.length, 1, "must trigger a download click");
  assert.equal(clicked[0].download, "khas-e-chapi.pdf");
});

test("downloadPrintFile decodes RFC 5987 UTF-8 filenames (Persian)", async () => {
  const { fn, clicked } = loadPhase4Module({
    headers: {
      "content-disposition": "attachment; filename*=UTF-8''%D8%B7%D8%B1%D8%AD%20%DA%86%D8%A7%D9%BE%DB%8C.pdf",
    },
    data: {},
  });
  await fn(1);
  assert.equal(clicked[0].download, "طرح چاپی.pdf");
});

test("downloadPrintFile falls back to a safe default name and sanitizes it", async () => {
  const { fn, clicked } = loadPhase4Module({ headers: {}, data: {} });
  await fn(3);
  assert.equal(clicked[0].download, "print-file");

  const { fn: fn2, clicked: clicked2 } = loadPhase4Module({
    headers: { "content-disposition": 'attachment; filename="bad/name*?.pdf"' },
    data: {},
  });
  await fn2(3);
  assert.ok(!/[\\?%*:|"<>]/.test(clicked2[0].download), "filename must be sanitized");
});

/* ------------------------------------------------------------------ */
/* Private print files — no public URL anywhere in the UI              */
/* ------------------------------------------------------------------ */

test("dashboard and admin no longer link raw print_file_url", () => {
  for (const page of ["src/app/dashboard/page.tsx", "src/app/admin/businesses/page.tsx"]) {
    const src = read(page);
    assert.ok(
      !src.includes("href={editing.cards[0].print_file_url}") &&
        !src.includes("href={selected.cards[0].print_file_url}"),
      `${page} still links the legacy public print URL`
    );
    assert.ok(src.includes("downloadPrintFile"), `${page} must use the authorized download`);
  }
});

test("CardSummary type documents the private contract", () => {
  const src = read("src/lib/phase2.ts");
  assert.ok(src.includes("has_print_file"), "CardSummary must expose has_print_file");
});
