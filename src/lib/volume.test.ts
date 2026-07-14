import { describe, expect, it } from 'vitest'
import { createDemoVolume, normalizePhysicalSize } from './volume'

describe('volume utilities', () => {
  it('normalizes physical dimensions without changing their aspect ratio', () => {
    expect(normalizePhysicalSize([100, 200, 50])).toEqual([0.5, 1, 0.25])
  })

  it('creates a non-empty, MRI-like demo volume', () => {
    const volume = createDemoVolume(40)
    expect(volume.data).toHaveLength(
      volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2],
    )
    expect(Math.max(...volume.data)).toBeGreaterThan(180)
    expect(volume.data.some((value) => value > 0)).toBe(true)
  })
})
