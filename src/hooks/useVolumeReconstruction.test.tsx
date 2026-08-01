import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isReconstructionReady } from '../lib/reconstructVolume'
import type { ReconstructedVolume, VolumeData } from '../types'
import { useVolumeReconstruction } from './useVolumeReconstruction'

type WorkerMessage = {
  type: 'progress' | 'complete' | 'error'
  requestId: number
  progress?: number
  volume?: ReconstructedVolume
  message?: string
}

type MessageHandler = (event: MessageEvent<WorkerMessage>) => void

class MockWorker {
  static instances: MockWorker[] = []

  listeners = new Set<MessageHandler>()
  terminated = false
  posted: Array<{ data: unknown }> = []

  constructor(_url: URL | string, _options?: WorkerOptions) {
    MockWorker.instances.push(this)
  }

  addEventListener(type: string, handler: EventListenerOrEventListenerObject) {
    if (type === 'message') {
      this.listeners.add(handler as MessageHandler)
    }
  }

  removeEventListener(type: string, handler: EventListenerOrEventListenerObject) {
    if (type === 'message') {
      this.listeners.delete(handler as MessageHandler)
    }
  }

  postMessage(data: unknown) {
    this.posted.push({ data })
  }

  terminate() {
    this.terminated = true
  }

  /** Deliver a message as if the worker posted it (including after terminate). */
  deliver(message: WorkerMessage) {
    const event = { data: message } as MessageEvent<WorkerMessage>
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

function makeSource(seriesId: string): VolumeData {
  return {
    seriesId,
    description: seriesId,
    data: new Uint8Array([1, 2, 3, 4]),
    dimensions: [2, 2, 1],
    spacing: [1, 1, 1],
    physicalSize: [2, 2, 1],
    scalarRange: [0, 1],
    fullScalarRange: [0, 1],
    orientation: 'axial',
    sliceCount: 1,
  }
}

function makeReconstructed(seriesId: string): ReconstructedVolume {
  return {
    seriesId,
    data: new Uint8Array([9, 9, 9, 9]),
    dimensions: [2, 2, 1],
    spacing: [1, 1, 1],
    sourceDepth: 1,
    factor: 1,
    syntheticSlices: 0,
  }
}

beforeEach(() => {
  MockWorker.instances = []
  vi.stubGlobal('Worker', MockWorker)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useVolumeReconstruction stale requestId guard (AC-1)', () => {
  it('ignores messages whose requestId is not the latest requestRef.current', () => {
    const sourceA = makeSource('series-a')
    const sourceB = makeSource('series-b')
    const volumeA = makeReconstructed('series-a')
    const volumeB = makeReconstructed('series-b')

    const { result, rerender } = renderHook(
      ({ source }: { source: VolumeData | null }) => useVolumeReconstruction(source),
      { initialProps: { source: sourceA } },
    )

    expect(MockWorker.instances).toHaveLength(1)
    const workerA = MockWorker.instances[0]
    expect(workerA.posted).toHaveLength(1)
    const requestIdA = (workerA.posted[0].data as { requestId: number }).requestId
    expect(result.current.status).toBe('processing')

    // Hop to series B — advances requestRef.current and starts a new worker.
    rerender({ source: sourceB })
    expect(workerA.terminated).toBe(true)
    expect(MockWorker.instances).toHaveLength(2)
    const workerB = MockWorker.instances[1]
    const requestIdB = (workerB.posted[0].data as { requestId: number }).requestId
    expect(requestIdB).toBeGreaterThan(requestIdA)
    expect(result.current.status).toBe('processing')
    expect(result.current.volume).toBeNull()

    // Stale complete from A (queued after terminate) must not overwrite B.
    act(() => {
      workerA.deliver({
        type: 'complete',
        requestId: requestIdA,
        volume: volumeA,
      })
    })

    expect(result.current.status).toBe('processing')
    expect(result.current.volume).toBeNull()

    // Latest request still applies.
    act(() => {
      workerB.deliver({
        type: 'complete',
        requestId: requestIdB,
        volume: volumeB,
      })
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.volume?.seriesId).toBe('series-b')
  })

  it('ignores stale progress and error messages for non-latest requestId', () => {
    const sourceA = makeSource('series-a')
    const sourceB = makeSource('series-b')

    const { result, rerender } = renderHook(
      ({ source }: { source: VolumeData | null }) => useVolumeReconstruction(source),
      { initialProps: { source: sourceA } },
    )

    const workerA = MockWorker.instances[0]
    const requestIdA = (workerA.posted[0].data as { requestId: number }).requestId

    rerender({ source: sourceB })
    const workerB = MockWorker.instances[1]

    act(() => {
      workerA.deliver({ type: 'progress', requestId: requestIdA, progress: 0.9 })
      workerA.deliver({
        type: 'error',
        requestId: requestIdA,
        message: 'stale failure from A',
      })
    })

    expect(result.current.status).toBe('processing')
    expect(result.current.volume).toBeNull()
    expect(result.current.message).not.toContain('stale failure')
    expect(workerB.posted).toHaveLength(1)
  })
})

describe('useVolumeReconstruction series hop A→B (AC-2)', () => {
  it('hopping A→B while A completes does not leave B with A’s volume or stuck isReconstructionReady', () => {
    const sourceA = makeSource('series-a')
    const sourceB = makeSource('series-b')
    const volumeA = makeReconstructed('series-a')
    const volumeB = makeReconstructed('series-b')

    const { result, rerender } = renderHook(
      ({ source }: { source: VolumeData | null }) => useVolumeReconstruction(source),
      { initialProps: { source: sourceA } },
    )

    const workerA = MockWorker.instances[0]
    const requestIdA = (workerA.posted[0].data as { requestId: number }).requestId

    // User hops A→B while A’s reconstruction is still in flight.
    rerender({ source: sourceB })
    const workerB = MockWorker.instances[1]
    const requestIdB = (workerB.posted[0].data as { requestId: number }).requestId
    expect(workerA.terminated).toBe(true)
    expect(result.current.status).toBe('processing')
    expect(result.current.volume).toBeNull()

    // Queued complete from terminated worker A arrives after the hop.
    act(() => {
      workerA.deliver({
        type: 'complete',
        requestId: requestIdA,
        volume: volumeA,
      })
    })

    // Must not apply A’s volume onto B (that would series-mismatch Enhanced forever).
    expect(result.current.volume).toBeNull()
    expect(result.current.volume?.seriesId).not.toBe('series-a')
    expect(result.current.status).not.toBe('ready')
    expect(isReconstructionReady(result.current.volume, sourceB)).toBe(false)
    // Guard against the stuck-failure shape: ready + wrong seriesId.
    expect(
      result.current.status === 'ready' &&
        result.current.volume?.seriesId === 'series-a' &&
        !isReconstructionReady(result.current.volume, sourceB),
    ).toBe(false)

    // B’s own complete still lands and enables Enhanced for B.
    act(() => {
      workerB.deliver({
        type: 'complete',
        requestId: requestIdB,
        volume: volumeB,
      })
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.volume?.seriesId).toBe('series-b')
    expect(isReconstructionReady(result.current.volume, sourceB)).toBe(true)
    expect(isReconstructionReady(result.current.volume, sourceA)).toBe(false)
  })
})
