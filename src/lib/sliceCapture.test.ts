import { describe, expect, it, vi } from 'vitest'
import {
  compositeAnnotatedSlicePng,
  compositeAnnotatedVolumePng,
  compositeCompareSlicePng,
  renderAnnotatedSliceCanvas,
} from './sliceCapture'

type DrawCall = { method: string; args: unknown[] }

function mockContext() {
  const calls: DrawCall[] = []
  const ctx = {
    drawImage: (...args: unknown[]) => calls.push({ method: 'drawImage', args }),
    beginPath: (...args: unknown[]) => calls.push({ method: 'beginPath', args }),
    moveTo: (...args: unknown[]) => calls.push({ method: 'moveTo', args }),
    lineTo: (...args: unknown[]) => calls.push({ method: 'lineTo', args }),
    stroke: (...args: unknown[]) => calls.push({ method: 'stroke', args }),
    fill: (...args: unknown[]) => calls.push({ method: 'fill', args }),
    arc: (...args: unknown[]) => calls.push({ method: 'arc', args }),
    arcTo: (...args: unknown[]) => calls.push({ method: 'arcTo', args }),
    closePath: (...args: unknown[]) => calls.push({ method: 'closePath', args }),
    strokeRect: (...args: unknown[]) => calls.push({ method: 'strokeRect', args }),
    fillRect: (...args: unknown[]) => calls.push({ method: 'fillRect', args }),
    fillText: (...args: unknown[]) => calls.push({ method: 'fillText', args }),
    save: (...args: unknown[]) => calls.push({ method: 'save', args }),
    restore: (...args: unknown[]) => calls.push({ method: 'restore', args }),
    setLineDash: (...args: unknown[]) => calls.push({ method: 'setLineDash', args }),
    measureText: (text: string) => ({ width: String(text).length * 6 }),
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => undefined,
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    canvas: undefined as unknown,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

function mockSource(width = 80, height = 80) {
  const source = {
    width,
    height,
    toDataURL: vi.fn(() => 'data:image/png;base64,SOURCE'),
  } as unknown as HTMLCanvasElement
  return source
}

describe('compositeAnnotatedSlicePng', () => {
  it('composites intensity, measurements, orientation markers, and metadata', () => {
    const { ctx, calls } = mockContext()
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => 'data:image/png;base64,ANNOTATED',
      }
      return canvas as unknown as HTMLCanvasElement
    })

    const source = mockSource()
    const result = compositeAnnotatedSlicePng({
      source,
      seriesName: 'Ax FLAIR',
      sliceIndex: 4,
      sliceCount: 32,
      window: 1,
      level: 0.5,
      labels: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
      measurements: [
        {
          id: 1,
          tool: 'distance',
          start: { x: 0.2, y: 0.2 },
          end: { x: 0.8, y: 0.8 },
          label: '12 mm',
        },
        {
          id: 2,
          tool: 'roi',
          start: { x: 0.55, y: 0.15 },
          end: { x: 0.85, y: 0.4 },
          label: '40 mm² · μ 48\nσ 12 · 30–60',
        },
        {
          id: 3,
          tool: 'angle',
          start: { x: 0.2, y: 0.5 },
          vertex: { x: 0.45, y: 0.55 },
          end: { x: 0.7, y: 0.35 },
          label: '38°',
        },
      ],
    })

    expect(result).toBe('data:image/png;base64,ANNOTATED')
    expect(calls.some((call) => call.method === 'drawImage' && call.args[0] === source)).toBe(true)
    expect(calls.some((call) => call.method === 'lineTo')).toBe(true)
    expect(calls.some((call) => call.method === 'strokeRect')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === '12 mm')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === '40 mm² · μ 48')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'σ 12 · 30–60')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === '38°')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'A')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'Ax FLAIR')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && String(call.args[0]).includes('SL 005'))).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && String(call.args[0]).includes('W 255'))).toBe(true)

    createElement.mockRestore()
  })

  it('draws angle rays through the shared vertex', () => {
    const { ctx, calls } = mockContext()
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => 'data:image/png;base64,ANGLE',
      }
      return canvas as unknown as HTMLCanvasElement
    })

    const source = mockSource(100, 100)
    const result = compositeAnnotatedSlicePng({
      source,
      seriesName: 'Series',
      sliceIndex: 0,
      sliceCount: 8,
      window: 1,
      level: 0.5,
      labels: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
      measurements: [
        {
          id: 1,
          tool: 'angle',
          start: { x: 0.1, y: 0.5 },
          vertex: { x: 0.5, y: 0.5 },
          end: { x: 0.5, y: 0.1 },
          label: '90°',
        },
      ],
    })

    expect(result).toBe('data:image/png;base64,ANGLE')
    // Polyline path: start → vertex → end
    expect(calls.some((call) => call.method === 'moveTo' && call.args[0] === 10 && call.args[1] === 50)).toBe(true)
    expect(calls.some((call) => call.method === 'lineTo' && call.args[0] === 50 && call.args[1] === 50)).toBe(true)
    expect(calls.some((call) => call.method === 'lineTo' && call.args[0] === 50 && call.args[1] === 10)).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === '90°')).toBe(true)
    // Three endpoints
    expect(calls.filter((call) => call.method === 'arc').length).toBeGreaterThanOrEqual(3)

    createElement.mockRestore()
  })

  it('draws pinned probe crosshairs and intensity labels', () => {
    const { ctx, calls } = mockContext()
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => 'data:image/png;base64,PROBES',
      }
      return canvas as unknown as HTMLCanvasElement
    })

    const source = mockSource()
    const result = compositeAnnotatedSlicePng({
      source,
      seriesName: 'Ax FLAIR',
      sliceIndex: 2,
      sliceCount: 16,
      window: 1,
      level: 0.5,
      labels: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
      measurements: [],
      pinnedProbes: [
        {
          x: 0.4,
          y: 0.6,
          intensityLabel: 'I 128 · 1024',
          coordsLabel: 'c 32 · r 48',
        },
      ],
    })

    expect(result).toBe('data:image/png;base64,PROBES')
    expect(calls.some((call) => call.method === 'drawImage' && call.args[0] === source)).toBe(true)
    // Crosshair arms + ring
    expect(calls.some((call) => call.method === 'lineTo')).toBe(true)
    expect(calls.some((call) => call.method === 'arc')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'I 128 · 1024')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'c 32 · r 48')).toBe(true)

    createElement.mockRestore()
  })

  it('omits pin drawing when pinnedProbes is empty or absent', () => {
    const { ctx, calls } = mockContext()
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => 'data:image/png;base64,NOPINS',
      }
      return canvas as unknown as HTMLCanvasElement
    })

    const source = mockSource()
    compositeAnnotatedSlicePng({
      source,
      seriesName: 'Series',
      sliceIndex: 0,
      sliceCount: 4,
      window: 1,
      level: 0.5,
      labels: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
      measurements: [],
    })

    expect(calls.some((call) => call.method === 'fillText' && String(call.args[0]).startsWith('I '))).toBe(false)
    expect(calls.some((call) => call.method === 'fillText' && String(call.args[0]).startsWith('c '))).toBe(false)

    createElement.mockRestore()
  })

  it('falls back to the source data URL when the composite context is missing', () => {
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      return {
        width: 0,
        height: 0,
        getContext: () => null,
        toDataURL: () => 'data:image/png;base64,COMPOSITE',
      } as unknown as HTMLCanvasElement
    })

    const source = mockSource(16, 16)
    const result = compositeAnnotatedSlicePng({
      source,
      seriesName: 'Series',
      sliceIndex: 0,
      sliceCount: 10,
      window: 0.8,
      level: 0.4,
      labels: { top: 'S', right: 'P', bottom: 'I', left: 'A' },
      measurements: [],
    })

    expect(result).toBe('data:image/png;base64,SOURCE')
    createElement.mockRestore()
  })
})

