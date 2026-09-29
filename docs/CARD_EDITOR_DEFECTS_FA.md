# گزارش نقص‌های ویرایشگر کارت (Card Editor) — خط منحنی، قلم آزاد، قالب‌های سنتی/VIP

> **تاریخ:** ۲۹ سپتامبر ۲۰۲۶ (مجله‌ٔ گرگوری) · **پروژه:** InKart / golestani · **بخش:** `web/src/features/card-editor`
> **وضعیت تست‌ها:** `tsc` سبز · `vitest` ۳۸۸ سبز · `eslint` ۰ error / ۶ warning مجاز · `node --test` ۱۲۱ سبز · `npm run build` سبز
>
> این گزارش **سه نقص کاربردی تأییدشده** را با کد، ریشه‌ی مشترک و راه‌حل دقیق توضیح می‌دهد. نام نقص‌ها دقیقاً همان‌هایی است که گزارش شده‌اند:
> 1. **خط منحنی درست کار نمی‌کند**
> 2. **قلم آزاد ایراد اساسی دارد**
> 3. **قالب‌های سنتی و VIP فقط رنگ هستند**

---

## ۰. ریشه‌ی مشترک (مهم‌ترین بخش گزارش)

سه نقص بالا **یک علت واحد** دارند:

تابع `resolveLayerPathD` در `domain/path.ts:257` نوشته شده تا **تنها مرجع تبدیل لایه‌ی مسیر به دستور SVG `d`** باشد (پشتیبانی از `rawD`، قوس `bend`، و لنگرهای Bézier) — اما **هیچ مصرف‌کننده‌ای از آن استفاده نمی‌کند**. هم رندر React و هم سریالایز export همچنان از تابع قدیمی `pathD(layer.points, layer.closed)` استفاده می‌کنند که **فقط `points` را می‌خواند**.

```ts
// domain/path.ts:257 — اولین بار تعریف شده... اما در کل ریپو هیچ فراخوانی ندارد
export function resolveLayerPathD(
  layer: { points: PathPoint[]; closed?: boolean; rawD?: string; bend?: number }
): string {
  if (layer.rawD) return layer.rawD;                    // ۱) مسیر آماده (قالب‌ها + قلم آزاد)
  if (layer.bend !== undefined && layer.points && layer.points.length === 2) {
    return curveLineD({ /* ... */ });                   // ۲) قوس دایره‌ای واقعی (خط منحنی)
  }
  return pathD(layer.points || [], layer.closed ?? false); // ۳) لنگرهای Bézier
}
```

نتیجه‌ی جستجو در کل ریپو (grep) تنها دو تطابق دارد: خود تعریف تابع و یک کامنت. یعنی `rawD` و `bend` در عمل **داده‌های مرده‌ای** هستند که در سند ذخیره می‌شوند ولی هیچ‌گاه رندر نمی‌شوند.

```ts
// react/LayeredCardRenderer.tsx:373  ← رندر روی بوم (و export از همین projection استفاده می‌کند)
<path d={pathD(layer.points, layer.closed)} fill={layer.fill ?? "none"} {...strokeAttrs(stroke)} />

// export/documentToSvg.ts:184  ← سریالایز SVG/PDF
function pathMarkup(layer: PathLayer): string {
  const stroke = resolveStroke(layer, "#0ea5e9");
  const d = pathD(layer.points, layer.closed);   // ← rawD و bend نادیده گرفته می‌شوند
  if (!d) return "";
  ...
}
```

و `pathD` با `points: []` رشته‌ی خالی برمی‌گرداند:

```ts
// domain/path.ts:236
export function pathD(points: PathPoint[], closed = false): string {
  if (points.length === 0) return "";
  ...
```

**پس هر لایه‌ای که هندسه‌اش در `rawD` باشد (قالب‌های لوکس و قلم آزاد) یا در `bend` (خط منحنی) → روی بوم خالی رندر می‌شود.**

---

## ۱. خط منحنی درست کار نمی‌کند

### علائم

- ابزار «خط منحنی» (دکمه‌ی `Waves` در جعبه ابزار) یک خط **راست یا با انحنای ثابت** می‌کشد.
- دسته‌ی درگ (bend) که روی خط ظاهر می‌شود (الگوی Canva) **در جای اشتباه** است و کشیدن آن **هیچ تأثیری روی شکل خط ندارد**.

### ریشه

