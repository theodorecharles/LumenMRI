import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VolumeData } from '../types'
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

class FakeWorker {
  static instances: FakeWorker[] = []
  terminate = vi.fn()
  postMessage = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()

  constructor() {
    FakeWorker.instances.push(this)
  }
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
})
