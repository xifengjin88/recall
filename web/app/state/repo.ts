import type { Card } from "~/lib/engine";
import { emptyProgress, type ExerciseState, type ProgressData, type ReviewRecord, type SessionPrefs, type SessionRecord, type Settings } from "~/lib/progress";

/** Small key/value records that don't need their own table. */
export interface Meta {
  settings: Settings;
  prefs: SessionPrefs;
  lastChapter: number | null;
}

/** One atomic write. Everything in it lands together or not at all. */
export interface Changes {
  cards?: Card[];
  reviews?: ReviewRecord[];
  sessions?: SessionRecord[];
  exercises?: Record<string, ExerciseState>;
  meta?: Partial<Meta>;
  /** Item ids whose cards, exercise state and reviews should be deleted. */
  deleteItems?: string[];
}

/**
 * Where progress is persisted. The store keeps an in-memory copy for rendering and
 * sends every change here. IndexedDB today; a Postgres-backed API can implement the
 * same interface later.
 */
export interface ProgressRepo {
  readonly name: string;
  /** Everything, or null when nothing has been saved yet. */
  load(): Promise<ProgressData | null>;
  commit(changes: Changes): Promise<void>;
  replaceAll(data: ProgressData): Promise<void>;
}

/** Keeps data for this page load only (tests, or when IndexedDB is unavailable). */
export class MemoryRepo implements ProgressRepo {
  readonly name = "memory";
  private data: ProgressData | null = null;

  async load() {
    return this.data ? structuredClone(this.data) : null;
  }

  async commit(c: Changes) {
    const d = this.data ?? emptyProgress();
    for (const card of c.cards ?? []) d.cards[card.id] = card;
    for (const r of c.reviews ?? []) {
      const i = d.reviews.findIndex((x) => x.id === r.id);
      if (i >= 0) d.reviews[i] = r;
      else d.reviews.push(r);
    }
    for (const s of c.sessions ?? []) {
      const i = d.sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) d.sessions[i] = s;
      else d.sessions.push(s);
    }
    Object.assign(d.exercises, c.exercises ?? {});
    Object.assign(d, c.meta ?? {});
    if (c.deleteItems?.length) {
      const ids = new Set(c.deleteItems);
      for (const id of ids) {
        delete d.cards[id];
        delete d.exercises[id];
      }
      d.reviews = d.reviews.filter((r) => !ids.has(r.cardId));
    }
    this.data = structuredClone(d);
  }

  async replaceAll(data: ProgressData) {
    this.data = structuredClone(data);
  }
}
