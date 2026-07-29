import { expect, test, type Locator, type Page } from '@playwright/test'

async function drag(
  page: Page,
  target: Locator,
  deltaX: number,
  deltaY: number,
  modifier?: 'Shift',
) {
  const bounds = await target.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return
  const x = bounds.x + bounds.width * 0.5
  const y = bounds.y + bounds.height * 0.5
  if (modifier) await page.keyboard.down(modifier)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 6 })
  await page.mouse.up()
  if (modifier) await page.keyboard.up(modifier)
}

async function zoomIn(pane: Locator) {
  const viewport = pane.locator('.slice-viewport')
  const bounds = await viewport.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return
  await pane.evaluate((element) => {
    const viewportBounds = element.querySelector('.slice-viewport')?.getBoundingClientRect()
    if (!viewportBounds) return
    element.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
      clientX: viewportBounds.left + viewportBounds.width * 0.5,
      clientY: viewportBounds.top + viewportBounds.height * 0.5,
    }))
  })
}

test('links Compare framing and window/level independently from depth', async ({ page }) => {
  await page.goto('/')
  const flair = page.locator('.scan-card').filter({ hasText: 'AX FLAIR' }).first()
  await flair.locator('button').click()
  await expect(page.getByRole('button', { name: 'Set AX 3D SPACE IAC as pane B' }))
    .toBeEnabled({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Set AX 3D SPACE IAC as pane B' }).click()

  const paneA = page.locator('.layout-compare .slice-viewer[data-pane="A"]')
  const paneB = page.locator('.layout-compare .slice-viewer[data-pane="B"]')
  const depthLink = page.getByTestId('compare-depth-link-toggle')
  const viewLink = page.getByTestId('compare-view-link-toggle')
  await expect(paneA).toBeVisible({ timeout: 30_000 })
  await expect(paneB).toBeVisible({ timeout: 30_000 })
  await expect(depthLink).toHaveAttribute('aria-pressed', 'true')
  await expect(viewLink).toHaveAttribute('aria-pressed', 'true')

  // Depth can be unlocked without changing the view-link state.
  await depthLink.click()
  const sliceABefore = await paneA.getByRole('slider', { name: 'Displayed slice' }).inputValue()
  const sliceBBefore = await paneB.getByRole('slider', { name: 'Displayed slice' }).inputValue()
  await paneB.getByRole('button', { name: 'Next slice' }).click()
  await expect(paneA.getByRole('slider', { name: 'Displayed slice' })).toHaveValue(sliceABefore)
  await expect(paneB.getByRole('slider', { name: 'Displayed slice' }))
    .not.toHaveValue(sliceBBefore)
  await expect(viewLink).toHaveAttribute('aria-pressed', 'true')

  // Zoom from A and pan from B both mirror while linked.
  await zoomIn(paneA)
  await expect.poll(async () => paneB.getAttribute('data-view-transform'))
    .toBe(await paneA.getAttribute('data-view-transform'))
  const linkedTransform = await paneA.getAttribute('data-view-transform')
  expect(linkedTransform).not.toBe('1,0,0')
  await drag(page, paneB.locator('[data-testid="slice-stage"]'), 34, 22)
  await expect.poll(async () => paneB.getAttribute('data-view-transform'))
    .toBe(await paneA.getAttribute('data-view-transform'))
  expect(await paneA.getAttribute('data-view-transform')).not.toBe(linkedTransform)

  // Free the views and make both framing and W/L diverge.
  await viewLink.click()
  await expect(viewLink).toHaveAttribute('aria-pressed', 'false')
  const freeBTransform = await paneB.getAttribute('data-view-transform')
  await zoomIn(paneA)
  await expect(paneB).toHaveAttribute('data-view-transform', freeBTransform || '')
  await expect(paneA).not.toHaveAttribute('data-view-transform', freeBTransform || '')

  const freeAWindow = await paneA.getAttribute('data-window')
  const freeALevel = await paneA.getAttribute('data-level')
  await drag(page, paneB.locator('[data-testid="slice-stage"]'), -42, 36, 'Shift')
  await expect(paneA).toHaveAttribute('data-window', freeAWindow || '')
  await expect(paneA).toHaveAttribute('data-level', freeALevel || '')
  await expect(paneB).not.toHaveAttribute('data-window', freeAWindow || '')
  await expect(paneB).not.toHaveAttribute('data-level', freeALevel || '')

  // Enabling seeds B from A; subsequent B W/L changes mirror back to A.
  const seedTransform = await paneA.getAttribute('data-view-transform')
  const seedWindow = await paneA.getAttribute('data-window')
  const seedLevel = await paneA.getAttribute('data-level')
  await viewLink.click()
  await expect(paneB).toHaveAttribute('data-view-transform', seedTransform || '')
  await expect(paneB).toHaveAttribute('data-window', seedWindow || '')
  await expect(paneB).toHaveAttribute('data-level', seedLevel || '')
  await drag(page, paneB.locator('[data-testid="slice-stage"]'), 46, -32, 'Shift')
  await expect.poll(async () => paneB.getAttribute('data-window'))
    .toBe(await paneA.getAttribute('data-window'))
  await expect.poll(async () => paneB.getAttribute('data-level'))
    .toBe(await paneA.getAttribute('data-level'))
  expect(await paneA.getAttribute('data-window')).not.toBe(seedWindow)
  expect(await paneA.getAttribute('data-level')).not.toBe(seedLevel)
  await expect(depthLink).toHaveAttribute('aria-pressed', 'false')
})
