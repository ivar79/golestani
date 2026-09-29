// CSS contract (پشته فنی مصوب): همهٔ استایل‌ها با Tailwind — بدون کلاس
// دست‌ساز باقی‌مانده، بدون CSS module، بدون style={} ثابت.
// اجرا: node tests/css-contract.test.cjs  (یا از طریق runner فازها)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");

/** Recursively list files under `dir` whose name matches `re`. */
function walk(dir, re, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, re, acc);
    else if (re.test(entry.name)) acc.push(full);
  }
  return acc;
}

/* 1) Only TWO css files may exist: the Tailwind entry + nothing else.
      phase2.module.css was the last CSS module and has been removed. */
const cssFiles = walk(SRC, /\.css$/).map((f) => path.relative(SRC, f).replace(/\\/g, "/"));
assert.deepEqual(
  cssFiles.sort(),
  ["app/globals.css"],
  `only the Tailwind entry stylesheet may exist — found: ${cssFiles.join(", ")}`,
);

/* 2) No imports of the removed CSS module anywhere. */
for (const f of walk(SRC, /\.(tsx?|jsx?)$/)) {
  const text = fs.readFileSync(f, "utf8");
  assert.ok(
    !/phase2\.module\.css/.test(text),
    `${path.relative(SRC, f)} must not import the removed phase2.module.css`,
  );
}

/* 3) Removed hand-written classes must not be referenced in components.
      (globals.css keeps @utility definitions only for the two allowed
      reusable utilities: mask-edge-fade, no-scrollbar.) */
const bannedClasses = [
  "btn-primary", "btn-secondary", "btn-ghost", "btn-outline",
  "btn-sm", "btn-md", "btn-lg", "btn-arrow", "auth-cta",
  "homepage-glass", "homepage-card", "animate-float-soft",
  "animate-dash", "topbar-bob", "drawer-backdrop", "drawer-panel",
];
const componentFiles = walk(SRC, /\.(tsx|ts|jsx)$/);
for (const f of componentFiles) {
  const text = fs.readFileSync(f, "utf8");
  for (const cls of bannedClasses) {
    const re = new RegExp(`(className=["'\`][^"'\`]*\\b${cls}\\b)`, "m");
    assert.ok(
      !re.test(text),
      `${path.relative(SRC, f)} references banned hand-written class "${cls}" — use Tailwind utilities`,
    );
  }
}

/* 4) globals.css must declare the Tailwind entry and only whitelisted @utility blocks. */
const globals = fs.readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
assert.ok(globals.includes('@import "tailwindcss";'), "globals.css must import tailwindcss");
const utilities = [...globals.matchAll(/^@utility\s+([\w-]+)/gm)].map((m) => m[1]);
assert.deepEqual(
  utilities.sort(),
  ["mask-edge-fade", "no-scrollbar"],
  `only mask-edge-fade and no-scrollbar may be custom @utility blocks — found: ${utilities.join(", ")}`,
);

console.log("css-contract: OK — Tailwind-only styling holds");
