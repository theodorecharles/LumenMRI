import { expect, test, type Locator, type Page } from '@playwright/test'

const ZOOM_NOTCHES = 16

/** React handles wheel on `.slice-viewer`; Playwright's mouse.wheel cannot set ctrlKey. */
async function ctrlWheel(page: Page, viewer: Locator, cursor: { x: number; y: number }) {
  const before = await viewer.getAttribute('data-view-transform')
  await viewer.evaluate((element, point) => {
    element.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
      clientX: point.x,
      clientY: point.y,
    }))
  }, cursor)
  await expect.poll(async () => viewer.getAttribute('data-view-transform')).not.toBe(before)
}

test('Ctrl+scroll zoom keeps the anatomy under the cursor', async ({ page }) => {
  await page.goto('/')
  const flair = page.locator('.scan-card').filter({ hasText: 'AX FLAIR' }).first()
  await expect(flair).toBeVisible({ timeout: 30_000 })
  await flair.locator('button').click()
  await page.getByRole('tab', { name: /2D slice/ }).click()

  const viewer = page.locator('.slice-viewer')
  const canvas = page.getByTestId('slice-canvas')
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await expect(viewer).toHaveAttribute('data-view-transform', '1,0,0')

  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  if (!canvasBox) return
  // Off-center on both axes: an anchor error only shows away from the origin.
  const cursor = {
    x: Math.round(canvasBox.x + canvasBox.width * 0.32),
    y: Math.round(canvasBox.y + canvasBox.height * 0.26),
  }

  /** Normalized image coords currently under the cursor (post-transform rect). */
  const imagePointUnderCursor = () => canvas.evaluate((element, point) => {
    const rect = element.getBoundingClientRect()
    return {
      x: (point.x - rect.left) / rect.width,
      y: (point.y - rect.top) / rect.height,
    }
  }, cursor)

  const before = await imagePointUnderCursor()

  for (let notch = 0; notch < ZOOM_NOTCHES; notch += 1) {
    await ctrlWheel(page, viewer, cursor)
  }

  const scale = Number((await viewer.getAttribute('data-view-transform'))?.split(',')[0])
  expect(scale).toBeGreaterThan(4)

  // Before the anchor fix this drifted by >0.02 of the image height (~60px on screen)
  // because the zoom origin was taken 20px above the stage's real transform-origin.
  const after = await imagePointUnderCursor()
  expect(after.x).toBeCloseTo(before.x, 2)
  expect(after.y).toBeCloseTo(before.y, 2)
})
