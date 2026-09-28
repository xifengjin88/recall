import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/shell.tsx", [
    index("routes/home.tsx"),
    route("chapters/:number", "routes/chapter.tsx"),
    route("chapters/:number/notes", "routes/notes.tsx"),
    route("session", "routes/session.tsx"),
    route("exercises", "routes/exercises.tsx"),
    route("exercises/:id", "routes/exercise.tsx"),
    route("stats", "routes/stats.tsx"),
    route("settings", "routes/settings.tsx"),
    route("*", "routes/not-found.tsx"),
  ]),
] satisfies RouteConfig;
