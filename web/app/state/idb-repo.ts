import Dexie, { type Table } from "dexie";
import type { Card } from "~/lib/engine";
import { emptyProgress, type ExerciseState, type ProgressData, type ReviewRecord, type SessionRecord } from "~/lib/progress";
import type { Changes, Meta, ProgressRepo } from "./repo";

interface ExerciseRow extends ExerciseState {
  id: string;
}
interface MetaRow {
  key: keyof Meta;
  value: unknown;
}

class ProgressDb extends Dexie {
  cards!: Table<Card, string>;
  reviews!: Table<ReviewRecord, string>;
  sessions!: Table<SessionRecord, string>;
  exercises!: Table<ExerciseRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string) {
    super(name);
    // Only indexed fields are listed; records can hold anything else.
    this.version(1).stores({
      cards: "id, kind, due",
      reviews: "id, cardId, at, sessionId",
      sessions: "id, startedAt",
      exercises: "id",
      meta: "key",
    });
  }
}

/** One IndexedDB database per subject, so adding subjects never needs a schema change. */
export class IdbRepo implements ProgressRepo {
  readonly name: string;
  private db: ProgressDb;

  constructor(dbName: string) {
    this.name = dbName;
    this.db = new ProgressDb(dbName);
  }

  async load(): Promise<ProgressData | null> {
    const db = this.db;
    return db.transaction("r", [db.cards, db.reviews, db.sessions, db.exercises, db.meta], async () => {
      const [cards, reviews, sessions, exercises, meta] = await Promise.all([
        db.cards.toArray(),
        db.reviews.orderBy("at").toArray(),
        db.sessions.orderBy("startedAt").toArray(),
        db.exercises.toArray(),
        db.meta.toArray(),
      ]);
      if (!cards.length && !reviews.length && !sessions.length && !exercises.length && !meta.length) return null;
      const out = emptyProgress();
      for (const c of cards) out.cards[c.id] = c;
      out.reviews = reviews;
      out.sessions = sessions;
      for (const { id, ...state } of exercises) out.exercises[id] = state;
      for (const m of meta) (out as unknown as Record<string, unknown>)[m.key] = m.value;
      return out;
    });
  }

  async commit(c: Changes): Promise<void> {
    const db = this.db;
    await db.transaction("rw", [db.cards, db.reviews, db.sessions, db.exercises, db.meta], async () => {
      if (c.deleteItems?.length) {
        await db.cards.bulkDelete(c.deleteItems);
        await db.exercises.bulkDelete(c.deleteItems);
        await db.reviews.where("cardId").anyOf(c.deleteItems).delete();
      }
      if (c.cards?.length) await db.cards.bulkPut(c.cards);
      if (c.reviews?.length) await db.reviews.bulkPut(c.reviews);
      if (c.sessions?.length) await db.sessions.bulkPut(c.sessions);
      const ex = Object.entries(c.exercises ?? {});
      if (ex.length) await db.exercises.bulkPut(ex.map(([id, s]) => ({ ...s, id })));
      const meta = Object.entries(c.meta ?? {}) as [keyof Meta, unknown][];
      if (meta.length) await db.meta.bulkPut(meta.map(([key, value]) => ({ key, value })));
    });
  }

  /** Atomic: the clear and the refill share one transaction (Dexie nests commit's). */
  async replaceAll(data: ProgressData): Promise<void> {
    const db = this.db;
    await db.transaction("rw", [db.cards, db.reviews, db.sessions, db.exercises, db.meta], async () => {
      await Promise.all([db.cards.clear(), db.reviews.clear(), db.sessions.clear(), db.exercises.clear(), db.meta.clear()]);
      await this.commit({
        cards: Object.values(data.cards),
        reviews: data.reviews,
        sessions: data.sessions,
        exercises: data.exercises,
        meta: { settings: data.settings, prefs: data.prefs, lastChapter: data.lastChapter },
      });
    });
  }

  /** Mainly for tests. */
  async destroy() {
    await this.db.delete();
  }
}
