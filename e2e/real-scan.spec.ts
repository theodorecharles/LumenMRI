import { expect, test } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

test('opens the complete scan library and links 2D and 3D views', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Scan library' })).toBeVisible()
  await expect(page.locator('.scan-card')).toHaveCount(21, { timeout: 30_000 })
  await expect(page.getByRole('tab', { name: /Brain MRI 15/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Left Shoulder MRI 6/ })).toBeVisible()

  const flair = page.locator('.scan-card').filter({ hasText: 'AX FLAIR' }).first()
  const preview = flair.locator('.series-preview')
  const previewBox = await preview.boundingBox()
  expect(previewBox).not.toBeNull()
  if (previewBox) {
    await page.mouse.move(previewBox.x + previewBox.width * 0.05, previewBox.y + previewBox.height * 0.5)
    await expect(preview).toHaveAttribute('data-preview-frame', '0')
    const firstPreviewSlice = Number(await preview.getAttribute('data-preview-slice'))
    await page.mouse.move(previewBox.x + previewBox.width * 0.95, previewBox.y + previewBox.height * 0.5)
    await expect(preview).toHaveAttribute('data-preview-frame', '7')
    const lastPreviewSlice = Number(await preview.getAttribute('data-preview-slice'))
    expect(lastPreviewSlice).toBeGreaterThan(firstPreviewSlice)
  }
  await expect(flair.getByText(/Slice \d+\/\d+/)).toBeVisible()
  await page.screenshot({ path: 'artifacts/scan-library.png', fullPage: true })
  await flair.locator('button').click()

  await expect(page.locator('.viewer-canvas canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.volume-hud.top-left')).toContainText('AX FLAIR')
  await expect(page.getByRole('tab', { name: /3D/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: /Voxel/i })).toHaveCount(0)

  await page.getByRole('tab', { name: /Split/ }).click()
  await expect(page.locator('.viewer-canvas canvas')).toBeVisible()
  await expect(page.getByTestId('slice-canvas')).toBeVisible()
  const slicePlaneToggle = page.getByRole('button', { name: /selected slice in 3D/i })
  await expect(slicePlaneToggle).toHaveAttribute('aria-pressed', 'false')
  await slicePlaneToggle.click()
  await expect(slicePlaneToggle).toHaveAttribute('aria-pressed', 'true')
  const sliceSlider = page.getByRole('slider', { name: 'Displayed slice' })
  const maximum = Number(await sliceSlider.getAttribute('max'))
  await sliceSlider.fill(String(Math.max(0, maximum - 3)))
  await expect(sliceSlider).toHaveValue(String(Math.max(0, maximum - 3)))
  await page.getByRole('button', { name: 'Crop 3D' }).click()
  const cropOverlay = page.getByTestId('crop-overlay')
  const cropBox = await cropOverlay.boundingBox()
  expect(cropBox).not.toBeNull()
  if (cropBox) {
    await page.mouse.move(cropBox.x + cropBox.width * 0.18, cropBox.y + cropBox.height * 0.2)
    await page.mouse.down()
    await page.mouse.move(cropBox.x + cropBox.width * 0.8, cropBox.y + cropBox.height * 0.78, { steps: 8 })
    await page.mouse.up()
  }
  await expect(page.getByRole('button', { name: 'Reset volume crop' })).toBeVisible()
  await page.screenshot({ path: 'artifacts/linked-split-view.png', fullPage: true })

  const volumeCanvas = page.locator('.viewer-canvas canvas')
  const volumeBox = await volumeCanvas.boundingBox()
  const distanceBeforeOrbit = Number(await page.locator('.viewer-canvas').getAttribute('data-camera-distance'))
  if (volumeBox) {
    await page.mouse.move(volumeBox.x + volumeBox.width * 0.5, volumeBox.y + volumeBox.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(volumeBox.x + volumeBox.width * 0.67, volumeBox.y + volumeBox.height * 0.44, { steps: 8 })
    await page.mouse.up()
  }
  await page.waitForTimeout(250)
  const distanceAfterOrbit = Number(await page.locator('.viewer-canvas').getAttribute('data-camera-distance'))
  expect(Math.abs(distanceAfterOrbit - distanceBeforeOrbit)).toBeLessThan(0.002)

  await page.getByRole('tab', { name: /2D slice/ }).click()
  await expect(page.getByTestId('slice-canvas')).toBeVisible()
  await expect(page.locator('.viewer-canvas')).toHaveCount(0)
  await page.screenshot({ path: 'artifacts/diagnostic-slice-view.png', fullPage: true })

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Scan library' })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('opens the included shoulder study and returns through the Lumen brand', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  await page.getByRole('tab', { name: /Left Shoulder MRI/ }).click()
  await expect(page.locator('.scan-card')).toHaveCount(6)
  const shoulder = page.locator('.scan-card').filter({ hasText: 'Cor PD frFSE FS' }).first()
  await shoulder.locator('button').click()
  await expect(page.locator('.viewer-canvas canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.volume-hud.top-left')).toContainText('Cor PD frFSE FS')
  await page.getByRole('tab', { name: /Split/ }).click()
  await expect(page.getByTestId('slice-canvas')).toBeVisible()
  await page.screenshot({ path: 'artifacts/shoulder-split-view.png', fullPage: true })

  await page.getByRole('link', { name: 'Lumen scan library' }).click()
  await expect(page.getByRole('heading', { name: 'Scan library' })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('preserves sagittal physical proportions without clipping', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  const sagittal = page.locator('.scan-card').filter({ hasText: 'SAG T1' }).first()
  await sagittal.locator('button').click()
  await expect(page.locator('.viewer-canvas canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.volume-hud.top-left')).toContainText('SAG T1')
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: 'artifacts/sagittal-physical-scale.png', fullPage: true })
  await page.getByRole('tab', { name: /Split/ }).click()
  await page.getByRole('button', { name: 'Slices' }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'artifacts/sagittal-2d-3d-orientation.png', fullPage: true })
  await page.getByRole('button', { name: 'X axis' }).click()
  await page.getByRole('button', { name: 'Y axis' }).click()
  await page.getByRole('button', { name: 'Side' }).click()
  await page.waitForTimeout(1_000)
  await page.screenshot({ path: 'artifacts/sagittal-rotated-split-fit.png', fullPage: true })
  expect(pageErrors).toEqual([])
})

