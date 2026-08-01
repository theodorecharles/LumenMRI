import { describe, expect, it } from 'vitest'
import type { VolumeData } from '../types'
import { DEFAULT_LRU_CAPACITY, VolumeCache } from './volumeCache'

function stubVolume(seriesId: string): VolumeData {
  return {
    seriesId,
    description: seriesId,
    data: new Uint8Array(0),
    dimensions: [1, 1, 1],
    spacing: [1, 1, 1],
    physicalSize: [1, 1, 1],
    scalarRange: [0, 1],
    fullScalarRange: [0, 1],
    orientation: 'axial',
    sliceCount: 1,
  }
}

describe('VolumeCache', () => {
  it('inserts past the cap and retains only pinned keys plus LRU survivors', () => {
    const lruCapacity = DEFAULT_LRU_CAPACITY
    const cache = new VolumeCache(lruCapacity)
    cache.setPins('primary', 'compare')
    cache.set(stubVolume('primary'))
    cache.set(stubVolume('compare'))

    // Five non-pinned inserts with capacity 3 → oldest two drop.
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      cache.set(stubVolume(id))
    }

    expect(cache.has('primary')).toBe(true)
    expect(cache.has('compare')).toBe(true)
    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
    expect(cache.has('e')).toBe(true)

    expect(cache.size).toBe(2 + lruCapacity)
    expect(new Set(cache.keys())).toEqual(
      new Set(['primary', 'compare', 'c', 'd', 'e']),
    )
  })

  it('does not evict pinned series when LRU overflows', () => {
    const cache = new VolumeCache(2)
    cache.setPins('P', 'C')
    cache.set(stubVolume('P'))
    cache.set(stubVolume('C'))

    for (let i = 0; i < 10; i += 1) {
      cache.set(stubVolume(`extra-${i}`))
    }

    expect(cache.has('P')).toBe(true)
    expect(cache.has('C')).toBe(true)
    expect(cache.size).toBe(4) // 2 pins + LRU capacity 2
    expect(cache.has('extra-8')).toBe(true)
    expect(cache.has('extra-9')).toBe(true)
    expect(cache.has('extra-0')).toBe(false)
  })
})
