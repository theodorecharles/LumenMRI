import { describe, expect, it } from 'vitest'
import { formatProbeScalar, mapIntensityToDisplayGray, samplePixelAt } from './pixelProbe'
import type { VolumeData } from '../types'

function makeVolume(overrides: Partial<VolumeData> = {}): VolumeData {
  const width = 4
  const height = 3
  const depth = 2
  const data = new Uint8Array(width * height * depth)
  // Slice 0: ramp by column
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      data[row * width + col] = col * 50
    }
  }
  // Slice 1: constant
  data.fill(200, width * height)
  return {
    seriesId: 'test',
    description: 'probe test',
    data,
    dimensions: [width, height, depth],
    spacing: [1, 1, 1],
    physicalSize: [4, 3, 2],
    scalarRange: [0, 1000],
    fullScalarRange: [-100, 1200],
    orientation: 'axial',
    sliceCount: depth,
    ...overrides,
  }
}

describe('samplePixelAt', () => {
  it('maps normalized coords to col/row and stored intensity', () => {
    const volume = makeVolume()
    // Center of pixel (2, 1) → col 2 intensity 100
    const sample = samplePixelAt(volume, 0, (2 + 0.5) / 4, (1 + 0.5) / 3, 1, 0.5)
    expect(sample).not.toBeNull()
    expect(sample!.col).toBe(2)
    expect(sample!.row).toBe(1)
    expect(sample!.intensity).toBe(100)
  })

  it('maps intensity through scalarRange', () => {
    const volume = makeVolume()
    const sample = samplePixelAt(volume, 0, 0.5 / 4, 0.5 / 3, 1, 0.5)
    // col 0 intensity 0 → scalar 0
    expect(sample!.scalar).toBe(0)

    const bright = samplePixelAt(volume, 1, 0.5, 0.5, 1, 0.5)
    // intensity 200 → scalar 0 + 200/255 * 1000
    expect(bright!.intensity).toBe(200)
    expect(bright!.scalar).toBeCloseTo((200 / 255) * 1000, 5)
  })

  it('applies window/level to display gray', () => {
    const volume = makeVolume()
    // intensity 100, full window → display ≈ 100
    const full = samplePixelAt(volume, 0, (2 + 0.5) / 4, 0.5 / 3, 1, 0.5)
    expect(full!.display).toBe(100)

    // Narrow window around high values: mid-gray may clamp
    const narrow = samplePixelAt(volume, 0, (2 + 0.5) / 4, 0.5 / 3, 0.1, 0.9)
    expect(narrow!.display).toBeGreaterThanOrEqual(0)
    expect(narrow!.display).toBeLessThanOrEqual(255)
  })

  it('respects inverted display mapping for live probe D without changing stored I/scalar', () => {
    const volume = makeVolume()
    const nx = (2 + 0.5) / 4
    const ny = 0.5 / 3
    const normal = samplePixelAt(volume, 0, nx, ny, 1, 0.5, false)
    const inverted = samplePixelAt(volume, 0, nx, ny, 1, 0.5, true)
    expect(normal).not.toBeNull()
    expect(inverted).not.toBeNull()
    // Stored intensity and scalar are display-independent.
    expect(inverted!.intensity).toBe(normal!.intensity)
    expect(inverted!.scalar).toBe(normal!.scalar)
    expect(inverted!.col).toBe(normal!.col)
    expect(inverted!.row).toBe(normal!.row)
    // Display gray flips polarity after W/L.
    expect(normal!.display).toBe(100)
    expect(inverted!.display).toBe(255 - normal!.display)
    // Default invert arg is false (parity with legacy callers).
    const defaultArg = samplePixelAt(volume, 0, nx, ny, 1, 0.5)
    expect(defaultArg!.display).toBe(normal!.display)
  })

  it('returns null for out-of-bounds coords', () => {
    const volume = makeVolume()
    expect(samplePixelAt(volume, 0, -0.1, 0.5, 1, 0.5)).toBeNull()
    expect(samplePixelAt(volume, 0, 1.1, 0.5, 1, 0.5)).toBeNull()
  })

  it('clamps slice index', () => {
    const volume = makeVolume()
    const sample = samplePixelAt(volume, 99, 0.5, 0.5, 1, 0.5)
    expect(sample!.intensity).toBe(200)
  })
})

describe('formatProbeScalar', () => {
  it('picks precision by magnitude', () => {
    expect(formatProbeScalar(512)).toBe('512')
    expect(formatProbeScalar(12.34)).toBe('12.3')
    expect(formatProbeScalar(1.234)).toBe('1.23')
  })
})

describe('mapIntensityToDisplayGray', () => {
  it('matches full-window identity mapping without invert', () => {
    // intensity 100, window=1, level=0.5 → display 100
    expect(mapIntensityToDisplayGray(100, 1, 0.5, false)).toBe(100)
  })

  it('flips polarity after window/level when invert is true', () => {
    const normal = mapIntensityToDisplayGray(100, 1, 0.5, false)
    const inverted = mapIntensityToDisplayGray(100, 1, 0.5, true)
    expect(inverted).toBe(255 - normal)
    expect(mapIntensityToDisplayGray(0, 1, 0.5, true)).toBe(255)
    expect(mapIntensityToDisplayGray(255, 1, 0.5, true)).toBe(0)
  })

  it('does not mutate input intensity values (display-only)', () => {
    const intensity = 128
    mapIntensityToDisplayGray(intensity, 0.5, 0.5, true)
    expect(intensity).toBe(128)
  })
})
