import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReconstructedVolume, VolumeData } from '../types'
import { useVolumeReconstruction } from './useVolumeReconstruction'

function makeVolume(overrides: Partial<VolumeData> = {}): VolumeData {
  return {
    seriesId: 'series-a',
    description: 'test',
    data: new Uint8Array([1, 2, 3, 4]),
    dimensions: [2, 2, 1],
    spacing: [1, 1, 1],
    physicalSize: [2, 2, 1],
    scalarRange: [0, 1],
    fullScalarRange: [0, 1],
    orientation: 'axial',
    sliceCount: 1,
    ...overrides,
  }
}

function makeReadyVolume(seriesId = 'series-a'): ReconstructedVolume {
  return {
    seriesId,
    data: new Uint8Array([9, 9, 9, 9]),
    dimensions: [2, 2, 2],
    spacing: [1, 1, 0.5],
    sourceDepth: 1,
    factor: 2,
    syntheticSlices: 1,
  }
}

class FakeWorker {
  static instances: FakeWorker[] = []
  terminate = vi.fn()
  postMessage = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()

  constructor() {
    FakeWorker.instances.push(this)
  }

  /** Deliver a worker message to the registered handler. */
  emit(data: unknown) {
    for (const [type, handler] of this.addEventListener.mock.calls) {
      if (type === 'message') {
        ;(handler as (event: MessageEvent) => void)({ data } as MessageEvent)
      }
    }
  }
}

function completeWorker(worker: FakeWorker, seriesId = 'series-a') {
  const posted = worker.postMessage.mock.calls[0]?.[0] as { requestId: number }
  worker.emit({
    type: 'complete',
    requestId: posted.requestId,
    volume: makeReadyVolume(seriesId),
  })
}

describe('useVolumeReconstruction', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('creates no worker when source is null', () => {
    const { result } = renderHook(() => useVolumeReconstruction(null))
    expect(FakeWorker.instances).toHaveLength(0)
    expect(result.current.status).toBe('idle')
  })

  it('creates no worker when enabled is false even with a source', () => {
    const source = makeVolume()
    const { result } = renderHook(() =>
      useVolumeReconstruction(source, { enabled: false, seriesId: source.seriesId }),
    )
    expect(FakeWorker.instances).toHaveLength(0)
    expect(result.current.status).toBe('idle')
  })

  it('creates a worker when enabled with a source', () => {
    const source = makeVolume()
    const { result } = renderHook(() =>
      useVolumeReconstruction(source, { enabled: true, seriesId: source.seriesId }),
    )
    expect(FakeWorker.instances).toHaveLength(1)
    expect(result.current.status).toBe('processing')
    const worker = FakeWorker.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ seriesId: 'series-a' }),
      expect.any(Array),
    )
  })

  it('creates a worker by default when only source is passed (enabled defaults true)', () => {
    const source = makeVolume()
    renderHook(() => useVolumeReconstruction(source))
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('terminates the worker when enabled flips to false', () => {
    const source = makeVolume()
    const { rerender } = renderHook(
      ({ enabled }) => useVolumeReconstruction(source, { enabled, seriesId: source.seriesId }),
      { initialProps: { enabled: true } },
    )
    expect(FakeWorker.instances).toHaveLength(1)
    const worker = FakeWorker.instances[0]
    rerender({ enabled: false })
    expect(worker.terminate).toHaveBeenCalled()
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('does not start a new worker when VolumeData is a new object with the same data buffer', () => {
    const data = new Uint8Array([1, 2, 3, 4])
    const first = makeVolume({ data })
    const { result, rerender } = renderHook(
      ({ source }) =>
        useVolumeReconstruction(source, { enabled: true, seriesId: source.seriesId }),
      { initialProps: { source: first } },
    )
    expect(FakeWorker.instances).toHaveLength(1)

    act(() => {
      completeWorker(FakeWorker.instances[0])
    })
    expect(result.current.status).toBe('ready')

    const second = makeVolume({ data }) // new wrapper, same buffer identity
    expect(second).not.toBe(first)
    rerender({ source: second })

    expect(FakeWorker.instances).toHaveLength(1)
    expect(result.current.status).toBe('ready')
    expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled()
  })

  it('reuses a ready result for the same seriesId after disable then re-enable', () => {
    const source = makeVolume()
    const { result, rerender } = renderHook(
      ({ enabled }) => useVolumeReconstruction(source, { enabled, seriesId: source.seriesId }),
      { initialProps: { enabled: true } },
    )
    act(() => {
      completeWorker(FakeWorker.instances[0])
    })
    expect(result.current.status).toBe('ready')
    expect(FakeWorker.instances).toHaveLength(1)

    rerender({ enabled: false })
    expect(result.current.status).toBe('idle')
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled()

    rerender({ enabled: true })
    expect(FakeWorker.instances).toHaveLength(1)
    expect(result.current.status).toBe('ready')
    expect(result.current.volume?.seriesId).toBe('series-a')
  })

  it('starts a new worker when the data buffer identity changes', () => {
    const firstData = new Uint8Array([1, 2, 3, 4])
    const first = makeVolume({ data: firstData })
    const { result, rerender } = renderHook(
      ({ source }) =>
        useVolumeReconstruction(source, { enabled: true, seriesId: source.seriesId }),
      { initialProps: { source: first } },
    )
    act(() => {
      completeWorker(FakeWorker.instances[0])
    })
    expect(result.current.status).toBe('ready')

    const second = makeVolume({ data: new Uint8Array([1, 2, 3, 4]) })
    rerender({ source: second })

    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled()
    expect(result.current.status).toBe('processing')
  })

  it('starts a new worker when dimensions change for the same seriesId', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const first = makeVolume({ data, dimensions: [2, 2, 1], sliceCount: 1 })
    const { result, rerender } = renderHook(
      ({ source }) =>
        useVolumeReconstruction(source, { enabled: true, seriesId: source.seriesId }),
      { initialProps: { source: first } },
    )
    act(() => {
      completeWorker(FakeWorker.instances[0])
    })

    const second = makeVolume({ data, dimensions: [2, 2, 2], sliceCount: 2 })
    rerender({ source: second })

    expect(FakeWorker.instances).toHaveLength(2)
    expect(result.current.status).toBe('processing')
  })
})
