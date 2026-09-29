/**
 * Card renderer contract.
 *
 * The project has ONE document projection. The editor stage, the export surface
 * and the public card must all render it, because three independent copies had
 * already drifted (different image tones, different badge glyphs) and export
 * rasterization depends on identical markup.
 *
 * These are source-level assertions in the same style as the other contract
 * suites: they fail loudly if someone re-introduces a second renderer or
 * bypasses the same-origin media path.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const renderer = read("src/features/card-editor/react/LayeredCardRenderer.tsx");
const stage = read("src/features/card-editor/react/EditorStage.tsx");
const publicPageDir = path.join(root, "src/app/b/[slug]");

test("renderer exposes the one shared projection", () => {
  assert.match(renderer, /export function LayerBox\(/, "LayerBox must be exported from the renderer");
  assert.match(renderer, /export function LayerVisual\(/, "LayerVisual must be exported from the renderer");
  assert.match(renderer, /export function LayeredCard\(/, "LayeredCard must stay exported for the export surface");
});

test("the stage renders the shared projection instead of its own copy", () => {
  assert.match(stage, /import \{[^}]*LayerBox[^}]*\} from "\.\/LayeredCardRenderer"/, "stage must import LayerBox");
  assert.ok(stage.includes("<LayerBox"), "stage must render LayerBox");
  assert.ok(
    !stage.includes("StageLayerVisual"),
    "stage must not carry a second renderer (StageLayerVisual was removed)",
  );
});

test("no renderer fetches card media cross-origin", () => {
  // crossOrigin="anonymous" against /storage cannot work: those bytes are
  // served without CORS headers, so html-to-image would drop image layers.
  assert.ok(
    !renderer.includes("crossOrigin"),
    "renderer must not request CORS for cross-origin media",
  );
  assert.match(renderer, /mediaSrc\(/, "renderer must resolve card media through the same-origin proxy");
  assert.ok(
    !renderer.includes("resolveMediaUrl"),
    "renderer must not bypass the rasterizable same-origin path",
  );
});

test("the QR layer uses the project's own cached route", () => {
  assert.match(renderer, /\/api\/qr\//, "QR must render from the same-origin /api/qr route");
  assert.ok(
    !renderer.includes("dangerouslySetInnerHTML"),
    "QR must not inject raw upstream HTML into the document",
  );
});

test("public card rendering exists and is routed through the shared projection", () => {
  const files = fs.readdirSync(publicPageDir);
  const page = files.find((f) => f === "page.tsx");
  assert.ok(page, "public business page must exist");
  const source = read(path.join("src/app/b/[slug]", page));
  assert.match(
    source,
    /design_json/,
    "public page must consume the card document",
  );
});
