// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPrivateAssetCache,
  fetchPrivateAssetUrl,
  isPrivateAssetSrc,
  privateAssetPath,
  releasePrivateAssetUrl,
} from "./privateAsset";

/**
 * Regression suite for the private template artwork path (audit finding
 * `private-template-asset-public-disk`).
 *
 * Beyond "it loads", these tests pin the credential rules: the bearer token
 * must travel in the Authorization header ONLY, a session change must never
 * reuse another principal's bytes, and blob URLs must be revoked once the last
 * consumer releases them.
 */

const TOKEN_KEY = "golestani_token";

function jsonRes(ok: boolean) {
  return { ok } as Response;
}

describe("private asset reference detection", () => {
  it("accepts the private namespace in its canonical forms", () => {
    expect(isPrivateAssetSrc("/storage/templates/users/1/art-abc-v1.png")).toBe(true);
    expect(isPrivateAssetSrc("storage/templates/users/1/art-abc-v1.png")).toBe(true);
    expect(privateAssetPath("/storage/templates/users/1/art-abc-v1.png")).toBe("templates/users/1/art-abc-v1.png");
  });

  it("refuses public namespaces", () => {
    expect(isPrivateAssetSrc("/storage/templates/uploaded/art-abc-v1.png")).toBe(false);
    expect(isPrivateAssetSrc("/storage/templates/optimized/hero-v1.webp")).toBe(false);
    expect(isPrivateAssetSrc("/storage/businesses/1/logo.png")).toBe(false);
    expect(isPrivateAssetSrc("https://evil.test/storage/templates/users/1/x.png")).toBe(false);
    expect(isPrivateAssetSrc("data:image/png;base64,AAAA")).toBe(false);
    expect(isPrivateAssetSrc(null)).toBe(false);
    expect(isPrivateAssetSrc(undefined)).toBe(false);
  });

  it("refuses look-alike and traversal forms", () => {
    expect(isPrivateAssetSrc("/storage/templates/users/1/../../../etc/passwd")).toBe(false);
    expect(isPrivateAssetSrc("/storage/templates/users//1/art.png")).toBe(false);
    expect(isPrivateAssetSrc("/storage/templates/users/1/..%2fart.png")).toBe(false);
    expect(isPrivateAssetSrc("/storage/templates/users/1/art.png?x=1")).toBe(false);
    expect(isPrivateAssetSrc("/storage/templates\\users\\1\\art.png")).toBe(false);
  });
});

describe("fetchPrivateAssetUrl", () => {
  const createObjectURL = vi.fn(() => "blob:http://localhost/private-1");
  const revokeObjectURL = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    window.localStorage.setItem(TOKEN_KEY, "token-user-a");
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    fetchMock.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    clearPrivateAssetCache();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("sends the credential in the Authorization header and never in the URL", async () => {
    fetchMock.mockResolvedValue({ ...jsonRes(true), blob: async () => new Blob(["png"]) });

    const url = await fetchPrivateAssetUrl("/storage/templates/users/1/art-abc-v1.png");

    expect(url).toBe("blob:http://localhost/private-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("/assets/private/templates/users/1/art-abc-v1.png");
    expect(calledUrl).not.toContain("token");
    expect(calledUrl).not.toContain("Bearer");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-user-a");
  });

  it("returns null (placeholder) without a session or for non-private srcs", async () => {
    window.localStorage.removeItem(TOKEN_KEY);
    expect(await fetchPrivateAssetUrl("/storage/templates/users/1/art.png")).toBeNull();

    window.localStorage.setItem(TOKEN_KEY, "token-user-a");
    expect(await fetchPrivateAssetUrl("/storage/templates/uploaded/art.png")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the API refuses (not the owner / not signed in)", async () => {
    fetchMock.mockResolvedValue(jsonRes(false));

    expect(await fetchPrivateAssetUrl("/storage/templates/users/2/art-abc-v1.png")).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("caches per path while the session is unchanged", async () => {
    fetchMock.mockResolvedValue({ ...jsonRes(true), blob: async () => new Blob(["png"]) });
    const src = "/storage/templates/users/1/art-abc-v1.png";

    const first = await fetchPrivateAssetUrl(src);
    const second = await fetchPrivateAssetUrl(src);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never reuses bytes across a session change", async () => {
    fetchMock.mockResolvedValue({ ...jsonRes(true), blob: async () => new Blob(["png"]) });
    const src = "/storage/templates/users/1/art-abc-v1.png";

    createObjectURL.mockReturnValueOnce("blob:first-user");
    const first = await fetchPrivateAssetUrl(src);

    // A different principal signs in: the cached entry must be revoked and
    // re-fetched with the new credential, never served from the old one.
    window.localStorage.setItem(TOKEN_KEY, "token-user-b");
    createObjectURL.mockReturnValueOnce("blob:second-user");
    const second = await fetchPrivateAssetUrl(src);

    expect(first).toBe("blob:first-user");
    expect(second).toBe("blob:second-user");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first-user");
  });

  it("revokes the blob URL when the last consumer releases it", async () => {
    fetchMock.mockResolvedValue({ ...jsonRes(true), blob: async () => new Blob(["png"]) });
    const src = "/storage/templates/users/1/art-abc-v1.png";

    await fetchPrivateAssetUrl(src);
    await fetchPrivateAssetUrl(src); // two consumers

    releasePrivateAssetUrl(src);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    releasePrivateAssetUrl(src);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/private-1");
  });

  it("clears every entry on logout", async () => {
    fetchMock.mockResolvedValue({ ...jsonRes(true), blob: async () => new Blob(["png"]) });
    await fetchPrivateAssetUrl("/storage/templates/users/1/art-abc-v1.png");

    clearPrivateAssetCache();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/private-1");
  });
});