#### ۱-۱) لایه در زمان ساخت `bend` نمی‌گیرد

`createCurvedLineLayer` انحنا را در فیلد **قدیمی/جداگانه‌ی `curvature`** می‌نویسد و هندسه را با **دست‌های Bézier (hIn/hOut)** می‌سازد، اما هرگز `bend` را ست نمی‌کند:

```ts
// domain/luxuryMaterials.ts:129
export function createCurvedLineLayer(x = 100, y = 300, width = 500, height = 100,
                                      curvature = 40, color = "#0ea5e9"): PathLayer {
  const p0 = { x: 0, y: height };
  const p1 = { x: width, y: height };
  const { h0, h1 } = calculateArcHandles(p0, p1, curvature);
  return {
    ...
    curvature,                  // ← فیلد قدیمی
    points: [
      { x: p0.x, y: p0.y, hIn: null, hOut: h0 },
      { x: p1.x, y: p1.y, hIn: h1, hOut: null },
    ],
    // ❌ هیچ bend:‌ تعریف نشده
  };
}
```

#### ۱-۲) overlay دسته‌ی bend از فیلد خوانده می‌کند که وجود ندارد

`ArcBendHandleOverlay` موقعیت دسته را از `bend` محاسبه می‌کند و چون لایه `bend` ندارد، همیشه مقدار پیش‌فرض `0.4` را می‌گیرد که با هندسه‌ی واقعی (محاسبه‌شده از `curvature`) **همخوانی ندارد**:

```tsx
// react/BezierOverlays.tsx:375
const lSpec = {
  x1: layer.points[0].x, y1: layer.points[0].y,
  x2: layer.points[1].x, y2: layer.points[1].y,
  bend: layer.bend ?? 0.4,         // ← لایه هرگز bend ندارد ⇒ همیشه 0.4
};
const h = curveBendHandlePos(lSpec);   // موقعیت دسته با واقعیت می‌خواند؟ نه.
```

#### ۱-۳) کشیدن دسته چیزی را تغییر نمی‌دهد (چون رندر Bend را نمی‌خواند)

هنگام درگ، مقدار `bend` روی لایه به‌روز می‌شود — ولی همان‌طور که در بخش ۰ آمد، رندر فقط `pathD(points)` را صدا می‌زند و `bend` را نادیده می‌گیرد. پس **منحنی به درگ دسته واکنش نشان نمی‌دهد**:

```tsx
// react/BezierOverlays.tsx:401-402
const newBend = bendFromPointer(lSpec, localPt, zoom);
engine.updateLayer(layer.id, { bend: newBend });   // ✅ ذخیره می‌شود…
// …اما PathVisual همچنان pathD(points) را رسم می‌کند ⇒ ❌ تغییری دیده نمی‌شود
```

### پیامد تجربی کاربر
خط منحنی را که می‌کشی فقط یک خط ثابت است؛ دسته‌ی bend میانی در محل اشتباهی ظاهر می‌شود و کشیدنش هیچ کاری نمی‌کند.

---

## ۲. قلم آزاد ایراد اساسی دارد

### علائم

- روی بوم با قلم آزاد خط می‌کشی، پیش‌نمایش زنده (ribbon با ضخامت متغیر) **در حامله‌ی درگ درست نشان داده می‌شود**.
- به محض اینکه انگشت/قلم را برمی‌داری، خط **کاملاً ناپدید می‌شود** — لایه ساخته می‌شود و در پنل لایه‌ها دیده می‌شود، ولی روی بوم و در خروجی PNG/SVG **هیچ چیزی رسم نمی‌شود**.

### ریشه

#### ۲-۱) پیش‌نمایش زنده درست کار می‌کند (بخش سالم)

پیش‌نمایش با یک ref مستقیم به DOM و equestAnimationFrame به‌روز می‌شود و هیچ ربطی به مدل سند ندارد:

```tsx
// react/EditorStage.tsx:824
{/* Working Stroke Preview (perfect-freehand live ref + rAF) */}
<svg viewBox={`0 0 ${doc.artboard.width} ${doc.artboard.height}`}>
  <path ref={liveBrushRef} fill={state.brushColor || "#0ea5e9"} pointerEvents="none" />
</svg>

// react/EditorStage.tsx:404-415 — آپدیت d با handshake دور از React
const renderLiveBrush = () => {
  brushRafRef.current = 0;
  const outline = getBrushStrokeOutline(brushPtsRef.current, { size: state.brushWidth || 14, ... });
  liveBrushRef.current?.setAttribute("d", outlineToD(outline));
};
```

