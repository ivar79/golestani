import { afterEach, describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { retryTransient } from "./api";

afterEach(() => {
  vi.useRealTimers();
});

describe("retryTransient", () => {
  it("retries a network failure and resolves from the next attempt", async () => {
    vi.useFakeTimers();
    const run = vi.fn()
      .mockRejectedValueOnce(new AxiosError("Network Error", AxiosError.ERR_NETWORK))
      .mockResolvedValue("ok");

    const result = retryTransient(run, [600]);
    await vi.advanceTimersByTimeAsync(600);

    await expect(result).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not retry an HTTP client error", async () => {
    const error = new AxiosError("Forbidden");
    error.response = {
      status: 403,
      statusText: "Forbidden",
      data: {},
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    };
    const run = vi.fn().mockRejectedValue(error);

    await expect(retryTransient(run)).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
