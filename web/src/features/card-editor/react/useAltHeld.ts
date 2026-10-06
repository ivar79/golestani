import { useEffect, useState } from "react";

/**
 * Live Alt state, as a re-render.
 *
 * Several overlays need it (the bend hit-areas drop out so the press reaches
 * the layer below; the layer hit-area swaps its cursor from the neutral arrow
 * back to `move`), and each of them reads `event.altKey` off a React handler
 * that only re-runs on the next render — so they cannot just look it up once.
 */
export function useAltHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const sync = (event: KeyboardEvent) => setHeld(event.altKey);
    const clear = () => setHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return held;
}