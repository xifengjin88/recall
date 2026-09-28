# Recall

Spaced-repetition study app (quizzes, flashcards, exercises), currently for *The Linux Programming Interface*. The product spec is in `docs/SPEC.md`. The goal is a white-label app with many subjects, so keep product (`app/config.ts`) and subject (`app/content/subject.ts`) separate, and keep the engine and storage subject-agnostic.

## Stack

- React 19, React Router 8 in **framework mode**, running as an **SPA** (`ssr: false` in `react-router.config.ts`). There is no server; progress lives in IndexedDB (Dexie), one database per subject.
  - Routes still get rendered once at build time, so browser APIs (`window`, `localStorage`) may only be touched in effects, event handlers or `clientLoader`, never during render.
- Tailwind CSS v4 (CSS-first config in `app/app.css`) and shadcn/ui (radix-nova preset, lucide icons). Add components with `npx shadcn@latest add <name>`, and don't hand-edit `app/components/ui/*` unless there's a reason.
- Vitest for unit tests of the pure logic in `app/lib`.
- Keep `isbot`: React Router's default server entry needs it for the build-time render, and typegen reinstalls it if it's missing.
- React Router's own docs for the installed version are in `node_modules/react-router/docs/`. Check them before using a router API.

## Layout

- `app/routes.ts`: the route config. Route modules are in `app/routes/`.
- `app/lib/`: pure, framework-free logic (grading, spaced-repetition boxes, mastery, content validation, progress storage and export). This code gets unit tests.
- `app/content/`: study material only. There's one file per chapter (`chNN.ts`), which `app/content/index.ts` discovers with `import.meta.glob`, and `toc.ts` holds the full table of contents. Adding a chapter must be a content-only change.
- `app/content/notes/chNN.md`: optional study notes (Obsidian-flavoured markdown: callouts, `[[wikilinks]]`, tables, mermaid), rendered in the app. Questions link to their section by heading: a note heading starting with the section number (`## 2.7 …`) gets the id `s2.7`. A missing section heading is reported as a content error.
- `app/lib/engine/`: the scheduling engine (Anki classic SM-2). Pure: cards, ratings, presets, `answer()`/`preview()`. Quiz, flashcards and exercises all go through it; per-kind presets can be overridden in Settings (`settings.scheduling`).
- `app/state/progress-store.ts`: in-memory snapshot (`useSyncExternalStore`) plus all mutations; every change is committed to a `ProgressRepo` (`app/state/repo.ts`). `IdbRepo` is IndexedDB; a Postgres-backed repo can implement the same interface. The shell route's `clientLoader` awaits `initProgress()`.
- Keyboard shortcuts go through `app/hooks/use-hotkeys.ts`. Each route lists its shortcuts in `handle.shortcuts`, which the `?` overlay reads.
- Question and exercise ids (e.g. `ch02-q014`) are permanent, because progress is keyed on them. Never renumber or reuse an id. Set `retired: true` instead.

## Dependencies

- After installing or upgrading any package, run `npm run security`. It runs `npm audit`, `npm audit signatures` (registry signatures and provenance) and an OSV.dev CVE lookup of every installed version. Don't leave a known vulnerability in place: pin a fixed version or pick another package, and tell the user.

## Commands

- `npm run dev`: start the dev server
- `npm test`: run the unit tests (vitest)
- `npm run typecheck`: generate route types, then run `tsc`
- `npm run build`: produce the static SPA in `build/client/`
- `npm run security`: dependency vulnerability and signature checks
