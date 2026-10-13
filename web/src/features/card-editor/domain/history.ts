/**
 * HistoryStack — bounded undo/redo with drag-friendly semantics.
 *
 * Model (filerobot/onerkiz analysis — implementation is original):
 *   - Pre-state recording: commit() stores the state as it was BEFORE the
 *     change; undo() restores it and moves the current state to future.
 *   - replace: consecutive commits with the same group key are skipped
 *     (the gesture's start state is recorded once — one drag = ONE record).
 *   - Bounded stack (cap 50) — memory stays flat in long sessions.
 *   - Selection/viewport are never stored here (view state ≠ design state).
 */

export type HistoryEntry = {
  doc: string;
  /** Coalescing group: consecutive commits with the same key merge. */
  group: string | null;
};

export class HistoryStack {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  constructor(private readonly cap = 50) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get depth(): number {
    return this.past.length;
  }

  /**
   * Record a pre-change state. Returns true when history changed.
   * Same-group commits during one gesture are skipped (replace semantics).
   */
  commit(doc: string, options: { group?: string | null } = {}): boolean {
    const group = options.group ?? null;
    const top = this.past[this.past.length - 1];
    if (group && top && top.group === group) {
      this.future = [];
      return false;
    }
    this.past.push({ doc, group });
    if (this.past.length > this.cap) {
      this.past.shift();
    }
    this.future = [];
    return true;
  }

  /** Undo: current becomes the redo target; returns the state to restore. */
  undo(current: string): string | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ doc: current, group: null });
    return entry.doc;
  }

  /** Redo: current returns to past; returns the state to restore. */
  redo(current: string): string | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ doc: current, group: null });
    return entry.doc;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  /**
   * Close the current coalescing run: the top record stops matching its group
   * key, so the next same-group commit starts a fresh record. Used to make one
   * typing run (or one slider gesture) a single undo step without letting the
   * following run merge into it.
   */
  sealGroup(): void {
    const top = this.past[this.past.length - 1];
    if (top && top.group !== null) top.group = null;
  }
}
