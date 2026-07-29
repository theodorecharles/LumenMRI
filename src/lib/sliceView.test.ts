import { describe, expect, it } from 'vitest'
import { FIT_VIEW, MAX_VIEW_SCALE, MIN_VIEW_SCALE, zoomAboutPoint, type ViewTransform } from './sliceView'

const ZOOM_STEP = 1.12

// Desktop layout: `.slice-viewport` is 900x700 with `padding: 62px 42px 22px`, and
// `place-items: center` centers `.slice-stage` in the content box. So the stage's
// transform-origin sits at y = 62 + (700 - 62 - 22) / 2 = 370 — 20px below the
// border-box center (350) the zoom math used to assume.
const ANCHOR_X = 450
const ANCHOR_Y = 370
const BORDER_BOX_CENTER_Y = 350

/** Screen position (viewport border-box coords) of a stage-space point. */
function project(view: ViewTransform, contentX: number, contentY: number) {
  return {
    x: ANCHOR_X + view.x + contentX * view.scale,
    y: ANCHOR_Y + view.y + contentY * view.scale,
  }
}

/** Stage-space point currently under a screen position. */
function unproject(view: ViewTransform, screenX: number, screenY: number) {
  return {
    x: (screenX - ANCHOR_X - view.x) / view.scale,
    y: (screenY - ANCHOR_Y - view.y) / view.scale,
  }
}

function zoomIn(view: ViewTransform, cursorX: number, cursorY: number, anchorY = ANCHOR_Y) {
  return zoomAboutPoint(view, view.scale * ZOOM_STEP, cursorX, cursorY, ANCHOR_X, anchorY)
}

describe('zoomAboutPoint', () => {
  it('keeps the content under the cursor fixed for a single notch', () => {
    const cursorX = 610
    const cursorY = 240
    const tracked = unproject(FIT_VIEW, cursorX, cursorY)
    const zoomed = zoomIn(FIT_VIEW, cursorX, cursorY)

    expect(zoomed.scale).toBeCloseTo(ZOOM_STEP, 12)
    const after = project(zoomed, tracked.x, tracked.y)
    expect(after.x).toBeCloseTo(cursorX, 9)
    expect(after.y).toBeCloseTo(cursorY, 9)
  })

  it('does not drift across a full run of notches up to max scale', () => {
    const cursorX = 300
    const cursorY = 180
    const tracked = unproject(FIT_VIEW, cursorX, cursorY)
    let view = FIT_VIEW

    for (let notch = 0; notch < 24; notch += 1) {
      view = zoomIn(view, cursorX, cursorY)
      const after = project(view, tracked.x, tracked.y)
      expect(after.x).toBeCloseTo(cursorX, 6)
      expect(after.y).toBeCloseTo(cursorY, 6)
    }
    expect(view.scale).toBe(MAX_VIEW_SCALE)
  })

  it('regression: the viewport border-box center as anchor compounds into visible drift', () => {
    const cursorX = 300
    const cursorY = 180
    const tracked = unproject(FIT_VIEW, cursorX, cursorY)
    let view = FIT_VIEW

    for (let notch = 0; notch < 19; notch += 1) {
      view = zoomIn(view, cursorX, cursorY, BORDER_BOX_CENTER_Y)
    }

    const after = project(view, tracked.x, tracked.y)
    expect(after.x).toBeCloseTo(cursorX, 6)
    // ~20px anchor error * (1 - scale) once the notches compound.
    expect(Math.abs(after.y - cursorY)).toBeGreaterThan(100)
  })

  it('holds the anchor while zooming back out', () => {
    const cursorX = 700
    const cursorY = 520
    let view = FIT_VIEW
    for (let notch = 0; notch < 12; notch += 1) view = zoomIn(view, cursorX, cursorY)

    const tracked = unproject(view, cursorX, cursorY)
    for (let notch = 0; notch < 6; notch += 1) {
      view = zoomAboutPoint(view, view.scale / ZOOM_STEP, cursorX, cursorY, ANCHOR_X, ANCHOR_Y)
      const after = project(view, tracked.x, tracked.y)
      expect(after.x).toBeCloseTo(cursorX, 6)
      expect(after.y).toBeCloseTo(cursorY, 6)
    }
    expect(view.scale).toBeGreaterThan(MIN_VIEW_SCALE)
  })

  it('snaps back to fit at minimum scale and is a no-op at the clamp edges', () => {
    const zoomedOut = zoomAboutPoint({ scale: 1.05, x: 30, y: -12 }, 0.6, 400, 200, ANCHOR_X, ANCHOR_Y)
    expect(zoomedOut).toEqual(FIT_VIEW)

    const atMax: ViewTransform = { scale: MAX_VIEW_SCALE, x: 12, y: 9 }
    expect(zoomAboutPoint(atMax, MAX_VIEW_SCALE * ZOOM_STEP, 400, 200, ANCHOR_X, ANCHOR_Y)).toBe(atMax)
  })
})
