/**
 * Export the frontend template catalog to the canonical SERVER-SIDE JSON.
 *
 * The single authoring home for builtin templates stays templatesCatalog.ts;
 * this script compiles it (esbuild, already present via vite) and emits
 * api/resources/card-templates/builtin-catalog.json with each template's
 * FULL design document. Business values are replaced with {{placeholders}}
 * (name/category/phone/website/address/slug) so the server's apply pipeline
 * can fill them per business at apply time.
 *
 * Run: node scripts/export-builtin-catalog.mjs   (from web/)
 */

import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../api/resources/card-templates/builtin-catalog.json");

/** A business whose values ARE the placeholders — buildLayers() output then
 * carries {{name}}, {{category}}, … verbatim for server-side fill. */
const PLACEHOLDER_BUSINESS = {
  id: 0,
  name: "{{name}}",
  slug: "{{slug}}",
  category: "{{category}}",
  phone: "{{phone}}",
  address: "{{address}}",
  city: "",
  neighborhood: "",
  description: "",
  social_links: { website: "{{website}}" },
};

const mod = await build({
  entryPoints: [resolve(here, "../src/features/card-editor/domain/templatesCatalog.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  // geometry.ts is pure math; "@/lib/businesses" is types-only for the
  // catalog. Stub any runtime import that esbuild cannot resolve.
  external: ["react", "react-dom"],
  alias: {
    "@": resolve(here, "../src"),
  },
});

const sandbox = { exports: {}, module: { exports: {} }, require: (name) => {
  if (name.includes("businesses")) return {};
  throw new Error(`unexpected require: ${name}`);
} };

// eslint-disable-next-line no-new-func
new Function("module", "exports", "require", mod.outputFiles[0].text)(sandbox.module, sandbox.exports, sandbox.require);
const catalog = sandbox.module.exports.TEMPLATES_CATALOG ?? sandbox.exports.TEMPLATES_CATALOG;
if (!Array.isArray(catalog) || catalog.length === 0) {
  console.error("builtin-catalog export: TEMPLATES_CATALOG is empty — aborting.");
  process.exit(1);
}

const templates = catalog.map((t) => {
  const layers = t.buildLayers(PLACEHOLDER_BUSINESS).map((layer) => {
    // Serialize with the SAME field whitelist the editor persists so the
    // server document is a faithful, valid card document.
    const clone = { ...layer };
    delete clone.z; // legacy z-order field is never persisted
    return clone;
  });
  return {
    id: t.id,
    name: t.name,
    tier: t.tier,
    category: t.category ?? "general",
    description: t.description,
    background: t.background,
    document: { version: 1, artboard: { width: 1050, height: 600 }, background: t.background, layers },
  };
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedFrom: "templatesCatalog.ts", templates }, null, 1), "utf8");
console.log(`builtin-catalog.json written: ${templates.length} templates → ${OUT}`);
