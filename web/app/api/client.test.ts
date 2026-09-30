import { afterEach, describe, expect, it, vi } from "vitest";
import { validateBook } from "~/lib/validate";
import { api, ApiError } from "./client";
import { samples } from "./contract";

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns parsed JSON and calls /api paths", async () => {
    const fetchMock = mockFetch(200, samples.courses);
    await expect(api.courses()).resolves.toEqual(samples.courses);
    expect(fetchMock).toHaveBeenCalledWith("/api/courses", expect.objectContaining({ headers: { Accept: "application/json" } }));
  });

  it("turns API errors into ApiError with the server's code and message", async () => {
    mockFetch(404, samples.error);
    const err = await api.course("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "course_not_found", message: 'No course with slug "nope".' });
  });

  it("accepts an empty 204 reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api.setLastUnit("demo", 1)).resolves.toBeUndefined();
  });

  it("reports an unreachable server clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(api.courses()).rejects.toMatchObject({ code: "network_error" });
  });
});

describe("contract", () => {
  it("served content passes the app's own content validation", () => {
    const { chapters, errors } = validateBook(samples.content.chapters);
    expect(errors).toEqual([]);
    expect(chapters[0].questions.map((q) => q.type)).toEqual(["single", "multi", "truefalse", "typed", "output", "output", "order", "match"]);
    expect(chapters[0].exercises[0].tests).toHaveLength(2);
  });
});
