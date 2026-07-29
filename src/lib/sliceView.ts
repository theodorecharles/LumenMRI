/** Pan/zoom applied to `.slice-stage` as `translate(x, y) scale(scale)`. */
export interface ViewTransform {
  scale: number
  x: number
  y: number
}

export const MIN_VIEW_SCALE = 1
export const MAX_VIEW_SCALE = 8

/** Untransformed stage: fit to viewport, no pan. */
export const FIT_VIEW: ViewTransform = { scale: 1, x: 0, y: 0 }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/**
 * Scale so the content under the cursor stays under the cursor.
 *
 * `anchorX/anchorY` is the stage's pre-transform center — its CSS
 * `transform-origin` — expressed in the same coordinate space as
 * `cursorX/cursorY`. It is *not* the viewport's border-box center:
 * `.slice-viewport` has asymmetric vertical padding and centers the stage in
 * its content box, so a border-box center is ~20px too high and the error
 * compounds by the zoom factor on every notch.
 */
export function zoomAboutPoint(
  view: ViewTransform,
  nextScale: number,
  cursorX: number,
  cursorY: number,
  anchorX: number,
  anchorY: number,
): ViewTransform {
  const scale = clamp(nextScale, MIN_VIEW_SCALE, MAX_VIEW_SCALE)
  if (scale === view.scale) return view
  if (scale <= MIN_VIEW_SCALE) return FIT_VIEW

  const contentX = (cursorX - anchorX - view.x) / view.scale
  const contentY = (cursorY - anchorY - view.y) / view.scale
  return {
    scale,
    x: cursorX - anchorX - contentX * scale,
    y: cursorY - anchorY - contentY * scale,
  }
}
