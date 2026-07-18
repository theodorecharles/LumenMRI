import { describe, expect, it } from 'vitest'
import { computeRoiStats, formatRoiSummary } from './roiStats'
import type { VolumeData } from '../types'

function makeVolume(overrides: Partial<VolumeData> = {}): VolumeData {
  const width = 4
  const height = 3
  const depth = 1
  // Known values: columns 0..3 → 10, 20, 30, 40 on every row
  const data = new Uint8Array(width * height * depth)
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      data[row * width + col] = (col + 1) * 10
    }
  }
  return {
    seriesId: 'test',
    description: 'roi stats',
    data,
    dimensions: [width, height, depth],
    spacing: [1, 1, 1],
    physicalSize: [4, 3, 1],
    scalarRange: [0, 255],
    fullScalarRange: [0, 255],
    orientation: 'axial',
    sliceCount: depth,
    ...overrides,
  }
}

describe('computeRoiStats', () => {
  it('reports area, mean, min, max, and population SD over the rect', () => {
    const volume = makeVolume()
    // Full image: values 10,20,30,40 × 3 rows
    const stats = computeRoiStats(
      volume,
      { start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, slice: 0 },
      4,
      3,
    )
    expect(stats.count).toBe(12)
    expect(stats.area).toBe(12)
    expect(stats.mean).toBe(25)
    expect(stats.min).toBe(10)
    expect(stats.max).toBe(40)
    // Population SD of [10,20,30,40] repeated 3×
    // mean 25; variance = ((-15)²+(-5)²+5²+15²)/4 = (225+25+25+225)/4 = 125
    expect(stats.sd).toBeCloseTo(Math.sqrt(125), 5)
  })

  it('uses spacing for physical area', () => {
    const volume = makeVolume({ spacing: [2, 0.5, 1] })
    const stats = computeRoiStats(
      volume,
      { start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, slice: 0 },
      4,
      3,
    )
    // 12 pixels × 2 × 0.5 = 12 mm²
    expect(stats.area).toBe(12)
  })

  it('returns zeros for an empty walk (degenerate bounds still clamp to ≥1 px)', () => {
    const volume = makeVolume()
    // Tiny rect still hits at least one pixel after floor/ceil clamp
    const stats = computeRoiStats(
      volume,
      { start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 }, slice: 0 },
      4,
      3,
    )
    expect(stats.count).toBeGreaterThanOrEqual(1)
    expect(stats.min).toBe(stats.max)
    expect(stats.sd).toBe(0)
  })
})

describe('formatRoiSummary', () => {
  it('formats two-line area · μ / σ · min–max', () => {
    const text = formatRoiSummary({
      count: 12,
      area: 40.2,
      mean: 48.4,
      min: 30,
      max: 60,
      sd: 12.3,
    })
    expect(text).toBe('40.2 mm² · μ 48\nσ 12 · 30–60')
  })

  it('uses one decimal for small SD', () => {
    const text = formatRoiSummary({
      count: 4,
      area: 4,
      mean: 10,
      min: 8,
      max: 12,
      sd: 1.5,
    })
    expect(text).toContain('σ 1.5')
  })
})
