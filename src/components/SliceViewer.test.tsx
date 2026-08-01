import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAnnotationStash } from '../lib/annotationStash'
import type { AnatomicalPlane, VolumeData } from '../types'
import { SliceViewer } from './SliceViewer'

const FULL_CROP = {
  minX: 0,
  maxX: 1,
  minY: 0,
  maxY: 1,
  minZ: 0,
  maxZ: 1,
}

const VOLUME_SETTINGS = {
  threshold: 0.1,
  opacity: 0.5,
  window: 1,
  level: 0.5,
  detail: 0.5,
  shading: 0.5,
  lightAzimuth: 0,
  lightElevation: 0,
  sharpness: 0.5,
  palette: 'cyan' as const,
  customPalette: ['#000000', '#888888', '#ffffff'] as [string, string, string],
}

const pointerCaptureDescriptors = {
  set: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture'),
  has: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture'),
  release: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture'),
}
const canvasContextDescriptor = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  'getContext',
)

class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe() {
    this.callback([], this as unknown as ResizeObserver)
  }

  unobserve() {}

  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal('PointerEvent', MouseEvent)
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: vi.fn(() => true),
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: vi.fn(),
    })),
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

afterAll(() => {
  vi.unstubAllGlobals()
  for (const [method, descriptor] of Object.entries({
    setPointerCapture: pointerCaptureDescriptors.set,
    hasPointerCapture: pointerCaptureDescriptors.has,
    releasePointerCapture: pointerCaptureDescriptors.release,
  })) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, method, descriptor)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[method]
  }
  if (canvasContextDescriptor) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', canvasContextDescriptor)
  }
})

function makeMprVolume(plane: AnatomicalPlane, depth: number, intensity: number): VolumeData {
  const width = 20
  const height = 20
  return {
    seriesId: `series-a::mpr-${plane}`,
    description: `${plane} MPR`,
    data: new Uint8Array(width * height * depth).fill(intensity),
    dimensions: [width, height, depth],
    spacing: [1, 1, 1],
    physicalSize: [width, height, depth],
    scalarRange: [0, 255],
    fullScalarRange: [0, 255],
    orientation: plane,
    sliceCount: depth,
  }
}

function viewer(
  volume: VolumeData,
  sliceIndex: number,
  annotationStash: ReturnType<typeof createAnnotationStash>,
) {
  return (
    <SliceViewer
      volume={volume}
      sliceIndex={sliceIndex}
      onSliceChange={vi.fn()}
      volumeSettings={VOLUME_SETTINGS}
      onVolumeSettingsChange={vi.fn()}
      cropBounds={FULL_CROP}
      onCropChange={vi.fn()}
      cropEditing={false}
      onCropEditingChange={vi.fn()}
      viewerLayout="slice"
      slicePlane={volume.orientation as AnatomicalPlane}
      acquiredPlane="axial"
      onSlicePlaneChange={vi.fn()}
      annotationStash={annotationStash}
    />
  )
}

function mockCanvasBounds() {
  vi.spyOn(screen.getByTestId('slice-canvas'), 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
    width: 100,
    height: 100,
    toJSON: () => ({}),
  })
}

function dragMeasurement(
  stage: HTMLElement,
  start: [number, number],
  end: [number, number],
  pointerId: number,
) {
  fireEvent.pointerDown(stage, {
    button: 0,
    pointerId,
    clientX: start[0],
    clientY: start[1],
  })
  fireEvent.pointerMove(stage, {
    button: 0,
    pointerId,
    clientX: end[0],
    clientY: end[1],
  })
  fireEvent.pointerUp(stage, {
    button: 0,
    pointerId,
    clientX: end[0],
    clientY: end[1],
  })
}

describe('ticket #3750 same-series Enhanced MPR depth changes', () => {
  it.each(['coronal', 'sagittal'] as const)(
    '%s remaps completed marks and preserves an active draft',
    (plane) => {
      const annotationStash = createAnnotationStash()
      const acquired = makeMprVolume(plane, 9, 60)
      const enhanced = makeMprVolume(plane, 5, 90)
      const { container, rerender } = render(viewer(acquired, 4, annotationStash))
      mockCanvasBounds()
      const stage = screen.getByTestId('slice-stage')

      fireEvent.click(screen.getByRole('button', { name: 'Distance measurement' }))
      dragMeasurement(stage, [10, 10], [70, 70], 1)

      fireEvent.click(screen.getByRole('button', { name: 'ROI area measurement' }))
      dragMeasurement(stage, [20, 20], [80, 75], 2)

      fireEvent.click(screen.getByRole('button', { name: 'Pixel intensity probe' }))
      fireEvent.pointerDown(stage, { button: 0, pointerId: 3, clientX: 45, clientY: 55 })

      fireEvent.click(screen.getByRole('button', { name: 'Distance measurement' }))
      fireEvent.pointerDown(stage, { button: 0, pointerId: 4, clientX: 25, clientY: 30 })
      fireEvent.pointerMove(stage, { button: 0, pointerId: 4, clientX: 65, clientY: 70 })

      const viewerElement = screen.getByLabelText('2D DICOM slice viewer')
      fireEvent.wheel(viewerElement, {
        ctrlKey: true,
        deltaY: -1,
        clientX: 50,
        clientY: 50,
      })
      const transformedView = viewerElement.getAttribute('data-view-transform')

      expect(screen.getAllByTestId('annotation-inventory-row')).toHaveLength(3)
      expect(container.querySelectorAll('.distance-measurement')).toHaveLength(2)
      expect(transformedView).not.toBe('1,0,0')

      // First render under the Enhanced depth can temporarily retain the old
      // controlled index. App follows with the 4/8 -> 2/4 fractional remap.
      rerender(viewer(enhanced, 4, annotationStash))
      rerender(viewer(enhanced, 2, annotationStash))

      const rows = screen.getAllByTestId('annotation-inventory-row')
      expect(rows).toHaveLength(3)
      expect(rows.every((row) => row.dataset.slice === '2')).toBe(true)
      expect(rows.every((row) => row.getAttribute('aria-current') === 'true')).toBe(true)
      expect(screen.getByTestId('pixel-probe-pin')).toBeInTheDocument()
      expect(container.querySelectorAll('.distance-measurement')).toHaveLength(2)
      expect(viewerElement).toHaveAttribute('data-view-transform', transformedView)
      expect(screen.getByRole('button', { name: 'Distance measurement' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )

      // Enhanced -> Acquired uses the inverse mapping. Continue and finish the
      // same pointer draft to prove its interaction ref follows both depth changes.
      rerender(viewer(acquired, 2, annotationStash))
      rerender(viewer(acquired, 4, annotationStash))
      fireEvent.pointerMove(stage, { button: 0, pointerId: 4, clientX: 75, clientY: 80 })
      fireEvent.pointerUp(stage, { button: 0, pointerId: 4, clientX: 75, clientY: 80 })

      const acquiredRows = screen.getAllByTestId('annotation-inventory-row')
      expect(acquiredRows).toHaveLength(4)
      expect(acquiredRows.every((row) => row.dataset.slice === '4')).toBe(true)
      expect(acquiredRows.every((row) => row.getAttribute('aria-current') === 'true')).toBe(true)
      expect(screen.getByTestId('pixel-probe-pin')).toBeInTheDocument()
      expect(viewerElement).toHaveAttribute('data-view-transform', transformedView)
    },
  )
})
