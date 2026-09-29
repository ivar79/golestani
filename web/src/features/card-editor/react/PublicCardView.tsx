"use client";

/**
 * PublicCardView — the published card on `/b/[slug]`.
 *
 * Read-only and unauthenticated: it renders the SAME document projection as the
 * editor stage and the export surface (`LayeredCard`), scaled to fit its
 * container, so a card looks identical wherever it is seen.
 *
 * The design/legacy decision is made ONCE on the server by the pure
 * `resolveCardRender` and passed in as a plan, so the page can log/annotate an
 * invalid document while this component only renders.
 *
 * No interactivity: no selection, handles, guides or hit areas.
 */

import { useEffect, useRef, useState } from "react";
import type { Business } from "@/lib/businesses";
import type { CardRenderPlan } from "@/lib/publicCard";
import CardCanvas from "@/components/cards/CardCanvas";
import { LayeredCard } from "./LayeredCardRenderer";

export function PublicCardView({
  business,
  plan,
}: {
  business: Business;
  plan: CardRenderPlan;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  const design = plan.mode === "design" ? plan.design : null;
  const artboardWidth = design?.artboard.width ?? 0;
  const artboardHeight = design?.artboard.height ?? 0;

  // Fit the fixed design artboard (1050×600) into the available width.
  useEffect(() => {
    if (!design) return;
    const el = frameRef.current;
    if (!el) return;
    const fit = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      setScale(Number(Math.min(1, width / design.artboard.width).toFixed(4)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [design]);

  if (plan.mode === "legacy") {
    // Pre-editor cards keep the template renderer, unchanged.
    return (
      <CardCanvas
        business={business}
        template={plan.template}
        theme={plan.theme}
        fontSize={plan.fontSize}
        fontFamily={plan.fontFamily}
      />
    );
  }

  return (
    <div
      ref={frameRef}
      data-public-card="design"
      className="w-full overflow-hidden"
      // Reserve the exact aspect box before measurement — no layout shift.
      style={{ aspectRatio: `${artboardWidth} / ${artboardHeight}` }}
    >
      {scale > 0 ? <LayeredCard doc={plan.design} scale={scale} /> : null}
    </div>
  );
}

export default PublicCardView;
