/**
 * Persian Geometric Ornaments Generator (Gereh-Chini, Shamseh, Lachak-o-Toranj).
 *
 * Mathematically generates authentic Islamic & Persian architectural motifs
 * with infinitely scalable precision, zero rasterization artifacts, and
 * perfect print fidelity.
 */

/**
 * 12-point or N-point Islamic Shamseh Star (شمسه ۱۲ پر صفوی / گره‌چینی).
 * For 12-point Gereh-Chini, standard star parameter is k=5.
 */
export function shamsehD(cx: number, cy: number, R: number, n = 12, k = 5): string {
  const r = (R * Math.cos((Math.PI * k) / n)) / Math.cos((Math.PI * (k - 1)) / n);
  let d = "";
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = (Math.PI * i) / n - Math.PI / 2;
    const x = Math.round((cx + rad * Math.cos(a)) * 100) / 100;
    const y = Math.round((cy + rad * Math.sin(a)) * 100) / 100;
    d += `${i === 0 ? "M" : "L"} ${x} ${y} `;
  }
  return `${d.trim()} Z`;
}

/**
 * Nested Shamseh with inner rosette and central medallion (شمسه چند لایه طلاکوب).
 */
export function multiLayerShamsehD(cx: number, cy: number, R: number): string {
  const outer = shamsehD(cx, cy, R, 12, 5);
  const mid = shamsehD(cx, cy, R * 0.72, 12, 5);
  const inner = shamsehD(cx, cy, R * 0.44, 8, 3);
  return `${outer} ${mid} ${inner}`;
}

/**
 * Persian Carpet Central Medallion (ترنج شاهانه فرش کاشان و تبریز).
 */
export function carpetToranjD(cx: number, cy: number, width: number, height: number): string {
  const rx = width / 2;
  const ry = height / 2;

  // Outer scalloped oval (حاشیه ترنج)
  const nPetals = 16;
  let d = "";
  for (let i = 0; i < nPetals * 2; i++) {
    const angle = (Math.PI * 2 * i) / (nPetals * 2);
    const radFactor = i % 2 === 0 ? 1.0 : 0.82;
    const px = Math.round((cx + rx * radFactor * Math.cos(angle)) * 100) / 100;
    const py = Math.round((cy + ry * radFactor * Math.sin(angle)) * 100) / 100;
    d += `${i === 0 ? "M" : "L"} ${px} ${py} `;
  }
  d += "Z ";

  // Inner 8-point central star
  const innerShamseh = shamsehD(cx, cy, Math.min(rx, ry) * 0.55, 8, 3);
  return `${d.trim()} ${innerShamseh}`;
}

/**
 * Persian Carpet Corner Medallion (لچک گوشه فرش).
 */
export function carpetLachakD(originX: number, originY: number, size: number, corner: "top-left" | "top-right" | "bottom-left" | "bottom-right"): string {
  const sx = corner === "top-left" || corner === "bottom-left" ? 1 : -1;
  const sy = corner === "top-left" || corner === "top-right" ? 1 : -1;

  // Quarter Toranj fan
  let d = `M ${originX} ${originY} `;
  d += `L ${originX + sx * size} ${originY} `;
  d += `Q ${originX + sx * size * 0.8} ${originY + sy * size * 0.35} ${originX + sx * size * 0.65} ${originY + sy * size * 0.65} `;
  d += `Q ${originX + sx * size * 0.35} ${originY + sy * size * 0.8} ${originX} ${originY + sy * size} `;
  d += "Z";
  return d;
}

/**
 * Laser-Cut Wooden Lattice / Mushabbak (شبکه‌بندی مشبک چوب و شش‌ضلعی اسلامی).
 */
export function laserCutLatticeD(startX: number, startY: number, width: number, height: number, cellSize = 48): string {
  let d = "";
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / (cellSize * 0.866));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const offsetX = r % 2 === 1 ? cellSize / 2 : 0;
      const cx = startX + c * cellSize + offsetX;
      const cy = startY + r * cellSize * 0.866;
      if (cx + cellSize / 2 <= startX + width + 10 && cy + cellSize / 2 <= startY + height + 10) {
        const hex = shamsehD(cx, cy, cellSize * 0.44, 6, 2);
        d += `${hex} `;
      }
    }
  }
  return d.trim();
}
