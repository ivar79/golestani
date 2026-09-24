// XSS safety tests for the Neshan popup DOM builder (web/src/lib/mapPopupDom.ts).
//   node --test tests/mapPopupDom.test.cjs   (run from web/)
// No dependencies: a minimal DOM shim (createElement/textContent/setAttribute)
// runs the builder inside a VM so we can assert business-controlled strings
// are stored as TEXT nodes, never parsed as HTML.
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

// --- minimal DOM shim -------------------------------------------------------
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = "";
    this.dir = "";
    this.textContent = "";
    this.src = "";
    this.alt = "";
    this.loading = "";
    this.innerText = "";
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  /** All descendant text, emulating what a real DOM would render. */
  renderedText() {
    const parts = [];
    const walk = (n) => {
      if (n.textContent) parts.push(n.textContent);
      n.children.forEach(walk);
    };
    walk(this);
    return parts.join("");
  }
  /** Any attribute anywhere in the subtree. */
  findAttributes(name, acc = []) {
    if (this.attributes[name] !== undefined) acc.push(this.attributes[name]);
    this.children.forEach((c) => c.findAttributes(name, acc));
    return acc;
  }
  /** Any tag name anywhere in the subtree. */
  hasTag(tag) {
    if (this.tagName === String(tag).toUpperCase()) return true;
    return this.children.some((c) => c.hasTag(tag));
  }
}

const context = {
  exports: {},
  module: { exports: {} },
  require: (id) => {
    if (id.startsWith("@/")) {
      throw new Error(`unexpected dependency: ${id}`);
    }
    return require(id);
  },
  document: { createElement: (tag) => new FakeNode(tag) },
  URL,
  process: { env: process.env },
};
vm.runInNewContext(transpile("../src/lib/mapPopupDom.ts"), context, {
  filename: "mapPopupDom.ts",
});
const { buildPopupDom, isSafeHref } = context.exports;

const MALICIOUS = "<img src=x onerror=alert(1)>";
const MALICIOUS_SCRIPT = "<script>window.__pwned=1</script>";

// ---------------------------------------------------------------------------
// Malicious title / category must render as TEXT — never as elements
// ---------------------------------------------------------------------------

test("buildPopupDom: title مخرب به‌صورت متن است، هیچ <img>/<script> عنصر نمی‌شود", () => {
  const root = buildPopupDom({
    id: 1,
    latitude: 35.7,
    longitude: 51.4,
    title: MALICIOUS,
    category: "کافه",
  });
  assert.equal(root.hasTag("img"), false, "img element must NOT be created from title");
  assert.equal(root.hasTag("script"), false);
  assert.ok(root.renderedText().includes(MALICIOUS), "payload must appear as literal text");
});

test("buildPopupDom: category مخرب به‌صورت متن است", () => {
  const root = buildPopupDom({
    id: 2,
    latitude: 35.7,
    longitude: 51.4,
    title: "کافه ونک",
    category: MALICIOUS,
  });
  assert.equal(root.hasTag("img"), false);
  assert.ok(root.renderedText().includes(MALICIOUS));
});

test("buildPopupDom: subtitle و title با <script> هم اجرا نمی‌شوند", () => {
  const root = buildPopupDom({
    id: 3,
    latitude: 35.7,
    longitude: 51.4,
    title: MALICIOUS_SCRIPT,
    subtitle: MALICIOUS_SCRIPT,
  });
  assert.equal(root.hasTag("script"), false);
  assert.ok(root.renderedText().includes(MALICIOUS_SCRIPT));
});

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

test("isSafeHref: javascript:/data: رد می‌شود؛ http(s) و مسیر relative پذیرفته", () => {
  assert.equal(isSafeHref("https://example.com/x"), true);
  assert.equal(isSafeHref("http://example.com/x"), true);
  assert.equal(isSafeHref("/b/some-slug"), true);
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("data:text/html,<script>"), false);
  assert.equal(isSafeHref("//evil.example.com"), false);
  assert.equal(isSafeHref(""), false);
  assert.equal(isSafeHref(null), false);
});

test("buildPopupDom: href خطرناک → هیچ CTA ساخته نمی‌شود", () => {
  const root = buildPopupDom({
    id: 4,
    latitude: 35.7,
    longitude: 51.4,
    title: "کسب‌وکار",
    href: "javascript:alert(1)",
  });
  assert.equal(root.hasTag("a"), false, "no anchor may be created for a dangerous href");
  assert.equal(root.findAttributes("href").length, 0);
});

test("buildPopupDom: logoUrl خطرناک → هیچ <img> ساخته نمی‌شود", () => {
  const root = buildPopupDom({
    id: 5,
    latitude: 35.7,
    longitude: 51.4,
    title: "کسب‌وکار",
    logoUrl: "javascript:alert(1)",
  });
  assert.equal(root.hasTag("img"), false);
});

test("buildPopupDom: logoUrl سالم → img با src درست", () => {
  const root = buildPopupDom({
    id: 6,
    latitude: 35.7,
    longitude: 51.4,
    title: "کسب‌وکار",
    logoUrl: "https://cdn.example.com/logo.png",
  });
  const srcs = root.findAttributes("src");
  assert.equal(srcs.length, 1);
  assert.equal(srcs[0], "https://cdn.example.com/logo.png");
});

// ---------------------------------------------------------------------------
// Phase 3 semantics survive (identical behavior to the old innerHTML version)
// ---------------------------------------------------------------------------

test("buildPopupDom: unclaimed → متن توافقی + تنها CTA /login (بدون لینک پروفایل)", () => {
  const root = buildPopupDom({
    id: 7,
    latitude: 35.7,
    longitude: 51.4,
    title: "کافه ثبت‌نشده",
    category: "کافه",
    unclaimed: true,
    href: "https://attacker.example.com",
  });
  const hrefs = root.findAttributes("href");
  assert.equal(hrefs.length, 1);
  assert.equal(hrefs[0], "/login");
  assert.ok(root.renderedText().includes("این کسب‌وکار هنوز در اینکارت فعال نشده است."));
  assert.ok(root.renderedText().includes("ثبت مالکیت رایگان"));
});

test("buildPopupDom: claimed → CTA «مشاهده کارت ویزیت» با href سالم + فاصله در subtitle", () => {
  const root = buildPopupDom({
    id: 8,
    latitude: 35.7,
    longitude: 51.4,
    title: "کافه ونک",
    category: "کافه",
    subtitle: "فاصله: ۸۵۰ متر",
    href: "/b/kafe-vanak",
  });
  const hrefs = root.findAttributes("href");
  assert.equal(hrefs.length, 1);
  assert.equal(hrefs[0], "/b/kafe-vanak");
  const anchors = [];
  const walk = (n) => {
    if (n.tagName === "A") anchors.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  assert.equal(anchors[0].textContent, "مشاهده کارت ویزیت");
  assert.ok(root.renderedText().includes("۸۵۰ متر"));
});
