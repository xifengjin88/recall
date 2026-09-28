// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { samples } from "~/api/contract";
import { courseDbName, LEGACY_BACKUP_KEY, LEGACY_KEY, readIndexedDb, uploadedFlag } from "./migrate-local";
import * as store from "./progress-store";

/** A database laid out as the Dexie version wrote it (Dexie's version 1 is IndexedDB version 10). */
function makeDexieDb(name: string, rows: Record<string, unknown[]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 10);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of ["cards", "reviews", "sessions", "exercises"]) db.createObjectStore(store, { keyPath: "id" });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(Object.keys(rows), "readwrite");
      for (const [store, items] of Object.entries(rows)) for (const item of items) tx.objectStore(store).put(item);
      tx.oncomplete = () => (db.close(), resolve());
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function dbExists(name: string) {
  return (await indexedDB.databases()).some((d) => d.name === name);
}

const base = "/courses/demo";
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverEmpty = { ...samples.progress, cards: {}, reviews: [], sessions: [], exercises: {}, settings: { ...samples.progress.settings, timeZone: zone } };
const card = samples.review.card;
const review = samples.review.review;

type Call = { method: string; path: string; body: unknown };
function mockApi(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const all: Record<string, unknown> = { [`GET ${base}/scheduling`]: samples.scheduling, ["PATCH /settings"]: samples.settings, ...routes };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = url.replace(/^\/api/, "");
      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
      const hit = all[`${method} ${path}`];
      if (hit === undefined || typeof hit === "number") return new Response("{}", { status: typeof hit === "number" ? hit : 404 });
      return new Response(JSON.stringify(hit), { status: 200 });
    }),
  );
  return calls;
}

beforeEach(async () => {
  store.__resetStoreForTests();
  localStorage.clear();
  for (const d of await indexedDB.databases()) if (d.name) indexedDB.deleteDatabase(d.name);
});
afterEach(() => vi.unstubAllGlobals());

describe("reading the old IndexedDB database", () => {
  it("returns null without creating a database when there is none", async () => {
    expect(await readIndexedDb("nothing")).toBeNull();
    expect(await dbExists(courseDbName("nothing"))).toBe(false);
  });

  it("reads every store back into progress data", async () => {
    await makeDexieDb(courseDbName("demo"), {
      cards: [card],
      reviews: [{ ...review, id: "b", at: 2 }, { ...review, id: "a", at: 1 }],
      sessions: [{ id: "s1", mode: "quiz", startedAt: 1 }],
      exercises: [{ id: "demo-ex01", status: "done", notes: "n", attempt: "first", attemptStartedAt: null, testsPassed: [], hintsRevealed: 0, updatedAt: 1 }],
      meta: [{ key: "lastChapter", value: 1 }, { key: "settings", value: { theme: "dark", showKeyHints: false, scheduling: { question: { newPerDay: 7 } } } }],
    });
    const got = (await readIndexedDb("demo"))!;
    expect(got.cards[card.id]).toEqual(card);
    expect(got.reviews.map((r) => r.id)).toEqual(["a", "b"]);
    expect(got.exercises["demo-ex01"]).toMatchObject({ status: "done", notes: "n" });
    expect(got.settings.scheduling).toEqual({ question: { newPerDay: 7 } });
    expect(got.lastChapter).toBe(1);
  });
});

describe("the one-time upload on course load", () => {
  it("replaces into an empty server, keeps the browser copy, and shows the notice once", async () => {
    await makeDexieDb(courseDbName("demo"), { cards: [card], reviews: [review] });
    const calls = mockApi({ [`GET ${base}/progress`]: serverEmpty, [`PUT ${base}/progress`]: { progress: samples.progress, skipped: 0 } });
    await store.loadCourseProgress("demo");
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ mode: "replace", file: { version: 2, cards: { [card.id]: card }, reviews: [review] } });
    expect(store.getProgress().cards[card.id]).toEqual(samples.progress.cards[card.id]);
    expect(store.getStatus().notice).toBe("migrated");
    expect(localStorage.getItem(uploadedFlag("demo"))).not.toBeNull();
    expect(await dbExists(courseDbName("demo"))).toBe(true); // backup kept

    store.__resetStoreForTests();
    const again = mockApi({ [`GET ${base}/progress`]: samples.progress });
    await store.loadCourseProgress("demo");
    expect(again.some((c) => c.method === "PUT")).toBe(false);
    expect(store.getStatus().notice).toBeNull();
  });

  it("merges when the server already has progress for the course", async () => {
    await makeDexieDb(courseDbName("demo"), { cards: [card] });
    const calls = mockApi({ [`GET ${base}/progress`]: samples.progress, [`PUT ${base}/progress`]: { progress: samples.progress, skipped: 0 } });
    await store.loadCourseProgress("demo");
    expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ mode: "merge" });
  });

  it("keeps trying on later loads when the upload fails, and still opens the course", async () => {
    await makeDexieDb(courseDbName("demo"), { cards: [card] });
    mockApi({ [`GET ${base}/progress`]: serverEmpty, [`PUT ${base}/progress`]: 500 });
    await store.loadCourseProgress("demo");
    expect(store.getStatus()).toMatchObject({ ready: true, notice: "upload-failed" });
    expect(localStorage.getItem(uploadedFlag("demo"))).toBeNull();
  });

  it("marks a course with nothing in this browser as done without asking the server", async () => {
    const calls = mockApi({ [`GET ${base}/progress`]: serverEmpty });
    await store.loadCourseProgress("demo");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    expect(localStorage.getItem(uploadedFlag("demo"))).not.toBeNull();
    expect(store.getStatus().notice).toBeNull();
  });

  it("uploads the first version's localStorage progress for TLPI and keeps it as a backup", async () => {
    const v1 = { version: 1, items: { "ch02-q001": { box: 2, due: "2026-10-01", mistake: false, updatedAt: 5 } }, attempts: [] };
    localStorage.setItem(LEGACY_KEY, JSON.stringify(v1));
    const tlpi = "/courses/tlpi";
    const calls = mockApi({
      [`GET ${tlpi}/progress`]: serverEmpty,
      [`GET ${tlpi}/scheduling`]: samples.scheduling,
      [`PUT ${tlpi}/progress`]: { progress: serverEmpty, skipped: 0 },
    });
    await store.loadCourseProgress("tlpi");
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ mode: "replace", file: v1 });
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(LEGACY_BACKUP_KEY)!)).toEqual(v1);
  });
});
