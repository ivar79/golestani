import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression suite for the showcase-edit transport (E2E finding, 2026-10-11).
 *
 * A multipart PUT never reaches Laravel with a parsed body — PHP only parses
 * multipart bodies for POST — so `updateShowcase` used to send an empty
 * payload and every owner edit failed validation with 422 ("title field is
 * required"). The upload must travel as POST + _method=PUT, the same spoofing
 * rule lib/api.ts documents for file-bearing updates.
 */

const post = vi.fn(() => Promise.resolve({ data: { id: 7, title: "t" } }));
const put = vi.fn(() => Promise.resolve({ data: { id: 7, title: "t" } }));

vi.mock("@/lib/api", () => ({
  default: { post, put, get: vi.fn(), delete: vi.fn() },
  extractApiError: vi.fn(),
}));

describe("updateShowcase transport", () => {
  beforeEach(() => {
    post.mockClear();
    put.mockClear();
  });

  it("sends the image-bearing edit as POST with a _method=PUT spoof field", async () => {
    const { updateShowcase } = await import("./businesses");
    const form = new FormData();
    form.set("title", "آیتم ویرایش‌شده");
    form.set("price", "123000");
    form.set("description", "توضیح");

    await updateShowcase(7, form);

    expect(put).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0] as unknown as [string, FormData];
    expect(url).toBe("/showcases/7");
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("title")).toBe("آیتم ویرایش‌شده");
    expect(body.get("price")).toBe("123000");
    expect(body.get("_method")).toBe("PUT");
  });

  it("keeps a newly attached file in the same request", async () => {
    const { updateShowcase } = await import("./businesses");
    const form = new FormData();
    form.set("title", "با تصویر تازه");
    form.set("image", new File(["png"], "new.png", { type: "image/png" }));

    await updateShowcase(9, form);

    const [, body] = post.mock.calls[0] as unknown as [string, FormData];
    expect(body.get("image")).toBeInstanceOf(File);
    expect(body.get("_method")).toBe("PUT");
  });
});
