/**
 * SaveQueue — serializes document saves so rapid edits can never race.
 *
 * The card editor persists with a debounced autosave PLUS manual saves
 * (button / Ctrl+S). Without coordination, two PUTs can be in flight at
 * once and their RESOLUTION order is not the request order — a slow older
 * request would land after a faster newer one and overwrite newer work.
 *
 * Contract (exactly one in flight, newest payload always next):
 *   - `save(task)` runs `task` immediately when idle, or REPLACES the
 *     pending task (so only the newest document is ever written);
 *   - at most one task executes at a time, so responses are applied in a
 *     strict, known order;
 *   - each task receives a guard; `isCurrent()` is false once a NEWER task
 *     has started, so a stale completion must not touch save state.
 *
 * The task owns its own error surface (throwing is caught here purely so
 * the queue survives — the next queued save still runs).
 */

export interface SaveGuard {
  /** False once a newer save has started; stale results must be ignored. */
  isCurrent: () => boolean;
}

export type SaveTask = (guard: SaveGuard) => Promise<void>;

export class SaveQueue {
  private seq = 0;
  private busy = false;
  private queued: SaveTask | null = null;

  /** Enqueue a save. When one is already running, this task replaces any
   *  older queued one — the newest document is the only one worth saving. */
  save(task: SaveTask): void {
    this.queued = task;
    if (!this.busy) void this.flush();
  }

  /** True while a save request is on the wire (the header status pill). */
  get isBusy(): boolean {
    return this.busy;
  }

  private async flush(): Promise<void> {
    this.busy = true;
    try {
      // Drain until nothing newer arrives — a task queued while a save runs
      // executes right after it (in request order, never concurrently).
      while (this.queued !== null) {
        const task = this.queued;
        this.queued = null;
        const seq = ++this.seq;
        const guard: SaveGuard = { isCurrent: () => this.seq === seq };
        try {
          await task(guard);
        } catch {
          // The task reports its own failure; the queue must stay usable.
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