#### ۲-۲) ...اما لایه‌ی commit‌شده نامرئی است

در پایان ژست، خروجی به یک لایه با `rawD` و **`points: []`** تبدیل می‌شود:

```tsx
// react/EditorStage.tsx:516-536
if (isDrawingRef.current) {
  isDrawingRef.current = false;
  const pts = brushPtsRef.current;
  if (pts.length > 1) {
    const outline = getBrushStrokeOutline(pts, { ..., last: true });
    const d = outlineToD(outline);
    if (d) {
      engine.addBrushLayer(d, state.brushColor || "#0ea5e9");
    }
  }
  ...
}
```

```ts
// engine/EditorEngine.ts:292
addBrushLayer(d: string, color = "#0ea5e9"): string {
  const layer: PathLayer = {
    id, kind: "path", name: "قلم آزاد",
    points: [],          // ❌ خالی
    rawD: d,             // ← کل هندسه اینجا است… ولی کسی آن را رندر نمی‌کند
    closed: true,
    fill: color,
    stroke: null, strokeWidth: 0,
    x: 0, y: 0,
    width: ARTBOARD.width, height: ARTBOARD.height,
    ...
  };
}
```

و چون رندر از `pathD(layer.points, layer.closed)` استفاده می‌کند (نه `resolveLayerPathD`)، با `points: []` مقدار `""` تولید می‌شود → **مسیر خالی = هیچ رسمی**. انگشت که برداشته شد، خط محو می‌شود. Export هم به همین شکل (`documentToSvg.ts:184`) خط را در PNG/SVG نمی‌کشد.

### پیامد تجربی کاربر
قلم آزاد عملاً قابل استفاده نیست: نقاشی می‌کنی، همه‌چیز موقع رها کردن ناپدید می‌شود و ذخیره/خروجی هم آن را ندارد.

---

## ۳. قالب‌های سنتی و VIP فقط رنگ هستند

### علائم

- انتخاب قالب‌های Persian Carpet / Shamseh / Toranj / Lachak / Laser-cut Wood (پلن Pro) فقط **یک پس‌زمینه‌ی گرادیانی** و چند متن نشان می‌دهد؛ **هیچ نقش سنتی (شَمسه، ترنج، لچک، شبکه‌ی چوبی) رسم نمی‌شود** — هم روی بوم و هم در خروجی.

### ریشه

تمام هندسه‌ی تزئینی این قالب‌ها در `rawD` تولید می‌شود و `points` خالی است:

```ts
// domain/templatesCatalog.ts:53
{
  id: uid("path"), kind: "path", name: "لچک بالا-راست",
  x: 0, y: 0, width: ARTBOARD.width, height: ARTBOARD.height, angle: 0, opacity: 0.9,
  locked: true, hidden: false, color: null, background: null,
  closed: true, points: [],                                 // ❌ خالی
  rawD: carpetLachakD(ARTBOARD.width - 32, 32, 120, "top-right"),   // ← کل هنر اینجاست
  fill: "linear-gradient(135deg, #BF953F 0%, #AA771C 100%)", stroke: "#FCF6BA", strokeWidth: 1.5,
},
```

سایر لایه‌های قالب VIP به همین شکل: `carpetToranjD(...)` (خط ۷۰)، `multiLayerShamsehD(...)` (۱۱۴)، `laserCutLatticeD(...)` (۱۵۸)، `shamsehD(...)` (۲۰۸) — همگی `points: []` + `rawD`.

تابع‌های مولد این نقوش واقعاً وجود دارند و خروجی تولید می‌کنند (`domain/ornaments/geometry.ts`)، ولی چون رندر فقط `points` را می‌خواند، **آن لایه‌ها در سند هستند ولی در تصویر نیستند**. در نتیجه قالب فقط پس‌زمینه + متن نشان می‌دهد = «فقط رنگ».

---

## ۴. راه‌حل پیشنهادی

### ۴-۱) اصلاح اصلی (دو خط، سه مشکل را حل می‌کند)

قرارداد معماری این پروژه «یک هندسه، سه مصرف‌کننده» است؛ حالا وقت آن است که **هر سه مصرف‌کننده از همان یک resolver** استفاده کنند:

