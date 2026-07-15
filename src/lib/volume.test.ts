import { describe, expect, it } from 'vitest'
import {
  createDemoVolume,
  mapRelativeSliceIndex,
  midSliceIndex,
  normalizePhysicalSize,
} from './volume'
import { planVolumeReconstruction, reconstructVolume } from './reconstructVolume'

describe('volume utilities', () => {
  it('normalizes physical dimensions without changing their aspect ratio', () => {
    expect(normalizePhysicalSize([100, 200, 50])).toEqual([0.5, 1, 0.25])
  })

  it('maps relative stack depth when switching series', () => {
    // Same fractional depth: mid of 21 → mid of 41
    expect(mapRelativeSliceIndex(10, 21, 41)).toBe(20)
    // First / last endpoint preserve
    expect(mapRelativeSliceIndex(0, 21, 41)).toBe(0)
    expect(mapRelativeSliceIndex(20, 21, 41)).toBe(40)
    // Quarter depth: 5/20 = 0.25 → round(0.25 * 40) = 10
    expect(mapRelativeSliceIndex(5, 21, 41)).toBe(10)
    // Clamps out-of-range previous index
    expect(mapRelativeSliceIndex(99, 21, 10)).toBe(9)
    // No prior context / single-slice prior → mid of next
    expect(mapRelativeSliceIndex(0, 0, 21)).toBe(midSliceIndex(21))
    expect(mapRelativeSliceIndex(0, 1, 21)).toBe(midSliceIndex(21))
    // Degenerate next depth
    expect(mapRelativeSliceIndex(5, 21, 1)).toBe(0)
    expect(mapRelativeSliceIndex(5, 21, 0)).toBe(0)
  })

  it('computes mid-stack index', () => {
    expect(midSliceIndex(21)).toBe(10)
    expect(midSliceIndex(1)).toBe(0)
    expect(midSliceIndex(0)).toBe(0)
  })

  it('creates a non-empty, MRI-like demo volume', () => {
    const volume = createDemoVolume(40)
    expect(volume.data).toHaveLength(
      volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2],
    )
    expect(Math.max(...volume.data)).toBeGreaterThan(180)
    expect(volume.data.some((value) => value > 0)).toBe(true)
  })

  it('plans adaptive through-plane synthesis within its voxel budget', () => {
    const plan = planVolumeReconstruction(
      [512, 512, 40],
      [0.45, 0.45, 4],
      { maxDimension: 384, maxVoxels: 18_000_000, maxSliceFactor: 4 },
    )
    expect(plan.width).toBe(384)
    expect(plan.height).toBe(384)
    expect(plan.factor).toBe(3)
    expect(plan.depth).toBe(118)
    expect(plan.width * plan.height * plan.depth).toBeLessThanOrEqual(18_000_000)
  })

  it('creates registered synthetic slices while preserving acquired endpoints', async () => {
    const width = 64
    const height = 64
    const sliceSize = width * height
    const source = new Uint8Array(sliceSize * 2)
    for (let y = 18; y < 46; y += 1) {
      for (let x = 14; x < 30; x += 1) source[x + y * width] = 240
      for (let x = 18; x < 34; x += 1) source[sliceSize + x + y * width] = 240
    }

    const reconstructed = await reconstructVolume(
      'moving-structure',
      source,
      [width, height, 2],
      [1, 1, 4],
      { maxDimension: 64, maxVoxels: 64 * 64 * 5, maxSliceFactor: 4 },
    )

    expect(reconstructed.factor).toBe(4)
    expect(reconstructed.dimensions).toEqual([64, 64, 5])
    expect(reconstructed.syntheticSlices).toBe(3)
    expect(reconstructed.data.slice(0, sliceSize)).toEqual(source.slice(0, sliceSize))
    expect(reconstructed.data.slice(-sliceSize)).toEqual(source.slice(-sliceSize))
    const middle = reconstructed.data.subarray(sliceSize * 2, sliceSize * 3)
    expect(Math.max(...middle)).toBeGreaterThanOrEqual(235)
    expect(middle.filter((value) => value > 200).length).toBeGreaterThan(350)
  })
})
