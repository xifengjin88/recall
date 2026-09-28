import { useEffect, useRef, type RefObject } from "react";

/** Keyed by `KeyboardEvent.key` ("j", "Enter", "Escape", " ", "?", "ArrowDown", "J" …). */
export type HotkeyMap = Partial<Record<string, (e: KeyboardEvent) => void>>;

function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "range"].includes(el.type);
  return (el as HTMLElement).isContentEditable;
}

/** Buttons, links etc. handle Enter/Space natively. `data-enter-submits` opts out so Enter reaches the hotkey. */
function handlesEnterNatively(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  if ((el as HTMLElement).dataset?.enterSubmits !== undefined) return false;
  return !!el.closest("button, a[href], [role='button'], [role='checkbox'], [role='switch'], [role='tab'], summary");
}

const dialogOpen = () => !!document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']");

/**
 * Document-level shortcuts (spec §4). Disabled while typing in a text field
 * (except Enter and Escape), while a dialog is open, and when a modifier other
 * than Shift is held. The handler map can change every render.
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = useRef(map);
  ref.current = map;

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (dialogOpen()) return;
      const target = document.activeElement;
      const isEnterish = e.key === "Enter" || e.key === "Escape";
      if (isTextField(target) && !isEnterish) return;
      if ((e.key === "Enter" || e.key === " ") && handlesEnterNatively(target)) return;
      const fn = ref.current[e.key];
      if (!fn) return;
      e.preventDefault();
      fn(e);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Move focus between `[data-nav]` elements inside `container` with j/k and ↓/↑. */
export function useListNav(container: RefObject<HTMLElement | null>, enabled = true) {
  const move = (delta: number) => {
    const el = container.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>("[data-nav]:not([disabled])")];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = i === -1 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, i + delta));
    items[next].focus();
    items[next].scrollIntoView({ block: "nearest" });
  };
  useHotkeys({ j: () => move(1), ArrowDown: () => move(1), k: () => move(-1), ArrowUp: () => move(-1) }, enabled);
}
