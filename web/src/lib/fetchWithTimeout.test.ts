import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, isTimeoutError, TimeoutError } from "./fetchWithTimeout";

const originalFetch = globalThis.fetch;

/** A fetch that never settles until its signal aborts (a saturated server). */
function hangingFetch(): void {
  globalThis.fetch = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        // fetch() rejects immediately on an already-aborted signal, so the fake
        // must too — otherwise the test would hang instead of exercising the
        // pre-aborted path.
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("passes a normal response straight through", async () => {
    const response = new Response("{}", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch;

    await expect(fetchWithTimeout("http://example.test/x")).resolves.toBe(response);
  });

  it("raises TimeoutError when the deadline passes", async () => {
    vi.useFakeTimers();
    hangingFetch();

    const pending = fetchWithTimeout("http://example.test/slow", {}, 1000);
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("re-throws the caller's abort untouched so unmounts stay silent", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const controller = new AbortController();

    const pending = fetchWithTimeout("http://example.test/slow", { signal: controller.signal }, 60000);
    controller.abort();
    const error = await pending.catch((caught: unknown) => caught);

    expect((error as Error).name).toBe("AbortError");
    expect(isTimeoutError(error)).toBe(false);
  });

  it("treats an already-aborted caller signal as a cancel, not a timeout", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const controller = new AbortController();
    controller.abort();

    const error = await fetchWithTimeout("http://example.test/x", { signal: controller.signal }, 60000)
      .catch((caught: unknown) => caught);

    expect(isTimeoutError(error)).toBe(false);
  });

  it("clears its timer on success (no dangling deadline fires later)", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}")) as unknown as typeof fetch;

    await fetchWithTimeout("http://example.test/x", {}, 1000);

    expect(vi.getTimerCount()).toBe(0);
  });
});
