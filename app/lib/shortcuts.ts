export interface Shortcut {
  keys: string[];
  label: string;
}

/** Route modules export `handle: RouteHandle`; the help overlay reads the deepest one. */
export interface RouteHandle {
  screen?: string;
  shortcuts?: Shortcut[];
}

export const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: ["g", "h"], label: "Go home" },
  { keys: ["g", "s"], label: "Go to stats" },
  { keys: ["?"], label: "Keyboard help" },
  { keys: ["Esc"], label: "Close overlay" },
];

export const LIST_SHORTCUTS: Shortcut[] = [
  { keys: ["j", "k"], label: "Move selection (or ↓ ↑)" },
  { keys: ["Enter"], label: "Open selected" },
];
