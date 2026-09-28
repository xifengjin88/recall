// URLs inside the current course: /c/<slug>/… . Works outside React (e.g. in lib helpers).

import { SUBJECT } from "~/content";

/** `coursePath("/chapters/2")` → "/c/tlpi/chapters/2"; `coursePath()` → the course home. */
export function coursePath(path = ""): string {
  return `/c/${encodeURIComponent(SUBJECT.id)}${path}`;
}
