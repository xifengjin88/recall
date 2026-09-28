# Recall

Spaced-repetition study app: quizzes, flashcards and exercises scheduled by one Anki-style (SM-2) engine. Currently loaded with *The Linux Programming Interface*. See `docs/SPEC.md`.

React 19 · React Router 8 (framework mode, SPA) · Tailwind v4 · shadcn/ui · Dexie (IndexedDB) · Vitest. Progress stays in the browser.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for app/lib
npm run typecheck
npm run build      # static site in build/client/
npm run security   # npm audit + signatures + OSV.dev CVE lookup
```

## Adding content

Create `app/content/chNN.ts` that default-exports a `Chapter` (see `app/lib/types.ts` and `app/content/ch02.ts`). It's discovered automatically, and nothing else needs to change. Question ids are permanent: never renumber them, and set `retired: true` to hide one.

Study notes go in `app/content/notes/chNN.md` (Obsidian-style markdown). Start each section heading with its number, e.g. `## 2.7 Processes`, so "See in notes" can find it.

Content problems (duplicate ids, answer not in options, …) show in a banner and the broken item is skipped.

## Deploy

`docker build -t tlpi-drill . && docker run -p 8080:80 tlpi-drill`. Or serve `build/client/` from any static host with a fallback to `index.html`.
