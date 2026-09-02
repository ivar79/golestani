"use client";

import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

/**
 * Fix Leaflet's default marker icons: the bundled CSS references relative
 * image paths that bundlers rewrite, producing broken markers. Pointing the
 * icon paths at the bundled assets explicitly resolves this.
 *
 * This module is imported ONLY from MapView.tsx, which itself is loaded via
 * dynamic import with ssr:false — so Leaflet never executes during SSR.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x.src ?? markerIcon2x,
  iconUrl: markerIcon.src ?? markerIcon,
  shadowUrl: markerShadow.src ?? markerShadow,
});