describe('renderAnnotatedSliceCanvas', () => {
  it('returns a canvas with the annotated frame', () => {
    const { ctx } = mockContext()
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => 'data:image/png;base64,CANVAS',
      }
      return canvas as unknown as HTMLCanvasElement
    })

    const source = mockSource(64, 48)
    const result = renderAnnotatedSliceCanvas({
      source,
      seriesName: 'Series',
      sliceIndex: 0,
      sliceCount: 4,
      window: 1,
      level: 0.5,
      labels: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
      measurements: [],
    })

    expect(result).not.toBeNull()
    expect(result?.width).toBe(64)
    expect(result?.height).toBe(48)
    createElement.mockRestore()
  })

  it('returns null when the source has no size', () => {
    const source = mockSource(0, 0)
    expect(
      renderAnnotatedSliceCanvas({
        source,
        seriesName: 'Series',
        sliceIndex: 0,
        sliceCount: 1,
        window: 1,
        level: 0.5,
        labels: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
        measurements: [],
      }),
    ).toBeNull()
  })
})

describe('compositeCompareSlicePng', () => {
  it('stitches A and B with gutter and pane badges', () => {
    const { ctx, calls } = mockContext()
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => 'data:image/png;base64,COMPARE',
      }
      return canvas as unknown as HTMLCanvasElement
    })

    const left = mockSource(80, 60)
    const right = mockSource(100, 80)
    const result = compositeCompareSlicePng({
      left,
      right,
      gutter: 8,
      leftLabel: 'A',
      rightLabel: 'B',
    })

    expect(result).toBe('data:image/png;base64,COMPARE')
    // Shared height = max(60, 80) = 80; left scaled to 80/60
    const drawCalls = calls.filter((call) => call.method === 'drawImage')
    expect(drawCalls.length).toBe(2)
    expect(drawCalls[0].args[0]).toBe(left)
    expect(drawCalls[0].args[3]).toBe(Math.round(80 * (80 / 60))) // leftW
    expect(drawCalls[0].args[4]).toBe(80) // targetH
    expect(drawCalls[1].args[0]).toBe(right)
    expect(drawCalls[1].args[1]).toBe(Math.round(80 * (80 / 60)) + 8) // leftW + gutter
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'A')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'B')).toBe(true)

    createElement.mockRestore()
  })

  it('falls back to left-only when right has no size', () => {
    const left = mockSource(40, 40)
    const right = mockSource(0, 0)
    const result = compositeCompareSlicePng({ left, right })
    expect(result).toBe('data:image/png;base64,SOURCE')
    expect(left.toDataURL).toHaveBeenCalled()
  })
})

