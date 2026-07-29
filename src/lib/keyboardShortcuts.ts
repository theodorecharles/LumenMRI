// Focus-aware guards for the global viewer keydown handler in App.tsx.
//
// Clicking a toolbar control leaves that button focused, so the handler must
// distinguish "the focused element already owns this key" from "the focused
// element happens to be a button". Bailing on the whole handler kills every
// advertised shortcut until the user clicks empty canvas.

/** Keys a focusable control activates on, so the viewer must not double-handle them. */
const ACTIVATION_KEYS = new Set([' ', 'Spacebar', 'Enter'])

/** Typing surfaces swallow every viewer shortcut, including `?` and Escape. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  // jsdom leaves `isContentEditable` undefined; fall back to the attribute.
  const editable = target.getAttribute('contenteditable')
  return editable !== null && editable !== 'false'
}

/**
 * True when the focused element natively activates on `key` — Space/Enter on a
 * button or `role="button"`, Enter on a link. Only those combinations may skip
 * the viewer shortcuts; letters, digits, arrows and Home/End must still run.
 */
export function targetActivatesOnKey(target: EventTarget | null, key: string): boolean {
  if (!ACTIVATION_KEYS.has(key)) return false
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLButtonElement) return true
  if (target.getAttribute('role') === 'button') return true
  if (target instanceof HTMLAnchorElement) return key === 'Enter'
  return false
}
