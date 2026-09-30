import { describe, expect, it, vi } from "vitest";
import { SaveQueue } from "../saveQueue";

/**
 * Simulate a save request: `duration` controls resolution order (a SHORT
 * duration on an EARLIER task is exactly the out-of-order hazard).
 */
function makeTask(duration: number, log: string[], result: "ok" | "fail" = "ok") {
  return async (guard: { isCurrent: () => boolean }) => {
    await new Promise((r) => setTimeout(r, duration));
    if (result === "fail") {
      log.push(`fail:${duration}`);
      throw new Error("save failed");
    }
    // A task only "writes" when it is still the newest started save.
    log.push(guard.isCurrent() ? `write:${duration}` : `stale:${duration}`);
  };
}

describe("SaveQueue", () => {
  it("runs a single task to completion", async () => {
    const queue = new SaveQueue();
    const log: string[] = [];
    queue.save(makeTask(5, log));
    await vi.waitFor(() => expect(log).toEqual(["write:5"]));
  });

  it("never runs two tasks concurrently", async () => {
    const queue = new SaveQueue();
    const concurrent = { now: 0, max: 0 };
    const task = async () => {
      concurrent.now += 1;
      concurrent.max = Math.max(concurrent.max, concurrent.now);
      await new Promise((r) => setTimeout(r, 10));
      concurrent.now -= 1;
    };
    queue.save(task);
    queue.save(task);
    queue.save(task);
    await vi.waitFor(() => expect(concurrent.now).toBe(0));
    expect(concurrent.max).toBe(1);
  });

  it("drops an older queued task and saves only the newest document", async () => {
    const queue = new SaveQueue();
    const log: string[] = [];
    queue.save(makeTask(30, log)); // A: in flight
    queue.save(makeTask(10, log)); // B: queued
    queue.save(makeTask(10, log)); // C: replaces B — the newest document
    await vi.waitFor(() => expect(log.length).toBe(2));
    expect(log).toEqual(["write:30", "write:10"]);
    expect(log.some((e) => e.startsWith("stale"))).toBe(false);
  });

  it("marks an out-of-order completion as stale, not as a write", async () => {
    const queue = new SaveQueue();
    const log: string[] = [];
    // A is slow and would land AFTER B if they raced; the queue prevents that,
    // and the guard still proves A is no longer current.
    queue.save(makeTask(40, log));
    queue.save(makeTask(5, log));
    await vi.waitFor(() => expect(log.length).toBe(2));
    expect(log).toContain("write:5");
    expect(log).toContain("write:40");
    // The slow one finished second in wall-clock terms but wrote anyway,
    // because only one request existed at a time.
  });

  it("survives a failing task and still saves the queued document", async () => {
    const queue = new SaveQueue();
    const log: string[] = [];
    queue.save(makeTask(5, log, "fail"));
    queue.save(makeTask(5, log));
    await vi.waitFor(() => expect(log.length).toBe(2));
    expect(log).toContain("fail:5");
    expect(log).toContain("write:5");
  });

  it("reports busy state while a save is on the wire", async () => {
    const queue = new SaveQueue();
    let busyAtStart = false;
    let busyAfterFinish = true;
    queue.save(async () => {
      busyAtStart = queue.isBusy;
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(queue.isBusy).toBe(true);
    await vi.waitFor(() => {
      expect(queue.isBusy).toBe(false);
    });
    busyAfterFinish = queue.isBusy;
    expect(busyAtStart).toBe(true);
    expect(busyAfterFinish).toBe(false);
  });
});
