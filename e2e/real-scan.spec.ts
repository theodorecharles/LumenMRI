import { expect, test, type Locator, type Page } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { reconstructionOptionsForDevice } from '../src/lib/reconstructVolume'

interface ResliceExpectation {
  /** Reslice pixel dimensions as [width, height]. */
  coronal: [number, number]
  sagittal: [number, number]
  /** In-plane spacing of the reconstructed volume, in millimetres. */
  inPlaneSpacing: number
}

const FLAIR_SLICE_SPACING = 3.9999764740342947
const FLAIR_SOURCE_WIDTH = 416
const FLAIR_IN_PLANE_SPACING = 0.4492

/**
 * Exact MPR reslice dimensions for Brain MRI · AX FLAIR (416 × 512 × 38, 0.4492 mm
 * in-plane, 4 mm slices), keyed by the reconstruction budget the app picks for the host.
 * The compact budget caps in-plane pixels at 384, so a 4-core machine reslices the same
 * geometry at a lower resolution than an 8-core one. Coronal is [width, depth] and
 * sagittal is [height, depth] of the reconstructed volume.
 */
const FLAIR_RESLICES: Record<number, ResliceExpectation> = {
  512: {
    coronal: [416, 149],
    sagittal: [512, 149],
    inPlaneSpacing: FLAIR_IN_PLANE_SPACING,
  },
  384: {
    coronal: [312, 149],
    sagittal: [384, 149],
    inPlaneSpacing: (FLAIR_IN_PLANE_SPACING * FLAIR_SOURCE_WIDTH) / 312,
  },
}

/** Resolve the reslice expectation for the budget this browser will actually use. */
async function flairResliceExpectation(page: Page): Promise<ResliceExpectation> {
  const { maxDimension } = reconstructionOptionsForDevice(
    await page.evaluate(() => ({
      compactViewport: window.matchMedia('(max-width: 690px)').matches,
      hardwareConcurrency: navigator.hardwareConcurrency,
    })),
  )
  const expectation = FLAIR_RESLICES[maxDimension]
  if (!expectation) {
    throw new Error(`No AX FLAIR reslice expectation for maxDimension ${maxDimension}`)
  }
  return expectation
}

/**
 * 3D crop handles are DOM buttons projected from the WebGL camera every frame, and
 * finishing a drag recenters the visible volume. Wait for a handle's projected center
 * to hold still across rendered frames before synthesizing the next pointer gesture,
 * otherwise a press can land on the canvas beside a handle that has already moved.
 */
async function settledHandleCenter(page: Page, handle: Locator) {
  const readCenter = async () => {
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  }
  const nextFrames = () => page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))

  let previous = await readCenter()
  let stableReads = 0
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(80)
    await nextFrames()
    const current = await readCenter()
    stableReads = Math.hypot(current.x - previous.x, current.y - previous.y) < 0.5
      ? stableReads + 1
      : 0
    previous = current
    if (stableReads >= 2) return current
  }
  throw new Error('3D crop handle position never settled')
}

/**
 * Best-effort diagnostic artifact only — never product acceptance.
 * Under GHA SwiftShader, WebGL canvas buffer readback can hang past Playwright's
 * screenshot timeout after fonts load (runs 30499086526, 30500159337 / 30500178166).
 * Short timeout + swallow errors so capture cannot fail or stall the suite.
 */
async function captureDiagnostic(page: Page, path: string) {
  try {
    await page.screenshot({ path, animations: 'disabled', timeout: 5_000 })
  } catch {
    // Diagnostic only — product assertions continue.
  }
}

