// One-time upload of progress saved in this browser before the server kept it (SPEC-web-client.md).
//
// Before Milestone 1 each course's progress lived in an IndexedDB database named `recall-<slug>`
// (written with Dexie: stores cards, reviews, sessions, exercises, meta), and before that in one
// localStorage key. This reads them with the plain IndexedDB API and never deletes them: the
// browser copy stays as a backup. A localStorage flag records that a course was uploaded.

import { APP } from "~/config";
import { emptyProgress, type ProgressData } from "~/lib/progress";

export const courseDbName = (slug: string) => `${APP.id}-${slug}`;
export const uploadedFlag = (slug: string) => `${APP.id}:${slug}:uploaded-to-server`;

/** The first version kept TLPI progress in this localStorage key (format v1). */
export const LEGACY_KEY = "tlpi-drill:progress";
export const LEGACY_COURSE = "tlpi";
export const LEGACY_BACKUP_KEY = `${LEGACY_KEY}:migrated-to-server`;

const STORES = ["cards", "reviews", "sessions", "exercises", "meta"] as const;

/** Opens a database only if it already exists (a plain open would create an empty one). */
function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let missing = false;
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => {
      missing = true;
      req.transaction?.abort(); // leaves no database behind
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => (missing ? resolve(null) : reject(req.error));
    req.onblocked = () => reject(new Error(`IndexedDB "${name}" is blocked by another tab`));
  });
}

function getAll(db: IDBDatabase, store: string): Promise<unknown[]> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as unknown[]);
    req.onerror = () => reject(req.error);
  });
}

/** A course's progress from its IndexedDB database, or null when there is none (or it's empty). */
export async function readIndexedDb(slug: string): Promise<ProgressData | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openExisting(courseDbName(slug));
  if (!db) return null;
  try {
    const [cards, reviews, sessions, exercises, meta] = await Promise.all(STORES.map((s) => getAll(db, s)));
    if (!cards.length && !reviews.length && !sessions.length && !exercises.length && !meta.length) return null;
    const out = emptyProgress();
    for (const c of cards as ProgressData["cards"][string][]) out.cards[c.id] = c;
    out.reviews = (reviews as ProgressData["reviews"]).sort((a, b) => a.at - b.at);
    out.sessions = (sessions as ProgressData["sessions"]).sort((a, b) => a.startedAt - b.startedAt);
    for (const { id, ...state } of exercises as ({ id: string } & ProgressData["exercises"][string])[]) out.exercises[id] = state;
    for (const { key, value } of meta as { key: string; value: unknown }[]) (out as unknown as Record<string, unknown>)[key] = value;
    return out;
  } finally {
    db.close();
  }
}

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function isUploaded(slug: string): boolean {
  return storage()?.getItem(uploadedFlag(slug)) != null;
}

/** Everything this browser holds for a course, oldest format first, as files the server imports. */
export async function localFiles(slug: string): Promise<unknown[]> {
  const files: unknown[] = [];
  const legacy = slug === LEGACY_COURSE ? storage()?.getItem(LEGACY_KEY) : null;
  if (legacy) {
    try {
      files.push(JSON.parse(legacy));
    } catch {
      // unreadable: leave it where it is
    }
  }
  const idb = await readIndexedDb(slug);
  if (idb) files.push(idb);
  return files;
}

/** After a successful upload: remember it, and move the legacy key aside (kept as a backup). */
export function markUploaded(slug: string) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(uploadedFlag(slug), new Date().toISOString());
    const legacy = slug === LEGACY_COURSE ? s.getItem(LEGACY_KEY) : null;
    if (legacy) {
      s.setItem(LEGACY_BACKUP_KEY, legacy);
      s.removeItem(LEGACY_KEY);
    }
  } catch {
    // storage full or blocked: the next load uploads again, which merges to the same result
  }
}
