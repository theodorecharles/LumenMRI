import { describe, expect, it } from 'vitest'
import { isReconstructionReady } from './reconstructVolume'

describe('isReconstructionReady', () => {
  it('is false when no volume is loaded', () => {
    expect(isReconstructionReady(null, null)).toBe(false)
  })

  it('is false when a volume is loaded but nothing is reconstructed yet', () => {
    expect(isReconstructionReady(null, { seriesId: 'series-a' })).toBe(false)
  })

  it('is false when a stale reconstruction belongs to another series', () => {
    expect(isReconstructionReady({ seriesId: 'series-b' }, { seriesId: 'series-a' })).toBe(false)
  })

  it('is false when a reconstruction outlives the volume it came from', () => {
    expect(isReconstructionReady({ seriesId: 'series-a' }, null)).toBe(false)
  })

  it('is true when the reconstruction matches the active volume', () => {
    expect(isReconstructionReady({ seriesId: 'series-a' }, { seriesId: 'series-a' })).toBe(true)
  })
})
