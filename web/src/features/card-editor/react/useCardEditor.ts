"use client";

/**
 * useCardEditor — React binding for the pure EditorEngine.
 *
 * useSyncExternalStore keeps the engine as the single source of truth:
 * React re-renders on engine emits, and UI actions are engine calls only
 * (no duplicated state). Selection is view state — it lives in the engine
 * but never inside undo history.
 */

import { useCallback, useSyncExternalStore } from "react";
import { EditorEngine, type EngineState } from "../engine/EditorEngine";

export function useCardEditor(engine: EditorEngine): EngineState {
  const subscribe = useCallback((listener: () => void) => engine.subscribe(listener), [engine]);
  const getSnapshot = useCallback(() => engine.getState(), [engine]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