```diff
// react/LayeredCardRenderer.tsx:373
- const d = pathD(layer.points, layer.closed)
+ d={resolveLayerPathD(layer)}
```

```diff
// export/documentToSvg.ts:184
- const d = pathD(layer.points, layer.closed);
+ const d = resolveLayerPathD(layer);
```

با این تغییر:
- **قالب‌های VIP/سنتی:** `rawD` به‌محض رندر رسم می‌شود ⇒ نقوش شمسه/ترنج/لچک/شبکه ظاهر می‌شوند (هم بوم، هم export).
- **قلم آزاد:** لایه‌ی commit‌شده دیگر نامرئی نیست؛ ribbon با fill آن روی بوم و در خروجی می‌ماند.
- **خط منحنی:** مسیرهای ۲-نقطه‌ای که `bend` دارند، قوس دایره‌ای واقعی (`A` command) می‌گیرند.

### ۴-۲) اصلاح‌های مکمل خط منحنی

۱. **موقعیت دسته‌ی bend با واقعیت هم‌خوان شود** — هنگام ساخت لایه `bend` ست شود، یا overlay از هندسه‌ی واقعی دسته‌ها محاسبه شود:

```ts
// domain/luxuryMaterials.ts — createCurvedLineLayer
return {
  ...,
  curvature,
+ bend: curvature / 100,   // یا محاسبه‌ی دقیق‌تر از h0/h1
  points: [...],
};
```

۲. **ویرایش نقاط با rawD:** `PathEditOverlay` از `points` می‌خواند؛ لایه‌های rawD با anchor قابل ویرایش نیستند (باید از نقاط خالی خبر داده شود یا به points تبدیل شوند).

### ۴-۳) تست‌های پیشنهادی (جلوگیری از بازگشت)

- تست resolver به‌صورت خالص: یک لایه `{ kind: "path", points: [], rawD: "M 0 0 L 10 10", ... }` به `LayerVisual`/`pathMarkup` بده و انتظار داشته باش `d="M 0 0 L 10 10"` در خروجی باشد.
- تست موتور قلم آزاد: `addBrushLayer("M 0 0 L 5 5", "#f00")` → `resolveLayerPathD(layer)` برابر همان رشته باشد.
- تست قوس: لایه ۲-نقطه‌ای `bend: 1` → خروجی شامل ` A ` (دستور قوس) باشد.

---

## ۵. ریسک‌ها و ملاحظات

1. **اولویت `rawD` بر `points`:** اگر لایه‌ای هر دو را داشته باشد `rawD` برنده است. لایه‌های pen موجود فقط `points` دارند ⇒ بی‌اثر. ولی اگر لایه‌ای rawD داشته باشد و کاربر بخواهد نقاط را ویرایش کند، ویرایش نقاط کار نمی‌کند (باید rawD را حذف کرد).
2. **رسم fill فقط برای لایه‌های closed:** `addBrushLayer` از `closed: true` استفاده می‌کند و قالب‌ها هم closed هستند — fill به‌درستی نمایش داده می‌شود.
3. **مختصات:** لایه‌های rawD در مختصات artboard جعبه‌ی آن‌ها `x:0, y:0, width:1050, height:600` است — با viewBox رندر هم‌خوان است.
4. **rawD در سند ذخیره می‌شود ولی قابل ویرایش نیست** (مگر با حذف). برای قالب‌های قفل‌شده (locked: true) این توسعه‌پذیر است.
5. تغییر خروجی export (SVG/PDF) برای لایه‌های rawD باعث تغییر تصویر خروجی کارت‌های ذخیره‌شده می‌شود (افزودن نقوش گم‌شده) — این **قابلیت موردنظر** است، نهتباهی.

---

## ۶. خلاصه برای کمک گرفتن (خلاصه‌ی یک‌خطی)

> سه مشکل گزارش‌شده (خط منحنی، قلم آزاد، قالب‌های سنتی/VIP) همگی از یک ریشه‌ی واحد هستند: **هیچ کس esolveLayerPathD (در domain/path.ts:257) را صدا نمی‌زند** — رندر (LayeredCardRenderer.tsx:373) و export (documentToSvg.ts:184) هنوز از pathD(layer.points) استفاده می‌کنند، پس هر هندسه‌ای که در awD یا end ذخیره شده باشد، هرگز رسم نمی‌شود. کافی است این دو خط به esolveLayerPathD(layer) تغییر کنند تا هر سه مشکل برطرف شوند.