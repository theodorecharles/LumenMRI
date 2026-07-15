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
  const volumePane = page.locator('.viewer-stage-pane')
  await expect(volumePane).toHaveAttribute('data-reconstruction-status', 'ready', { timeout: 120_000 })
  const acquiredDepth = 38
  const reconstructedDepth = Number(await volumePane.getAttribute('data-reconstructed-depth'))
  const syntheticSlices = Number(await volumePane.getAttribute('data-synthetic-slices'))
  expect(reconstructedDepth).toBeGreaterThan(acquiredDepth)
  expect(syntheticSlices).toBe(reconstructedDepth - acquiredDepth)
  await expect(page.locator('.render-stats')).toContainText('SHAPE RECON')
  const distanceBeforeModeToggle = Number(await page.locator('.viewer-canvas').getAttribute('data-camera-distance'))
  await page.getByRole('button', { name: 'Acquired', exact: true }).click()
  await expect(volumePane).toHaveAttribute('data-reconstruction-mode', 'acquired')
  await expect(volumePane).toHaveAttribute('data-reconstructed-depth', String(acquiredDepth))
  await page.getByRole('button', { name: 'Enhanced', exact: true }).click()
  await expect(volumePane).toHaveAttribute('data-reconstruction-mode', 'enhanced')
  await expect(volumePane).toHaveAttribute('data-reconstructed-depth', String(reconstructedDepth))
  const distanceAfterModeToggle = Number(await page.locator('.viewer-canvas').getAttribute('data-camera-distance'))
  expect(Math.abs(distanceAfterModeToggle - distanceBeforeModeToggle)).toBeLessThan(0.002)
  await page.getByRole('button', { name: 'Edit 3D crop box' }).click()
  await expect(volumePane).toHaveAttribute('data-crop-editing', 'true')
  const cropHandles = page.getByRole('group', { name: '3D crop box handles' })
  await expect(cropHandles.locator('.crop-face-handle')).toHaveCount(6)
  await expect(cropHandles.getByRole('button')).toHaveCount(7)
  await expect(page.getByRole('button', { name: 'Move entire crop box' })).toBeVisible()
  await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-crop-handles-ready', 'true')
  await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-crop-cross-sections', '6')
  const nearDepthHandle = page.getByRole('button', { name: 'Drag near depth crop face' })
  const farDepthHandle = page.getByRole('button', { name: 'Drag far depth crop face' })
  const nearDepthBox = await nearDepthHandle.boundingBox()
  const farDepthBox = await farDepthHandle.boundingBox()
  expect(nearDepthBox).not.toBeNull()
  expect(farDepthBox).not.toBeNull()
  if (nearDepthBox && farDepthBox) {
    const near = {
      x: nearDepthBox.x + nearDepthBox.width / 2,
      y: nearDepthBox.y + nearDepthBox.height / 2,
    }
    const far = {
      x: farDepthBox.x + farDepthBox.width / 2,
      y: farDepthBox.y + farDepthBox.height / 2,
    }
    await page.mouse.move(far.x, far.y)
    await page.mouse.down()
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(
        far.x + (near.x - far.x) * 0.32 * step / 8,
        far.y + (near.y - far.y) * 0.32 * step / 8,
      )
      await page.waitForTimeout(25)
    }
    await page.mouse.up()
  }
  await expect.poll(async () => page.locator('.viewer-canvas').getAttribute('data-crop-bounds'))
    .not.toBe('0.0000,1.0000,0.0000,1.0000,0.0000,1.0000')
  const cropValues = (await page.locator('.viewer-canvas').getAttribute('data-crop-bounds'))
    ?.split(',').map(Number) || []
  expect(cropValues[5]).toBeLessThan(0.9)
  expect(Number(await page.getByRole('slider', { name: 'Depth end' }).inputValue()))
    .toBeCloseTo(cropValues[5], 1)

  const leftCropHandle = page.getByRole('button', { name: 'Drag left crop face' })
  const rightCropHandle = page.getByRole('button', { name: 'Drag right crop face' })
  const leftCropBox = await leftCropHandle.boundingBox()
  const rightCropBox = await rightCropHandle.boundingBox()
  expect(leftCropBox).not.toBeNull()
  expect(rightCropBox).not.toBeNull()
  if (leftCropBox && rightCropBox) {
    const left = {
      x: leftCropBox.x + leftCropBox.width / 2,
      y: leftCropBox.y + leftCropBox.height / 2,
    }
    const right = {
      x: rightCropBox.x + rightCropBox.width / 2,
      y: rightCropBox.y + rightCropBox.height / 2,
    }
    await page.mouse.move(right.x, right.y)
    await page.mouse.down()
    await page.mouse.move(
      right.x + (left.x - right.x) * 0.22,
      right.y + (left.y - right.y) * 0.22,
      { steps: 8 },
    )
    await page.mouse.up()
  }
  const beforeMove = (await page.locator('.viewer-canvas').getAttribute('data-crop-bounds'))
    ?.split(',').map(Number) || []
  expect(beforeMove[1]).toBeLessThan(0.95)
  const moveHandle = page.getByRole('button', { name: 'Move entire crop box' })
  const moveBox = await moveHandle.boundingBox()
  const translatedLeftBox = await leftCropHandle.boundingBox()
  const translatedRightBox = await rightCropHandle.boundingBox()
  if (moveBox && translatedLeftBox && translatedRightBox) {
    const move = {
      x: moveBox.x + moveBox.width / 2,
      y: moveBox.y + moveBox.height / 2,
    }
    const axisX = translatedRightBox.x - translatedLeftBox.x
    const axisY = translatedRightBox.y - translatedLeftBox.y
    await page.mouse.move(move.x, move.y)
    await page.mouse.down()
    await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-crop-drag-mode', 'move')
    await page.mouse.move(move.x + axisX * 0.2, move.y + axisY * 0.2, { steps: 10 })
    await expect.poll(async () => {
      const delta = (await page.locator('.viewer-canvas').getAttribute('data-crop-move-delta'))
        ?.split(',').map(Number) || []
      return delta[0]
    }).toBeGreaterThan(0.01)
    await page.mouse.up()
  }
  await expect.poll(async () => {
    const bounds = (await page.locator('.viewer-canvas').getAttribute('data-crop-bounds'))
      ?.split(',').map(Number) || []
    return bounds[0]
  }).toBeGreaterThan(beforeMove[0] + 0.01)
  const afterMove = (await page.locator('.viewer-canvas').getAttribute('data-crop-bounds'))
    ?.split(',').map(Number) || []
  expect(afterMove[1] - afterMove[0]).toBeCloseTo(beforeMove[1] - beforeMove[0], 2)
  await page.getByRole('slider', { name: '3D sharpening' }).fill('0.8')
  await expect(page.getByRole('slider', { name: '3D sharpening' })).toHaveValue('0.8')
  await page.getByRole('button', { name: 'Side lighting' }).click()
  await expect(page.getByRole('slider', { name: 'Light intensity' })).toHaveValue('0.82')
  await page.getByRole('slider', { name: 'Light azimuth' }).fill('72')
  await page.getByRole('slider', { name: 'Light elevation' }).fill('-18')
  await expect(page.getByRole('slider', { name: 'Light azimuth' })).toHaveValue('72')
  await expect(page.getByRole('slider', { name: 'Light elevation' })).toHaveValue('-18')
  await page.screenshot({ path: 'artifacts/draggable-3d-depth-crop.png', fullPage: true })
  await page.getByRole('button', { name: 'Stop editing 3D crop box' }).click()
  const thermalPalette = page.getByRole('radio', { name: 'thermal' })
  await thermalPalette.click()
  await expect(thermalPalette).toHaveAttribute('aria-checked', 'true')
  const customPalette = page.getByRole('radio', { name: 'custom' })
  await customPalette.click()
  await expect(page.getByLabel('Custom color stops')).toBeVisible()
  await page.getByLabel('Midtones color').fill('#00ff88')
  await expect(page.getByLabel('Midtones color')).toHaveValue('#00ff88')
  await thermalPalette.click()
  await page.getByRole('button', { name: 'Isometric', exact: true }).click()
  await expect(volumePane).toHaveAttribute('data-camera-projection', 'isometric')
  await page.getByRole('button', { name: 'Superior view' }).click()
  await expect(page.getByRole('group', { name: 'Anatomical view cube' })).toBeVisible()
  await page.screenshot({ path: 'artifacts/isometric-thermal-reconstruction.png', fullPage: true })
  await page.getByRole('button', { name: 'Perspective', exact: true }).click()
  await expect(volumePane).toHaveAttribute('data-camera-projection', 'perspective')

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

  await page.getByRole('button', { name: 'Distance measurement' }).click()
  await expect(page.getByRole('button', { name: 'Distance measurement' })).toHaveAttribute('aria-pressed', 'true')
  if (cropBox) {
    await page.mouse.move(cropBox.x + cropBox.width * 0.3, cropBox.y + cropBox.height * 0.36)
    await page.mouse.down()
    await page.mouse.move(cropBox.x + cropBox.width * 0.68, cropBox.y + cropBox.height * 0.58, { steps: 7 })
    await page.mouse.up()
  }
  await expect(page.locator('.measurement-label.distance')).toContainText('mm')
  await page.getByRole('button', { name: 'ROI area measurement' }).click()
  if (cropBox) {
    await page.mouse.move(cropBox.x + cropBox.width * 0.42, cropBox.y + cropBox.height * 0.32)
    await page.mouse.down()
    await page.mouse.move(cropBox.x + cropBox.width * 0.69, cropBox.y + cropBox.height * 0.62, { steps: 7 })
    await page.mouse.up()
  }
  await expect(page.locator('.measurement-label.roi')).toContainText('mm²')
  await expect(page.locator('.measurement-label.roi')).toContainText('μ')
  await page.screenshot({ path: 'artifacts/linked-split-view.png', fullPage: true })
  await page.getByRole('button', { name: 'Clear measurements on slice' }).click()
  await expect(page.locator('.measurement-label')).toHaveCount(0)

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
  await expect(page.locator('.viewer-stage-pane')).toHaveAttribute(
    'data-reconstruction-status',
    'ready',
    { timeout: 120_000 },
  )
  expect(Number(await page.locator('.viewer-stage-pane').getAttribute('data-synthetic-slices'))).toBeGreaterThan(0)
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
  await page.getByRole('button', { name: 'Side view' }).click()
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
  await expect(page.locator('.viewer-stage-pane')).toHaveAttribute(
    'data-reconstruction-status',
    'ready',
    { timeout: 120_000 },
  )
  expect(Number(await page.locator('.viewer-stage-pane').getAttribute('data-synthetic-slices'))).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Edit 3D crop box' }).click()
  await expect(page.getByRole('group', { name: '3D crop box handles' }).locator('.crop-face-handle')).toHaveCount(6)
  await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-crop-handles-ready', 'true')
  await expect(page.getByRole('button', { name: 'Move entire crop box' })).toBeVisible()
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
  await page.getByRole('button', { name: 'Stop editing 3D crop box' }).click()
  await page.getByRole('tab', { name: /2D slice/ }).click()
  await expect(page.getByTestId('slice-canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Distance measurement' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ROI area measurement' })).toBeVisible()
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