describe('compositeAnnotatedVolumePng', () => {
  it('composites the WebGL frame with volume metadata including crop', () => {
    const { ctx, calls } = mockContext()
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => 'data:image/png;base64,VOLUME',
      }
      return canvas as unknown as HTMLCanvasElement
    })

    const source = mockSource(120, 90)
    const result = compositeAnnotatedVolumePng({
      source,
      seriesName: 'Ax 3D SPACE IAC',
      orientation: 'Axial',
      mode: 'enhanced',
      dimensions: [256, 256, 96],
      paletteName: 'thermal',
      cropActive: true,
    })

    expect(result).toBe('data:image/png;base64,VOLUME')
    expect(calls.some((call) => call.method === 'drawImage' && call.args[0] === source)).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'Ax 3D SPACE IAC')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'Axial · Enhanced')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === '256 × 256 × 96')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'Palette thermal')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'Crop active')).toBe(true)

    createElement.mockRestore()
  })

  it('labels acquired mode and omits crop when inactive', () => {
    const { ctx, calls } = mockContext()
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => 'data:image/png;base64,ACQUIRED',
      }
      return canvas as unknown as HTMLCanvasElement
    })

    const source = mockSource()
    compositeAnnotatedVolumePng({
      source,
      seriesName: 'Cor T2',
      orientation: 'Coronal',
      mode: 'acquired',
      dimensions: [512, 512, 24],
      paletteName: 'bone',
      cropActive: false,
    })

    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'Coronal · Acquired')).toBe(true)
    expect(calls.some((call) => call.method === 'fillText' && call.args[0] === 'Crop active')).toBe(false)

    createElement.mockRestore()
  })

  it('falls back to the source data URL when the composite context is missing', () => {
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      return {
        width: 0,
        height: 0,
        getContext: () => null,
        toDataURL: () => 'data:image/png;base64,COMPOSITE',
      } as unknown as HTMLCanvasElement
    })

    const source = mockSource(16, 16)
    const result = compositeAnnotatedVolumePng({
      source,
      seriesName: 'Series',
      orientation: 'Sagittal',
      mode: 'acquired',
      dimensions: [64, 64, 8],
      paletteName: 'cyan',
      cropActive: false,
    })

    expect(result).toBe('data:image/png;base64,SOURCE')
    createElement.mockRestore()
  })
})
