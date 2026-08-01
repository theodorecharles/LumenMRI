import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VolumeData, WorkerRequest, WorkerResponse } from '../types'
import { useDicomLoader } from './useDicomLoader'

type WorkerListener = (event: MessageEvent<WorkerResponse>) => void

function makeVolume(seriesId = 'series-a'): VolumeData {
  return {
    seriesId,
    description: 'T1',
    data: new Uint8Array([1, 2, 3]),
    dimensions: [1, 1, 1],
    spacing: [1, 1, 1],
    physicalSize: [1, 1, 1],
    scalarRange: [0, 1],
    fullScalarRange: [0, 1],
    orientation: 'axial',
    sliceCount: 1,
  }
}

function workerBusy(phase: string) {
  return phase === 'scanning' || phase === 'loading'
}

describe('useDicomLoader cancelInFlight clears sticky progress (AC-3)', () => {
  let listeners: WorkerListener[]
  let posted: WorkerRequest[]

  beforeEach(() => {
    listeners = []
    posted = []
    vi.stubGlobal(
      'Worker',
      class MockWorker {
        postMessage(message: WorkerRequest) {
          posted.push(message)
        }
        addEventListener(_type: string, listener: WorkerListener) {
          listeners.push(listener)
        }
        removeEventListener() {}
        terminate() {}
      },
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function emit(message: WorkerResponse) {
    for (const listener of listeners) {
      listener({ data: message } as MessageEvent<WorkerResponse>)
    }
  }

  it('cancel during scan sets idle so workerBusy is false', () => {
    const { result } = renderHook(() => useDicomLoader())

    act(() => {
      result.current.scanFiles([new File(['x'], 'a.dcm')])
    })
    expect(result.current.progress.phase).toBe('scanning')
    expect(workerBusy(result.current.progress.phase)).toBe(true)

    act(() => {
      result.current.cancelInFlight()
    })

    expect(posted.some((m) => m.type === 'cancel')).toBe(true)
    expect(result.current.progress.phase).toBe('idle')
    expect(result.current.progress.label).toBe('Ready')
    expect(workerBusy(result.current.progress.phase)).toBe(false)

    // Stale worker posts must not re-stick scanning/loading after cancel.
    act(() => {
      emit({ type: 'scan-progress', progress: 0.5, label: 'Still scanning' })
      emit({ type: 'load-progress', progress: 0.2, label: 'Preparing volume' })
    })
    expect(result.current.progress.phase).toBe('idle')
    expect(workerBusy(result.current.progress.phase)).toBe(false)
  })

  it('cancel during load-series with volume shown sets ready so workerBusy is false', () => {
    const { result } = renderHook(() => useDicomLoader())
    const volume = makeVolume()

    act(() => {
      result.current.setVolume(volume)
    })
    expect(result.current.progress.phase).toBe('ready')

    act(() => {
      result.current.loadSeries('series-b')
    })
    expect(result.current.progress.phase).toBe('loading')
    expect(result.current.progress.label).toBe('Preparing volume')
    expect(workerBusy(result.current.progress.phase)).toBe(true)
    expect(result.current.volume?.seriesId).toBe('series-a')

    act(() => {
      result.current.cancelInFlight()
    })

    expect(posted.some((m) => m.type === 'cancel')).toBe(true)
    expect(result.current.progress.phase).toBe('ready')
    expect(result.current.progress.label).toBe('GPU volume ready')
    expect(workerBusy(result.current.progress.phase)).toBe(false)
    expect(result.current.volume?.seriesId).toBe('series-a')

    act(() => {
      emit({ type: 'load-progress', progress: 0.9, label: 'Preparing volume' })
      emit({ type: 'error', message: 'should be dropped' })
    })
    expect(result.current.progress.phase).toBe('ready')
    expect(result.current.error).toBeNull()
    expect(workerBusy(result.current.progress.phase)).toBe(false)
  })

  it('cancel during load-series with no volume sets idle', () => {
    const { result } = renderHook(() => useDicomLoader())

    act(() => {
      result.current.loadSeries('series-only')
    })
    expect(result.current.progress.phase).toBe('loading')

    act(() => {
      result.current.cancelInFlight()
    })

    expect(result.current.progress.phase).toBe('idle')
    expect(workerBusy(result.current.progress.phase)).toBe(false)
  })
})
