/**
 * Template Catalog — 15 Tiered template identities with Authentic Persian Art & Modern Designs.
 *
 * Mathematically generates rich vector ornaments (Shamseh, Toranj, Lachak, Wooden Lattice)
 * with gold-foil styling and high-density luxury vector curves.
 */

import { ARTBOARD, type CardLayer, type ShapeLayer, type TextLayer, type PathLayer, type QrLayer } from "./document";
import type { Business } from "@/lib/businesses";
import { multiLayerShamsehD, carpetToranjD, carpetLachakD, laserCutLatticeD, shamsehD } from "./ornaments/geometry";

export type TemplateTier = "free" | "starter" | "pro";

export type TemplateDef = {
  id: string;
  name: string;
  tier: TemplateTier;
  description: string;
  background: string;
  tag: string;
  buildLayers: (business: Business) => CardLayer[];
};

function uid(kind: string): string {
  return `${kind}-${Math.random().toString(36).slice(2, 9)}`;
}

export const TEMPLATES_CATALOG: TemplateDef[] = [
  // =========================================================================
  // 👑 PRO VIP LUXURY & HERITAGE PERSIAN TEMPLATES (6 TEMPLATES)
  // =========================================================================
  {
    id: "pro-persian-carpet-toranj",
    name: "شاهکار فرش و قالی کاشان (لچک و ترنج)",
    tier: "pro",
    description: "کادر لچک‌وترنج شاهانه فرش کاشان با ترنج مرکزی و نقوش اسلیمی طلاکوب",
    background: "linear-gradient(135deg, #070e1c 0%, #0d1b33 50%, #050b17 100%)",
    tag: "👑 ویژه VIP",
    buildLayers: (b) => [
      {
        id: uid("shape"), kind: "shape", shape: "rect",
        x: 20, y: 20, width: ARTBOARD.width - 40, height: ARTBOARD.height - 40, angle: 0, opacity: 1,
        locked: true, hidden: false, color: null, background: null, radius: 8,
        stroke: "#BF953F", strokeWidth: 3, strokeStyle: "solid",
      } satisfies ShapeLayer,
      {
        id: uid("shape"), kind: "shape", shape: "rect",
        x: 32, y: 32, width: ARTBOARD.width - 64, height: ARTBOARD.height - 64, angle: 0, opacity: 0.8,
        locked: true, hidden: false, color: null, background: null, radius: 6,
        stroke: "#FCF6BA", strokeWidth: 1.5, strokeStyle: "dashed",
      } satisfies ShapeLayer,
      {
        id: uid("path"), kind: "path", name: "لچک بالا-راست",
        x: 0, y: 0, width: ARTBOARD.width, height: ARTBOARD.height, angle: 0, opacity: 0.9,
        locked: true, hidden: false, color: null, background: null,
        closed: true, points: [], rawD: carpetLachakD(ARTBOARD.width - 32, 32, 120, "top-right"),
        fill: "linear-gradient(135deg, #BF953F 0%, #AA771C 100%)", stroke: "#FCF6BA", strokeWidth: 1.5,
      } satisfies PathLayer,
      {
        id: uid("path"), kind: "path", name: "لچک پایین-راست",
        x: 0, y: 0, width: ARTBOARD.width, height: ARTBOARD.height, angle: 0, opacity: 0.9,
        locked: true, hidden: false, color: null, background: null,
        closed: true, points: [], rawD: carpetLachakD(ARTBOARD.width - 32, ARTBOARD.height - 32, 120, "bottom-right"),
        fill: "linear-gradient(135deg, #BF953F 0%, #AA771C 100%)", stroke: "#FCF6BA", strokeWidth: 1.5,
      } satisfies PathLayer,
      {
        id: uid("path"), kind: "path", name: "ترنج مرکزی فرش",
        x: 0, y: 0, width: ARTBOARD.width, height: ARTBOARD.height, angle: 0, opacity: 0.85,
        locked: true, hidden: false, color: null, background: null,
        closed: true, points: [], rawD: carpetToranjD(860, 200, 260, 220),
        fill: "linear-gradient(135deg, #102244 0%, #08142a 100%)", stroke: "#BF953F", strokeWidth: 2,
      } satisfies PathLayer,
      {
        id: uid("text"), kind: "text",
        x: 70, y: 90, width: 620, height: 68, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#FCF6BA", background: null,
        text: b.name || "فرش دستباف و نگارگری فاخر",
        fontSize: 48, fontWeight: 800, align: "start", fontFamily: "serif",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 70, y: 175, width: 620, height: 40, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#e2b755", background: null,
        text: b.category || "اصیل‌ترین نقوش اسلیمی، ختایی و لچک‌ترنج ایرانی",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 70, y: 440, width: 620, height: 40, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ffffff", background: null,
        text: `☎ تلفن هماهنگی: ${b.phone || "۰۲۱-۵۵۶۶۷۷۸۸"}`,
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 800, y: 380, width: 140, height: 140, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#070e1c", light: "#FCF6BA",
      } satisfies QrLayer,
    ],
  },
  {
    id: "pro-persian-architecture-gereh",
    name: "معماری سنتی و گره‌چینی شمسه ایرانی",
    tier: "pro",
    description: "گره‌چینی شمسه ۱۲ پر معماری صفوی با جلوه طلاکوب و نقوش هندسی اصیل",
    background: "linear-gradient(135deg, #180d05 0%, #2b1708 50%, #100803 100%)",
    tag: "👑 ویژه VIP",
    buildLayers: (b) => [
      {
        id: uid("path"), kind: "path", name: "شمسه ۱۲ پر طلاکوب",
        x: 0, y: 0, width: ARTBOARD.width, height: ARTBOARD.height, angle: 0, opacity: 0.9,
        locked: true, hidden: false, color: null, background: null,
        closed: true, points: [], rawD: multiLayerShamsehD(870, 190, 140),
        fill: null, stroke: "#BF953F", strokeWidth: 2,
      } satisfies PathLayer,
      {
        id: uid("text"), kind: "text",
        x: 70, y: 80, width: 640, height: 68, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#FCF6BA", background: null,
        text: b.name || "معماری اصیل و دکوراسیون سنتی",
        fontSize: 48, fontWeight: 800, align: "start", fontFamily: "serif",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 70, y: 165, width: 640, height: 38, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#e2b755", background: null,
        text: b.category || "طراحی فضاهای میراثی، ارسی، مقرنس و گره‌چینی چوبی",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 70, y: 450, width: 640, height: 38, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ffffff", background: null,
        text: `نشانی آتلیه: ${b.address || "اصفهان، میدان نقش جهان"}`,
        fontSize: 20, fontWeight: 500, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 800, y: 380, width: 140, height: 140, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#180d05", light: "#FCF6BA",
      } satisfies QrLayer,
    ],
  },
  {
    id: "pro-laser-cut-walnut-wood",
    name: "برش لیزری چوب گردو (لوکس)",
    tier: "pro",
    description: "بافت طبیعی چوب گردو با شبکه‌بندی مشبک و شش‌ضلعی‌های لیزری",
    background: "linear-gradient(135deg, #2b1810 0%, #3d2317 40%, #1f110b 100%)",
    tag: "👑 ویژه VIP",
    buildLayers: (b) => [
      {
        id: uid("path"), kind: "path", name: "شبکه‌بندی مشبک چوبی",
        x: 0, y: 0, width: ARTBOARD.width, height: ARTBOARD.height, angle: 0, opacity: 0.65,
        locked: true, hidden: false, color: null, background: null,
        closed: true, points: [], rawD: laserCutLatticeD(ARTBOARD.width - 240, 20, 220, ARTBOARD.height - 40, 48),
        fill: null, stroke: "#BF953F", strokeWidth: 1.5,
      } satisfies PathLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 80, width: 620, height: 68, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#FCF6BA", background: null,
        text: b.name || "کارت چوبی برش لیزری",
        fontSize: 48, fontWeight: 800, align: "start", fontFamily: "serif",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 165, width: 620, height: 38, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#d97706", background: null,
        text: b.category || "حکاکی و ساخت لوکس‌ترین متریال‌های چوب طبیعی",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 450, width: 620, height: 38, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ffffff", background: null,
        text: `تلفن سفارشات: ${b.phone || "۰۲۱-۷۷۸۸۹۹۰۰"}`,
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: ARTBOARD.width - 180, y: 380, width: 120, height: 120, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#1a0d08", light: "#FCF6BA",
      } satisfies QrLayer,
    ],
  },
  {
    id: "pro-gol-o-morgh-miniature",
    name: "نگارگری گل و مرغ ایرانی",
    tier: "pro",
    description: "زمینه لاجوردی فاخر با شمسه ده پر و کادر طلایی شاهانه",
    background: "linear-gradient(135deg, #091224 0%, #112244 50%, #060c18 100%)",
    tag: "👑 ویژه VIP",
    buildLayers: (b) => [
      {
        id: uid("shape"), kind: "shape", shape: "rect",
        x: 18, y: 18, width: ARTBOARD.width - 36, height: ARTBOARD.height - 36, angle: 0, opacity: 1,
        locked: true, hidden: false, color: null, background: null, radius: 10,
        stroke: "#BF953F", strokeWidth: 2.5, strokeStyle: "solid",
      } satisfies ShapeLayer,
      {
        id: uid("path"), kind: "path", name: "شمسه ۱۰ پر",
        x: 0, y: 0, width: ARTBOARD.width, height: ARTBOARD.height, angle: 0, opacity: 0.8,
        locked: true, hidden: false, color: null, background: null,
        closed: true, points: [], rawD: shamsehD(860, 270, 150, 10, 4),
        fill: null, stroke: "#FCF6BA", strokeWidth: 2,
      } satisfies PathLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 75, width: 600, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#FCF6BA", background: null,
        text: b.name || "نگارگری و هنر ایرانی",
        fontSize: 46, fontWeight: 800, align: "start", fontFamily: "serif",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 155, width: 600, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#e2b755", background: null,
        text: b.category || "تذهیب، مینیاتور و خوشنویسی استادانه",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 440, width: 600, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ffffff", background: null,
        text: `☎ ارتباط: ${b.phone || "۰۲۱-۸۸۹۹۰۰۱۱"}`,
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 820, y: 380, width: 130, height: 130, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#091224", light: "#FCF6BA",
      } satisfies QrLayer,
    ],
  },
  {
    id: "pro-gold-foil-embossed",
    name: "هولوگرام و طلاکوب برجسته VIP",
    tier: "pro",
    description: "کارت مشکی مات با خطوط طلاکوب، گرادیان طلایی و QR اختصاصی",
    background: "linear-gradient(135deg, #121212 0%, #1e1e1e 50%, #0a0a0a 100%)",
    tag: "👑 ویژه VIP",
    buildLayers: (b) => [
      {
        id: uid("shape"), kind: "shape", shape: "rect",
        x: 24, y: 24, width: ARTBOARD.width - 48, height: ARTBOARD.height - 48, angle: 0, opacity: 1,
        locked: true, hidden: false, color: null, background: null, radius: 12,
        stroke: "#B8892D", strokeWidth: 2, strokeStyle: "solid",
      } satisfies ShapeLayer,
      {
        id: uid("text"), kind: "text",
        x: 64, y: 80, width: 600, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#F7E08A", background: null,
        text: b.name || "کارت طلاکوب برجسته",
        fontSize: 48, fontWeight: 800, align: "start", fontFamily: "serif",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 64, y: 160, width: 600, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#D4AF37", background: null,
        text: b.category || "مدیریت ارشد و برندینگ بین‌المللی",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 64, y: 450, width: 600, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ffffff", background: null,
        text: `همراه مستقیم: ${b.phone || "۰۹۱۲-۰۰۰-۰۰۰۰"}`,
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 810, y: 370, width: 140, height: 140, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#121212", light: "#F7E08A",
      } satisfies QrLayer,
    ],
  },
  {
    id: "pro-marble-stone-gold",
    name: "مرمر مشکی و رگه‌های طلایی",
    tier: "pro",
    description: "بافت مرمر سلطنتی با رگه‌ها و فریم طلاکوب برای برندهای لوکس",
    background: "linear-gradient(135deg, #1c1917 0%, #292524 50%, #0c0a09 100%)",
    tag: "👑 ویژه VIP",
    buildLayers: (b) => [
      {
        id: uid("shape"), kind: "shape", shape: "rect",
        x: 30, y: 30, width: ARTBOARD.width - 60, height: ARTBOARD.height - 60, angle: 0, opacity: 1,
        locked: true, hidden: false, color: null, background: null, radius: 4,
        stroke: "#E5C158", strokeWidth: 1.5, strokeStyle: "solid",
      } satisfies ShapeLayer,
      {
        id: uid("text"), kind: "text",
        x: 70, y: 90, width: 620, height: 64, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#FDE68A", background: null,
        text: b.name || "گالری سنگ و مرمر سلطنتی",
        fontSize: 46, fontWeight: 800, align: "start", fontFamily: "serif",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 70, y: 170, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#D97706", background: null,
        text: b.category || "طراحی فضاهای لوکس تجاری و مسکونی",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 70, y: 440, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ffffff", background: null,
        text: `دفتر مرکزی: ${b.address || "تهران، فرشته"}`,
        fontSize: 20, fontWeight: 500, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 810, y: 370, width: 135, height: 135, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#1c1917", light: "#FDE68A",
      } satisfies QrLayer,
    ],
  },

  // =========================================================================
  // ⭐️ STARTER TEMPLATES (6 TEMPLATES)
  // =========================================================================
  {
    id: "starter-modern-dark-gradient",
    name: "مدرن تیره با گرادیان نئونی",
    tier: "starter",
    description: "طرح مدرن سرمه‌ای و بنفش نئونی مناسب کسب‌وکارهای مدرن",
    background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #311042 100%)",
    tag: "⭐️ استارتر",
    buildLayers: (b) => [
      {
        id: uid("shape"), kind: "shape", shape: "rect",
        x: 40, y: 40, width: 120, height: 6, angle: 0, opacity: 1,
        locked: true, hidden: false, color: null, background: "#818cf8", radius: 3,
      } satisfies ShapeLayer,
      {
        id: uid("text"), kind: "text",
        x: 40, y: 65, width: 620, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ffffff", background: null,
        text: b.name || "استودیو خلاقیت دیجیتال",
        fontSize: 44, fontWeight: 800, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 40, y: 140, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#c084fc", background: null,
        text: b.category || "توسعه نرم‌افزار، برندینگ و هویت بصری",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 40, y: 450, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#e2e8f0", background: null,
        text: `☎ ${b.phone || "۰۲۱-۲۲۳۳۴۴۵۵"}`,
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 810, y: 370, width: 140, height: 140, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#0f172a", light: "#ffffff",
      } satisfies QrLayer,
    ],
  },
  {
    id: "starter-emerald-executive",
    name: "زمردی مدیران و وکلا",
    tier: "starter",
    description: "ترکیب سبز زمردی و خطوط طلایی برای وکلا و مشاوران حقوقی",
    background: "linear-gradient(135deg, #064e3b 0%, #022c22 100%)",
    tag: "⭐️ استارتر",
    buildLayers: (b) => [
      {
        id: uid("shape"), kind: "shape", shape: "rect",
        x: 24, y: 24, width: ARTBOARD.width - 48, height: ARTBOARD.height - 48, angle: 0, opacity: 1,
        locked: true, hidden: false, color: null, background: null, radius: 8,
        stroke: "#34d399", strokeWidth: 1.5, strokeStyle: "solid",
      } satisfies ShapeLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 70, width: 620, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ecfdf5", background: null,
        text: b.name || "دفتر وکالت و مشاوره حقوقی",
        fontSize: 44, fontWeight: 800, align: "start", fontFamily: "serif",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 145, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#6ee7b7", background: null,
        text: b.category || "قبول دعاوی حقوقی، تجاری و بین‌المللی",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 440, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ffffff", background: null,
        text: `دفتر: ${b.address || "تهران، خیابان ولیعصر"}`,
        fontSize: 20, fontWeight: 500, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 810, y: 370, width: 135, height: 135, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#022c22", light: "#ecfdf5",
      } satisfies QrLayer,
    ],
  },
  {
    id: "starter-creative-diagonal",
    name: "آتلیه خلاق و دیزاینرها",
    tier: "starter",
    description: "بلاک‌های قطری مدرن با کنتراست بالا برای طراحان و عکاسان",
    background: "#18181b",
    tag: "⭐️ استارتر",
    buildLayers: (b) => [
      {
        id: uid("text"), kind: "text",
        x: 50, y: 70, width: 620, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#f43f5e", background: null,
        text: b.name || "آتلیه معماری و تصویرسازی",
        fontSize: 44, fontWeight: 800, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 50, y: 145, width: 620, height: 36, opacity: 1, angle: 0,
        locked: false, hidden: false, color: "#fda4af", background: null,
        text: b.category || "عکاسی صنعتی، ساخت تیزر و طراحی سه‌بعدی",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 50, y: 450, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ffffff", background: null,
        text: `شماره همراه: ${b.phone || "۰۹۱۲-۱۱۱-۲۲۳۳"}`,
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 810, y: 370, width: 140, height: 140, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#18181b", light: "#f43f5e",
      } satisfies QrLayer,
    ],
  },
  {
    id: "starter-tech-developer",
    name: "فناوری، هوش مصنوعی و نرم‌افزار",
    tier: "starter",
    description: "استایل مانیتوری کدر با فونت برنامه‌نویسی و المان‌های هوش مصنوعی",
    background: "#020617",
    tag: "⭐️ استارتر",
    buildLayers: (b) => [
      {
        id: uid("shape"), kind: "shape", shape: "rect",
        x: 30, y: 30, width: ARTBOARD.width - 60, height: ARTBOARD.height - 60, angle: 0, opacity: 1,
        locked: true, hidden: false, color: null, background: null, radius: 8,
        stroke: "#38bdf8", strokeWidth: 1.5, strokeStyle: "solid",
      } satisfies ShapeLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 70, width: 620, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#38bdf8", background: null,
        text: b.name || "توسعه‌دهنده سیستم‌های هوشمند",
        fontSize: 42, fontWeight: 800, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 145, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#94a3b8", background: null,
        text: b.category || "هوش مصنوعی، بلاک‌چین و توسعه وب اپلیکیشن",
        fontSize: 20, fontWeight: 500, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 60, y: 440, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#f8fafc", background: null,
        text: `وب‌سایت: https://example.com`,
        fontSize: 20, fontWeight: 500, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 810, y: 370, width: 135, height: 135, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#020617", light: "#38bdf8",
      } satisfies QrLayer,
    ],
  },
  {
    id: "starter-medical-health",
    name: "پزشکی، سلامت و کلینیک تخصصی",
    tier: "starter",
    description: "زمینه پاک فیروزه‌ای و آبی آرامش‌بخش ویژه پزشکان و کلینیک‌ها",
    background: "linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)",
    tag: "⭐️ استارتر",
    buildLayers: (b) => [
      {
        id: uid("text"), kind: "text",
        x: 50, y: 70, width: 620, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#0f766e", background: null,
        text: b.name || "کلینیک تخصصی و مرکز سلامت",
        fontSize: 44, fontWeight: 800, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 50, y: 145, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#14b8a6", background: null,
        text: b.category || "خدمات درمانی، زیبایی و مشاوره پزشکی",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 50, y: 440, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#134e4a", background: null,
        text: `☎ نوبت‌دهی: ${b.phone || "۰۲۱-۴۴۵۵۶۶۷۷"}`,
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 810, y: 370, width: 140, height: 140, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#0f766e", light: "#ffffff",
      } satisfies QrLayer,
    ],
  },
  {
    id: "starter-real-estate-gold",
    name: "املاک و مستغلات لوکس",
    tier: "starter",
    description: "کارت مشکی سورمه‌ای با لوگوی طلایی مناسب مشاورین املاک برتر",
    background: "linear-gradient(135deg, #0c1421 0%, #17253d 100%)",
    tag: "⭐️ استارتر",
    buildLayers: (b) => [
      {
        id: uid("text"), kind: "text",
        x: 50, y: 70, width: 620, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#fef08a", background: null,
        text: b.name || "گروه مهندسین و املاک لوکس",
        fontSize: 44, fontWeight: 800, align: "start", fontFamily: "serif",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 50, y: 145, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#eab308", background: null,
        text: b.category || "خرید، فروش و مشارکت در ساخت برج‌های فاخر",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 50, y: 440, width: 620, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#ffffff", background: null,
        text: `تلفن مستقیم: ${b.phone || "۰۹۱۲-۹۹۹-۸۸۷۷"}`,
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 810, y: 370, width: 140, height: 140, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#0c1421", light: "#fef08a",
      } satisfies QrLayer,
    ],
  },

  // =========================================================================
  // 🟢 FREE TEMPLATES (3 TEMPLATES)
  // =========================================================================
  {
    id: "free-classic-navy",
    name: "کلاسیک اداری سرمه‌ای",
    tier: "free",
    description: "طرح اداری ساده با پس‌زمینه سفید و کادر سرمه‌ای",
    background: "#f8fafc",
    tag: "رایگان",
    buildLayers: (b) => [
      {
        id: uid("shape"), kind: "shape", shape: "rect",
        x: 0, y: 0, width: 12, height: ARTBOARD.height, angle: 0, opacity: 1,
        locked: true, hidden: false, color: null, background: "#0b1c33", radius: 0,
      } satisfies ShapeLayer,
      {
        id: uid("text"), kind: "text",
        x: 48, y: 64, width: 600, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#0b1c33", background: null,
        text: b.name || "نام کسب‌وکار",
        fontSize: 44, fontWeight: 800, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 48, y: 140, width: 600, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#0ea5e9", background: null,
        text: b.category || "خدمات تخصصی",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 48, y: 460, width: 600, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#334155", background: null,
        text: `☎ ${b.phone || "۰۲۱-۵۵۶۶۷۷۸۸"}`,
        fontSize: 20, fontWeight: 500, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 820, y: 380, width: 150, height: 150, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#0b1c33", light: "#ffffff",
      } satisfies QrLayer,
    ],
  },
  {
    id: "free-minimal-white",
    name: "سفید مینیمال شرکتی",
    tier: "free",
    description: "کارت تمام‌سفید مینیمال با فونت تایپوگرافی خوانا",
    background: "#ffffff",
    tag: "رایگان",
    buildLayers: (b) => [
      {
        id: uid("text"), kind: "text",
        x: 48, y: 70, width: 600, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#1e293b", background: null,
        text: b.name || "نام شرکت و مجموعه",
        fontSize: 44, fontWeight: 800, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 48, y: 145, width: 600, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#64748b", background: null,
        text: b.category || "زمینه فعالیت رسمی",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 48, y: 450, width: 600, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#334155", background: null,
        text: `آدرس: ${b.address || "تهران، میدان ونک"}`,
        fontSize: 20, fontWeight: 500, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 820, y: 380, width: 140, height: 140, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#1e293b", light: "#ffffff",
      } satisfies QrLayer,
    ],
  },
  {
    id: "free-local-shop",
    name: "فروشگاه و کسب‌وکار محلی",
    tier: "free",
    description: "کارت فروشگاهی با تاکید بر شماره تماس و آدرس آتلیه",
    background: "#fffbebe0",
    tag: "رایگان",
    buildLayers: (b) => [
      {
        id: uid("text"), kind: "text",
        x: 48, y: 70, width: 600, height: 60, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#b45309", background: null,
        text: b.name || "فروشگاه و هایپر محلی",
        fontSize: 44, fontWeight: 800, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 48, y: 145, width: 600, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#d97706", background: null,
        text: b.category || "عرضه محصولات و خدمات روزانه",
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "vazir",
      } satisfies TextLayer,
      {
        id: uid("text"), kind: "text",
        x: 48, y: 450, width: 600, height: 36, angle: 0, opacity: 1,
        locked: false, hidden: false, color: "#78350f", background: null,
        text: `تلفن سفارش: ${b.phone || "۰۲۱-۱۱۲۲۳۳۴۴"}`,
        fontSize: 22, fontWeight: 600, align: "start", fontFamily: "sans",
      } satisfies TextLayer,
      {
        id: uid("qr"), kind: "qr",
        x: 820, y: 380, width: 140, height: 140, angle: 0, opacity: 1,
        locked: false, hidden: false, color: null, background: null,
        payload: b.slug || "e2e_owner", dark: "#78350f", light: "#ffffff",
      } satisfies QrLayer,
    ],
  },
];