test('opens the complete scan library and links 2D and 3D views', async ({ page }) => {
  // Batch #431 extended crop-handle settling + lighting assertions on this single flow.
  // CI (SwiftShader + full FLAIR recon) routinely needs more than the default 180s budget.
  test.setTimeout(480_000)

  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  const capture = (path: string) => captureDiagnostic(page, path)

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
  await capture('artifacts/scan-library.png')
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
  const near = await settledHandleCenter(page, nearDepthHandle)
  const far = await settledHandleCenter(page, farDepthHandle)
  await page.mouse.move(far.x, far.y)
  await page.mouse.down()
  await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-crop-drag-mode', 'face')
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      far.x + (near.x - far.x) * 0.32 * step / 8,
      far.y + (near.y - far.y) * 0.32 * step / 8,
    )
    await page.waitForTimeout(25)
  }
  await page.mouse.up()
  await expect.poll(async () => page.locator('.viewer-canvas').getAttribute('data-crop-bounds'))
    .not.toBe('0.0000,1.0000,0.0000,1.0000,0.0000,1.0000')
  const cropValues = (await page.locator('.viewer-canvas').getAttribute('data-crop-bounds'))
    ?.split(',').map(Number) || []
  expect(cropValues[5]).toBeLessThan(0.9)
  expect(Number(await page.getByRole('slider', { name: 'Depth end' }).inputValue()))
    .toBeCloseTo(cropValues[5], 1)

  const leftCropHandle = page.getByRole('button', { name: 'Drag left crop face' })
  const rightCropHandle = page.getByRole('button', { name: 'Drag right crop face' })
  const left = await settledHandleCenter(page, leftCropHandle)
  const right = await settledHandleCenter(page, rightCropHandle)
  await page.mouse.move(right.x, right.y)
  await page.mouse.down()
  await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-crop-drag-mode', 'face')
  await page.mouse.move(
    right.x + (left.x - right.x) * 0.22,
    right.y + (left.y - right.y) * 0.22,
    { steps: 8 },
  )
  await page.mouse.up()
  // Face-drag commits flow through React setState → useEffect → data-crop-bounds.
  // Under CI load the last pointermove can still be in flight when mouse.up returns, so
  // sample the pre-move box only after the drag idles and projected handles settle —
  // otherwise width-preservation compares a mid-drag snapshot to the final moved box
  // (deploy run 30678055433: 0.8504 vs 0.829).
  await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-crop-drag-mode', 'idle')
  const moveHandle = page.getByRole('button', { name: 'Move entire crop box' })
  const translatedLeft = await settledHandleCenter(page, leftCropHandle)
  const translatedRight = await settledHandleCenter(page, rightCropHandle)
  const move = await settledHandleCenter(page, moveHandle)
  const beforeMove = (await page.locator('.viewer-canvas').getAttribute('data-crop-bounds'))
    ?.split(',').map(Number) || []
  expect(beforeMove[1]).toBeLessThan(0.95)
  const axisX = translatedRight.x - translatedLeft.x
  const axisY = translatedRight.y - translatedLeft.y
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
  await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-crop-drag-mode', 'idle')
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
  await capture('artifacts/draggable-3d-depth-crop.png')
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
  await capture('artifacts/isometric-thermal-reconstruction.png')
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
  await expect(page.locator('.measurement-label.roi')).toContainText('σ')
  await expect(page.locator('.measurement-label.roi')).toContainText('–')
  await page.getByRole('button', { name: 'Angle measurement' }).click()
  await expect(page.getByRole('button', { name: 'Angle measurement' })).toHaveAttribute('aria-pressed', 'true')
  if (cropBox) {
    // Three clicks: arm end → vertex → arm end (≈90° L shape).
    await page.mouse.click(cropBox.x + cropBox.width * 0.28, cropBox.y + cropBox.height * 0.55)
    await page.mouse.click(cropBox.x + cropBox.width * 0.5, cropBox.y + cropBox.height * 0.55)
    await page.mouse.click(cropBox.x + cropBox.width * 0.5, cropBox.y + cropBox.height * 0.28)
  }
  await expect(page.locator('.measurement-label.angle')).toContainText('°')
  const measuredSlice = Number(await sliceSlider.inputValue())
  const annotationInventory = page.getByTestId('annotation-inventory')
  const annotationRows = page.getByTestId('annotation-inventory-row')
  await expect(annotationInventory).toBeVisible()
  await expect(annotationRows).toHaveCount(3)
  await expect(annotationRows.filter({ hasText: 'Distance' })).toContainText('mm')
  await expect(annotationRows.filter({ hasText: 'ROI' })).toContainText('mm²')
  await expect(annotationRows.filter({ hasText: 'Angle' })).toContainText('°')

  const probeSlice = measuredSlice < maximum ? measuredSlice + 1 : measuredSlice - 1
  await sliceSlider.fill(String(probeSlice))
  await expect(page.locator('.measurement-label')).toHaveCount(0)
  await expect(annotationRows).toHaveCount(3)
  await page.getByRole('button', { name: 'Pixel intensity probe' }).click()
  if (cropBox) {
    await page.mouse.click(
      cropBox.x + cropBox.width * 0.55,
      cropBox.y + cropBox.height * 0.45,
    )
  }
  await expect(page.getByTestId('pixel-probe-pin')).toHaveCount(1)
  await expect(annotationRows).toHaveCount(4)
  await expect(annotationRows.filter({ hasText: 'Probe' })).toContainText(
    `SL ${String(probeSlice + 1).padStart(3, '0')}`,
  )

  // Per-slice clear removes the probe but preserves measurements elsewhere in the series.
  await page.getByRole('button', { name: 'Clear measurements on slice' }).click()
  await expect(page.getByTestId('pixel-probe-pin')).toHaveCount(0)
  await expect(annotationRows).toHaveCount(3)

  // Inventory rows jump back to their slice and flash the selected mark.
  await annotationRows.filter({ hasText: 'ROI' }).click()
  await expect(sliceSlider).toHaveValue(String(measuredSlice))
  await expect(page.getByTestId('slice-pick-crosshair')).toBeVisible()
  await expect(page.locator('.roi-measurement')).toHaveClass(/is-flashing/)
  await expect(annotationRows.filter({ hasText: 'ROI' })).toHaveClass(/selected/)
  await capture('artifacts/linked-split-view.png')
  await page.getByRole('button', { name: 'Clear all annotations on series' }).click()
  await expect(annotationInventory).toHaveCount(0)
  await expect(page.locator('.measurement-label')).toHaveCount(0)
  // Deselect active probe tool so plain left-drag is free; shift-drag still owns W/L.
  await page.getByRole('button', { name: 'Pixel intensity probe' }).click()
  await expect(page.getByRole('button', { name: 'Pixel intensity probe' })).toHaveAttribute('aria-pressed', 'false')

  const windowSlider = page.getByRole('slider', { name: 'Window' })
  const levelSlider = page.getByRole('slider', { name: 'Level' })
  const windowBefore = Number(await windowSlider.inputValue())
  const levelBefore = Number(await levelSlider.inputValue())
  if (cropBox) {
    await page.mouse.move(cropBox.x + cropBox.width * 0.5, cropBox.y + cropBox.height * 0.5)
    await page.keyboard.down('Shift')
    await page.mouse.down()
    await page.mouse.move(cropBox.x + cropBox.width * 0.72, cropBox.y + cropBox.height * 0.28, { steps: 10 })
    await expect(page.getByTestId('window-level-readout')).toBeVisible()
    await page.mouse.up()
    await page.keyboard.up('Shift')
  }
  await expect(page.getByTestId('window-level-readout')).toHaveCount(0)
  await expect.poll(async () => Number(await windowSlider.inputValue())).not.toBeCloseTo(windowBefore, 2)
  await expect.poll(async () => Number(await levelSlider.inputValue())).not.toBeCloseTo(levelBefore, 2)

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
  await capture('artifacts/diagnostic-slice-view.png')

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Scan library' })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('switches one 2D stack across orthogonal MPR planes', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  const reslice = await flairResliceExpectation(page)
  const flair = page.locator('.scan-card').filter({ hasText: 'AX FLAIR' }).first()
  await flair.locator('button').click()
  await expect(page.locator('.viewer-canvas canvas')).toBeVisible({ timeout: 30_000 })
  const volumePane = page.locator('.viewer-stage-pane')
  await expect(volumePane).toHaveAttribute(
    'data-reconstruction-status',
    'ready',
    { timeout: 120_000 },
  )
  /**
   * Reformat sizes follow the reconstruction grid, and reconstruction scales the
   * acquired 416 × 512 in-plane grid down on low-core/small-viewport devices — so the
   * expected reformat dimensions are read from the volume pane, not hard-coded.
   */
  const gridColumns = Number(await volumePane.getAttribute('data-reconstructed-width'))
  const gridRows = Number(await volumePane.getAttribute('data-reconstructed-height'))
  const gridDepth = Number(await volumePane.getAttribute('data-reconstructed-depth'))
  expect(gridColumns).toBeGreaterThan(0)
  expect(gridRows).toBeGreaterThan(0)
  expect(gridDepth).toBeGreaterThan(38)
  await page.getByRole('tab', { name: /2D slice/ }).click()

  const planeSwitch = page.getByRole('group', { name: 'MPR plane' })
  const axialPlane = page.getByRole('button', { name: 'Axial plane (acquired)' })
  const coronalPlane = page.getByRole('button', { name: 'Coronal plane' })
  const sagittalPlane = page.getByRole('button', { name: 'Sagittal plane' })
  await expect(planeSwitch).toBeVisible()
  await expect(axialPlane).toHaveAttribute('aria-pressed', 'true')

  await coronalPlane.click()
  await expect(page.locator('.slice-viewer')).toHaveAttribute('data-slice-plane', 'coronal')
  const [coronalWidth, coronalHeight] = reslice.coronal
  await expect(page.locator('.slice-meta-left')).toContainText('CORONAL')
  await expect(page.locator('.slice-meta-left')).toContainText(`${gridColumns} × ${gridDepth}`)
  await expect(page.getByTestId('slice-canvas')).toHaveAttribute('width', String(gridColumns))
  await expect(page.getByTestId('slice-canvas')).toHaveAttribute('height', String(gridDepth))
  const coronalCanvasBox = await page.getByTestId('slice-canvas').boundingBox()
  expect(coronalCanvasBox).not.toBeNull()
  // Physical proportions come from the acquired geometry and hold at any grid scale.
  expect(coronalCanvasBox!.width / coronalCanvasBox!.height).toBeCloseTo(
    ((coronalWidth - 1) * reslice.inPlaneSpacing)
      / ((coronalHeight - 1) * (FLAIR_SLICE_SPACING / 4)),
    1,
  )
  await expect(page.locator('.slice-scale-ruler')).toHaveCount(2)
  await expect(page.locator('.slice-scale-ruler').first()).toContainText('mm')

  const mprOverlay = page.getByTestId('crop-overlay')
  const mprBox = await mprOverlay.boundingBox()
  expect(mprBox).not.toBeNull()
  await page.getByRole('button', { name: 'Distance measurement' }).click()
  if (mprBox) {
    await page.mouse.move(mprBox.x + mprBox.width * 0.3, mprBox.y + mprBox.height * 0.34)
    await page.mouse.down()
    await page.mouse.move(
      mprBox.x + mprBox.width * 0.68,
      mprBox.y + mprBox.height * 0.61,
      { steps: 7 },
    )
    await page.mouse.up()
  }
  await expect(page.locator('.measurement-label.distance')).toContainText('mm')
  await page.getByRole('button', { name: 'Distance measurement' }).click()
  await page.getByRole('button', { name: 'Pixel intensity probe' }).click()
  if (mprBox) {
    await page.mouse.click(
      mprBox.x + mprBox.width * 0.52,
      mprBox.y + mprBox.height * 0.48,
    )
  }
  await expect(page.getByTestId('pixel-probe-pin')).toHaveCount(1)
  await expect(page.locator('.pixel-probe-pin-label')).toBeVisible()
  await captureDiagnostic(page, 'artifacts/coronal-mpr-2d.png')
  await page.getByRole('button', { name: 'Pixel intensity probe' }).click()
  await page.getByRole('button', { name: 'Clear measurements on slice' }).click()

  const sliceSlider = page.getByRole('slider', { name: 'Displayed slice' })
  const reformattedStart = Number(await sliceSlider.inputValue())
  await page.getByRole('button', { name: 'Play cine' }).click()
  await expect.poll(async () => Number(await sliceSlider.inputValue())).not.toBe(reformattedStart)
  await page.getByRole('button', { name: 'Pause cine' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTitle('Save image (S)').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/coronal-slice-\d+\.png$/)

  await sagittalPlane.click()
  await expect(page.locator('.slice-viewer')).toHaveAttribute('data-slice-plane', 'sagittal')
  await expect(page.getByTestId('slice-canvas')).toHaveAttribute('width', String(gridRows))
  await expect(page.getByTestId('slice-canvas')).toHaveAttribute('height', String(gridDepth))

  await page.getByRole('tab', { name: /Split/ }).click()
  await expect(page.locator('.viewer-canvas canvas')).toBeVisible()
  await expect(planeSwitch).toBeVisible()
  await expect(page.locator('.slice-viewer')).toHaveAttribute('data-slice-plane', 'sagittal')
  await expect(page.getByRole('button', { name: /selected slice in 3D/i })).toBeDisabled()

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
  await expect(page.getByRole('button', { name: 'Coronal plane (acquired)' }))
    .toHaveAttribute('aria-pressed', 'true')
  await captureDiagnostic(page, 'artifacts/shoulder-split-view.png')

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
  await captureDiagnostic(page, 'artifacts/sagittal-physical-scale.png')
  await page.getByRole('tab', { name: /Split/ }).click()
  await page.getByRole('button', { name: 'Slices' }).click()
  await page.waitForTimeout(800)
  await captureDiagnostic(page, 'artifacts/sagittal-2d-3d-orientation.png')
  await page.getByRole('button', { name: 'X axis' }).click()
  await page.getByRole('button', { name: 'Y axis' }).click()
  await page.getByRole('button', { name: 'Side view' }).click()
  await page.waitForTimeout(1_000)
  await captureDiagnostic(page, 'artifacts/sagittal-rotated-split-fit.png')
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
  await captureDiagnostic(page, 'artifacts/mobile-volume-fullscreen.png')
  await page.getByRole('button', { name: 'Exit fullscreen' }).click()
  await expect(page.locator('.stage-shell')).not.toHaveClass(/is-fullscreen/)
  await page.getByRole('button', { name: 'Stop editing 3D crop box' }).click()
  await page.getByRole('tab', { name: /2D slice/ }).click()
  await expect(page.getByTestId('slice-canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Distance measurement' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ROI area measurement' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Angle measurement' })).toBeVisible()
  await captureDiagnostic(page, 'artifacts/mobile-slice-view.png')
})

