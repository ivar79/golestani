/**
 * keyboardGuards — shared predicates for the studio's global keyboard handlers.
 *
 * Two independent bugs came from each `window` keydown listener deciding for
 * itself what "a typing key" and "a modal is open" mean:
 *
 *   1. The shortcuts help overlay is `aria-modal` but was NOT honored by the
 *      stage's handler, so Delete / arrows / Ctrl+D kept mutating the design
 *      behind it. Every handler must agree the overlay swallows editing keys.
 *   2. Shortcuts matched `KeyboardEvent.key` ("z", "s"…), which is the
 *      CHARACTER the layout produces. On a Persian/Arabic layout the physical
 *      Z/S/Y/C/V/D keys emit non-Latin `key` values, so Undo / Redo / Save /
 *      Duplicate / Copy / Paste silently did nothing. `KeyboardEvent.code` is
 *      the physical key and is layout-independent, which is what a shortcut
 *      must be bound to.
 *
 * Pure functions only — no DOM, no React, so they are unit-testable.
 */

/** The shortcuts help overlay is open (present in the DOM). */
export function isShortcutDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector("[data-shortcut-dialog]");
}

/**
 * Focus is in a text-entry surface and the keystroke is the user's content,
 * never a command. `contentEditable` is covered through the HTMLElement check
 * so an editable region nested in a wrapper still counts.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  return el.isContentEditable === true;
}

/**
 * May a global EDITING shortcut (undo/redo/save/tool letters/delete/arrows)
 * run for this event? False while typing OR while the help overlay is open —
 * the overlay is modal, so the document underneath must be frozen.
 */
export function allowEditingShortcut(event: KeyboardEvent): boolean {
  return !isEditableTarget(event.target) && !isShortcutDialogOpen();
}

/**
 * Layout-independent physical-key lookup. `Slash` is included because the
 * `?` help toggle is bound to the physical slash key.
 */
export function codeOf(event: KeyboardEvent): string {
  return (event.code || "").toLowerCase();
}
