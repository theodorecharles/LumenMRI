import { describe, expect, it } from 'vitest'
import {
  clearAnnotationStash,
  cloneAnnotationSnapshot,
  createAnnotationStash,
  emptyAnnotationSnapshot,
  hopSeriesAnnotations,
  maxAnnotationId,
  restoreSeriesAnnotations,
  stashSeriesAnnotations,
  type SeriesAnnotationSnapshot,
} from './annotationStash'

function sampleSnapshot(overrides?: Partial<SeriesAnnotationSnapshot>): SeriesAnnotationSnapshot {
  return {
    measurements: [
      {
        id: 1,
        tool: 'distance',
        slice: 2,
        start: { x: 0.1, y: 0.2 },
        end: { x: 0.4, y: 0.5 },
      },
      {
        id: 2,
        tool: 'roi',
        slice: 3,
        start: { x: 0.2, y: 0.2 },
        end: { x: 0.6, y: 0.7 },
      },
    ],
    pinnedProbes: [
      {
        id: 3,
        slice: 1,
        x: 0.5,
        y: 0.5,
        sample: { col: 10, row: 12, intensity: 80, display: 90, scalar: 400 },
      },
    ],
    ...overrides,
  }
}

describe('annotationStash', () => {
  it('keys snapshots by seriesId and restores distance, ROI, and pinned probes', () => {
    const stash = createAnnotationStash()
    const flair = sampleSnapshot()
    const t1: SeriesAnnotationSnapshot = {
      measurements: [
        {
          id: 10,
          tool: 'distance',
          slice: 0,
          start: { x: 0, y: 0 },
          end: { x: 1, y: 1 },
        },
      ],
      pinnedProbes: [],
    }

    stashSeriesAnnotations(stash, 'series-flair', flair)
    stashSeriesAnnotations(stash, 'series-t1', t1)

    const restoredFlair = restoreSeriesAnnotations(stash, 'series-flair')
    expect(restoredFlair.measurements).toHaveLength(2)
    expect(restoredFlair.measurements.map((m) => m.tool)).toEqual(['distance', 'roi'])
    expect(restoredFlair.pinnedProbes).toHaveLength(1)
    expect(restoredFlair.pinnedProbes[0]?.sample.scalar).toBe(400)

    const restoredT1 = restoreSeriesAnnotations(stash, 'series-t1')
    expect(restoredT1.measurements).toEqual([
      {
        id: 10,
        tool: 'distance',
        slice: 0,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
      },
    ])
    expect(restoredT1.pinnedProbes).toEqual([])
  })

  it('returns empty snapshot for an unknown seriesId without clearing others', () => {
    const stash = createAnnotationStash()
    stashSeriesAnnotations(stash, 'series-a', sampleSnapshot())

    expect(restoreSeriesAnnotations(stash, 'series-missing')).toEqual(emptyAnnotationSnapshot())
    expect(restoreSeriesAnnotations(stash, 'series-a').measurements).toHaveLength(2)
  })

  it('clones on stash and restore so later mutation does not rewrite the Map entry', () => {
    const stash = createAnnotationStash()
    const live = sampleSnapshot()
    stashSeriesAnnotations(stash, 'series-a', live)

    live.measurements[0]!.start.x = 0.99
    live.pinnedProbes[0]!.x = 0.01

    const first = restoreSeriesAnnotations(stash, 'series-a')
    expect(first.measurements[0]?.start.x).toBe(0.1)
    expect(first.pinnedProbes[0]?.x).toBe(0.5)

    first.measurements[0]!.end.x = 0.88
    const second = restoreSeriesAnnotations(stash, 'series-a')
    expect(second.measurements[0]?.end.x).toBe(0.4)
  })

  it('overwrites the same seriesId on re-stash (latest annotations win)', () => {
    const stash = createAnnotationStash()
    stashSeriesAnnotations(stash, 'series-a', sampleSnapshot())
    stashSeriesAnnotations(stash, 'series-a', {
      measurements: [
        {
          id: 99,
          tool: 'distance',
          slice: 5,
          start: { x: 0.3, y: 0.3 },
          end: { x: 0.7, y: 0.7 },
        },
      ],
      pinnedProbes: [],
    })

    const restored = restoreSeriesAnnotations(stash, 'series-a')
    expect(restored.measurements).toHaveLength(1)
    expect(restored.measurements[0]?.id).toBe(99)
    expect(restored.pinnedProbes).toEqual([])
  })

  it('clearAnnotationStash drops every series entry', () => {
    const stash = createAnnotationStash()
    stashSeriesAnnotations(stash, 'a', sampleSnapshot())
    stashSeriesAnnotations(stash, 'b', sampleSnapshot())
    clearAnnotationStash(stash)
    expect(restoreSeriesAnnotations(stash, 'a')).toEqual(emptyAnnotationSnapshot())
    expect(restoreSeriesAnnotations(stash, 'b')).toEqual(emptyAnnotationSnapshot())
    expect(stash.size).toBe(0)
  })

  describe('AC-3: series-card / Compare B hops do not clear the stash', () => {
    it('hopSeriesAnnotations stashes outgoing and restores incoming without clear', () => {
      const stash = createAnnotationStash()
      const flair = sampleSnapshot()
      const t1: SeriesAnnotationSnapshot = {
        measurements: [
          {
            id: 10,
            tool: 'distance',
            slice: 0,
            start: { x: 0, y: 0 },
            end: { x: 1, y: 1 },
          },
        ],
        pinnedProbes: [],
      }

      // Primary series-card hop FLAIR → T1 (outgoing live marks on FLAIR).
      const afterToT1 = hopSeriesAnnotations(stash, 'series-flair', 'series-t1', flair)
      expect(afterToT1).toEqual(emptyAnnotationSnapshot())
      expect(stash.size).toBe(1)
      expect(restoreSeriesAnnotations(stash, 'series-flair').measurements).toHaveLength(2)

      // User adds T1 marks, hops back to FLAIR (second series-card click).
      const afterBackToFlair = hopSeriesAnnotations(stash, 'series-t1', 'series-flair', t1)
      expect(afterBackToFlair.measurements.map((m) => m.tool)).toEqual(['distance', 'roi'])
      expect(afterBackToFlair.pinnedProbes).toHaveLength(1)
      expect(stash.size).toBe(2)
      expect(restoreSeriesAnnotations(stash, 'series-t1').measurements[0]?.id).toBe(10)
    })

    it('Compare B series hop preserves primary (peer) series entries in the same Map', () => {
      const stash = createAnnotationStash()
      // Primary already stashed FLAIR marks (shared session Map).
      stashSeriesAnnotations(stash, 'series-flair', sampleSnapshot())

      // Compare pane B: mount on ADC, then hop B to T1 — must not drop FLAIR.
      const onBMount = hopSeriesAnnotations(
        stash,
        null,
        'series-adc',
        emptyAnnotationSnapshot(),
      )
      expect(onBMount).toEqual(emptyAnnotationSnapshot())

      const adcMarks: SeriesAnnotationSnapshot = {
        measurements: [
          {
            id: 20,
            tool: 'roi',
            slice: 1,
            start: { x: 0.1, y: 0.1 },
            end: { x: 0.5, y: 0.5 },
          },
        ],
        pinnedProbes: [],
      }
      hopSeriesAnnotations(stash, 'series-adc', 'series-t1', adcMarks)

      expect(stash.has('series-flair')).toBe(true)
      expect(stash.has('series-adc')).toBe(true)
      expect(restoreSeriesAnnotations(stash, 'series-flair').pinnedProbes).toHaveLength(1)
      expect(restoreSeriesAnnotations(stash, 'series-adc').measurements[0]?.id).toBe(20)
      // No clearAnnotationStash: Map still holds peer series after B hop.
      expect(stash.size).toBe(2)
    })

    it('layout remount rehydrates the active series without clearing peers', () => {
      const stash = createAnnotationStash()
      stashSeriesAnnotations(stash, 'series-flair', sampleSnapshot())
      stashSeriesAnnotations(stash, 'series-t1', {
        measurements: [
          {
            id: 7,
            tool: 'distance',
            slice: 0,
            start: { x: 0, y: 0 },
            end: { x: 1, y: 1 },
          },
        ],
        pinnedProbes: [],
      })

      // Remount primary on FLAIR (e.g. enter Compare layout) — previousSeriesId null.
      const rehydrated = hopSeriesAnnotations(
        stash,
        null,
        'series-flair',
        emptyAnnotationSnapshot(),
      )
      expect(rehydrated.measurements).toHaveLength(2)
      expect(stash.size).toBe(2)
      expect(restoreSeriesAnnotations(stash, 'series-t1').measurements[0]?.id).toBe(7)
    })

    it('hop never empties the Map the way clearAnnotationStash does', () => {
      const stash = createAnnotationStash()
      stashSeriesAnnotations(stash, 'a', sampleSnapshot())
      stashSeriesAnnotations(stash, 'b', sampleSnapshot())
      const sizeBefore = stash.size

      hopSeriesAnnotations(stash, 'a', 'c', sampleSnapshot())
      expect(stash.size).toBeGreaterThanOrEqual(sizeBefore)
      expect(stash.has('a')).toBe(true)
      expect(stash.has('b')).toBe(true)

      clearAnnotationStash(stash)
      expect(stash.size).toBe(0)
    })
  })

  it('maxAnnotationId tracks the highest measurement or probe id', () => {
    expect(maxAnnotationId(emptyAnnotationSnapshot())).toBe(0)
    expect(maxAnnotationId(sampleSnapshot())).toBe(3)
    expect(
      maxAnnotationId({
        measurements: [],
        pinnedProbes: [
          {
            id: 42,
            slice: 0,
            x: 0,
            y: 0,
            sample: { col: 0, row: 0, intensity: 0, display: 0, scalar: 0 },
          },
        ],
      }),
    ).toBe(42)
  })

  it('cloneAnnotationSnapshot is a deep copy', () => {
    const original = sampleSnapshot()
    const cloned = cloneAnnotationSnapshot(original)
    cloned.measurements[0]!.start.x = 1
    cloned.pinnedProbes[0]!.sample.intensity = 1
    expect(original.measurements[0]?.start.x).toBe(0.1)
    expect(original.pinnedProbes[0]?.sample.intensity).toBe(80)
  })
})