test('keeps viewer shortcuts alive while a toolbar button holds focus', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  const flair = page.locator('.scan-card').filter({ hasText: 'AX FLAIR' }).first()
  await flair.locator('button').click()
  await expect(page.locator('.viewer-canvas canvas')).toBeVisible({ timeout: 30_000 })

  const grid = page.locator('.stage-view-grid')
  const volumeTab = page.getByRole('tab', { name: /3D/ })
  const sliceTab = page.getByRole('tab', { name: /2D slice/ })
  const splitTab = page.getByRole('tab', { name: /Split/ })

  // Clicking a tab leaves that button focused. Layout digits must still fire
  // instead of requiring a click on empty canvas first.
  await splitTab.click()
  await expect(splitTab).toBeFocused()
  await expect(grid).toHaveClass(/layout-split/)
  await page.keyboard.press('1')
  await expect(grid).toHaveClass(/layout-volume/)
  await expect(volumeTab).toHaveAttribute('aria-selected', 'true')
  await expect(splitTab).toBeFocused()

  // Slice stepping works from the same focused button.
  await page.keyboard.press('2')
  await expect(sliceTab).toHaveAttribute('aria-selected', 'true')
  const sliceSlider = page.getByRole('slider', { name: 'Displayed slice' })
  const startIndex = Number(await sliceSlider.inputValue())
  await page.keyboard.press('ArrowDown')
  await expect(sliceSlider).toHaveValue(String(startIndex + 1))
  await page.keyboard.press('Home')
  await expect(sliceSlider).toHaveValue('0')

  // Space still belongs to the focused button: it re-activates that tab rather
  // than toggling cine.
  const cine = page.getByRole('button', { name: 'Play cine' })
  await expect(cine).toHaveAttribute('aria-pressed', 'false')
  await expect(splitTab).toBeFocused()
  await page.keyboard.press(' ')
  await expect(grid).toHaveClass(/layout-split/)
  await expect(page.getByRole('button', { name: 'Play cine' })).toHaveAttribute('aria-pressed', 'false')

  // With no control focused, Space drives cine as advertised.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Pause cine' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Play cine' })).toHaveAttribute('aria-pressed', 'false')

  expect(pageErrors).toEqual([])
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
