// @vitest-environment jsdom
/**
 * Signing in must not log you back out.
 *
 * `AuthProvider` lives in the root layout, so a client-side route change never
 * unmounts it — the `active` guard cannot stop a request that the navigation
 * itself aborted. The effect therefore treated every `/auth/me` rejection as
 * "the session is over" and wiped the token. The everyday failure is
 * `net::ERR_ABORTED`: sign in, navigate to another route, and the in-flight
 * `/auth/me` is cancelled — which bounced a user with a perfectly valid token
 * straight back to /login.
 *
 * Only a real 401 may end the session.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { AuthProvider, useAuth } from "../AuthContext";
import { TOKEN_KEY } from "@/lib/session";

const getMe = vi.fn();
vi.mock("@/lib/auth", () => ({
  getMe: (...args: unknown[]) => getMe(...args),
  logout: vi.fn(),
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  loginAdmin: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}));

afterEach(() => {
  cleanup();
  getMe.mockReset();
  // The tab token lives in sessionStorage now; clear both so tests stay isolated.
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/** The shape axios rejects with when the browser cancels an XHR. */
function aborted() {
  return new AxiosError("canceled", AxiosError.ERR_CANCELED, undefined, undefined, undefined);
}

function unauthorized() {
  const error = new AxiosError("Request failed with status code 401", undefined, undefined, undefined, undefined);
  error.response = {
    status: 401,
    statusText: "Unauthorized",
    data: { message: "Unauthenticated." },
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

/** An axios-style rejection carrying an HTTP status. */
function errorWithStatus(status: number) {
  const error = new AxiosError(`Request failed with status code ${status}`);
  error.response = {
    status,
    statusText: "Error",
    data: {},
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

function Probe() {
  const { user } = useAuth();
  return <span data-testid="user">{user?.phone ?? "none"}</span>;
}

/** A stored token is adopted on the next tick (the hydration effect defers it). */
async function renderWithToken() {
  window.localStorage.setItem(TOKEN_KEY, "stored-token");
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(getMe).toHaveBeenCalled());
}

describe("AuthProvider — only a real 401 ends the session", () => {
  it("retries /auth/me once when navigation aborts the first request", async () => {
    getMe
      .mockRejectedValueOnce(aborted())
      .mockResolvedValue({ id: 1, phone: "09120000000", username: "shop", avatar: null });
    await renderWithToken();

    await waitFor(() => expect(document.querySelector('[data-testid="user"]')?.textContent).toBe("09120000000"));
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("stored-token");
  });

  it("recovers the stored session after a transient network failure", async () => {
    getMe
      .mockRejectedValueOnce(new AxiosError("Network Error", AxiosError.ERR_NETWORK))
      .mockResolvedValue({ id: 1, phone: "09120000000", username: "shop", avatar: null });
    window.localStorage.setItem(TOKEN_KEY, "stored-token");
    vi.useFakeTimers();
    try {
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(document.querySelector('[data-testid="user"]')?.textContent).toBe("09120000000");
      expect(getMe).toHaveBeenCalledTimes(2);
      expect(window.localStorage.getItem(TOKEN_KEY)).toBe("stored-token");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still ends the session on a genuine 401", async () => {
    getMe.mockRejectedValue(unauthorized());
    await renderWithToken();

    // A real rejection must still clear the token, otherwise an expired token
    // would linger and every page would retry it forever.
    await waitFor(() => expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull());
  });

  it("adopts the user on a healthy response", async () => {
    getMe.mockResolvedValue({ id: 1, phone: "09120000000", username: "shop", avatar: null } as never);
    await renderWithToken();

    await waitFor(() => expect(document.querySelector('[data-testid="user"]')?.textContent).toBe("09120000000"));
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("stored-token");
  });

  it.each([403, 422, 429])("does NOT end the session on a %i", async (status) => {
    getMe.mockRejectedValue(errorWithStatus(status));
    await renderWithToken();

    // A real answer that is not 401 keeps the session; no retry is attempted.
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("stored-token");
  });

  it("does NOT end the session on a 500 and recovers when the API returns", async () => {
    getMe
      .mockRejectedValueOnce(errorWithStatus(500))
      .mockResolvedValue({ id: 1, phone: "09120000000", username: "shop", avatar: null });
    window.localStorage.setItem(TOKEN_KEY, "stored-token");
    vi.useFakeTimers();
    try {
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(document.querySelector('[data-testid="user"]')?.textContent).toBe("09120000000");
      expect(window.localStorage.getItem(TOKEN_KEY)).toBe("stored-token");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT adopt another tab's login (no storage listener)", async () => {
    getMe.mockResolvedValue({ id: 1, phone: "09120000000", username: "shop", avatar: null } as never);
    await renderWithToken();
    await waitFor(() => expect(document.querySelector('[data-testid="user"]')?.textContent).toBe("09120000000"));

    // Another tab signs in as a different account and rewrites the shared slot.
    // Before the fix this fired a `storage` listener that replaced this tab's
    // identity; now this tab must ignore it entirely.
    window.localStorage.setItem(TOKEN_KEY, "other-tab-token");
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: TOKEN_KEY,
          newValue: "other-tab-token",
          oldValue: "stored-token",
          storageArea: window.localStorage,
        }),
      );
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="user"]')?.textContent).toBe("09120000000");
    expect(getMe).toHaveBeenCalledTimes(1);
  });
});