test('keeps the library and 2D viewer usable on a mobile viewport', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: undefined,
    })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Scan library' })).toBeVisible()
  const firstCard = page.locator('.scan-card').first()
  await expect(firstCard).toBeVisible()
  await firstCard.locator('button').click()
  await expect(page.locator('.viewer-canvas canvas')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
  await expect(page.locator('.stage-shell')).toHaveClass(/is-fullscreen/)
  await expect(page.locator('.app-header')).toBeHidden()
  await expect(page.locator('.control-panel')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()
  const fullscreenBox = await page.locator('.stage-shell').boundingBox()
  expect(fullscreenBox?.width).toBeCloseTo(390, 0)
  expect(fullscreenBox?.height).toBeCloseTo(844, 0)
  await page.screenshot({ path: 'artifacts/mobile-volume-fullscreen.png', fullPage: true })
  await page.getByRole('button', { name: 'Exit fullscreen' }).click()
  await expect(page.locator('.stage-shell')).not.toHaveClass(/is-fullscreen/)
  await page.getByRole('tab', { name: /2D slice/ }).click()
  await expect(page.getByTestId('slice-canvas')).toBeVisible()
  await page.screenshot({ path: 'artifacts/mobile-slice-view.png', fullPage: true })
})

test('decodes a locally selected JPEG 2000 DICOM study', async ({ page }) => {
  const scanPath = process.env.MRI_JPEG2000_SCAN_PATH
  test.skip(!scanPath, 'Set MRI_JPEG2000_SCAN_PATH to exercise local JPEG 2000 decoding')
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  const files = readdirSync(scanPath!, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(scanPath!, entry.name))
  const input = page.locator('input[type="file"]')
  await input.evaluate((element) => {
    element.removeAttribute('webkitdirectory')
    element.removeAttribute('directory')
  })
  await input.setInputFiles(files)
  await expect(page.locator('.series-panel').getByText('Cor PD frFSE FS', { exact: true })).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.viewer-canvas canvas')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.stage-progress')).toBeHidden({ timeout: 120_000 })
  expect(pageErrors).toEqual([])
})
