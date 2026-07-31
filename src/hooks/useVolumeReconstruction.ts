import { useEffect, useRef, useState } from 'react'
import type { ReconstructedVolume, VolumeData } from '../types'
import { reconstructionOptionsForDevice } from '../lib/reconstructVolume'

export interface ReconstructionState {
  status: 'idle' | 'processing' | 'ready' | 'error'
  progress: number
  volume: ReconstructedVolume | null
  message: string
}

export interface UseVolumeReconstructionOptions {
  /** When false, no reconstruction worker is created. Defaults to true. */
  enabled?: boolean
  /** Series identity for the active volume; defaults to `source?.seriesId`. */
  seriesId?: string | null
}

const IDLE_STATE: ReconstructionState = {
  status: 'idle',
  progress: 0,
  volume: null,
  message: 'Waiting for volume',
}

/** Ready result keyed by series identity + geometry + data buffer identity. */
interface ReadyCache {
  seriesId: string
  dimX: number
  dimY: number
  dimZ: number
  spX: number
  spY: number
  spZ: number
  dataGeneration: Uint8Array
  state: ReconstructionState
}

function cacheMatches(
  cache: ReadyCache | null,
  seriesId: string,
  dimX: number,
  dimY: number,
  dimZ: number,
  spX: number,
  spY: number,
  spZ: number,
  dataGeneration: Uint8Array,
): cache is ReadyCache {
  return (
    cache !== null &&
    cache.seriesId === seriesId &&
    cache.dimX === dimX &&
    cache.dimY === dimY &&
    cache.dimZ === dimZ &&
    cache.spX === spX &&
    cache.spY === spY &&
    cache.spZ === spZ &&
    cache.dataGeneration === dataGeneration &&
    cache.state.status === 'ready' &&
    cache.state.volume !== null
  )
}

export function useVolumeReconstruction(
  source: VolumeData | null,
  options: UseVolumeReconstructionOptions = {},
) {
  const enabled = options.enabled ?? true
  const seriesId = options.seriesId ?? source?.seriesId ?? null
  const requestRef = useRef(0)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const readyCacheRef = useRef<ReadyCache | null>(null)
  const [state, setState] = useState<ReconstructionState>(IDLE_STATE)

  // Primitive / stable tokens — not the VolumeData object (AC-3).
  const dimX = source?.dimensions[0] ?? null
  const dimY = source?.dimensions[1] ?? null
  const dimZ = source?.dimensions[2] ?? null
  const spX = source?.spacing[0] ?? null
  const spY = source?.spacing[1] ?? null
  const spZ = source?.spacing[2] ?? null
  /** Buffer identity; stable across new VolumeData wrappers for the same load. */
  const dataGeneration = source?.data ?? null

  useEffect(() => {
    // Reconstruction disabled: do not create a worker. Cleanup of a prior effect
    // terminates any in-flight worker (AC-1, AC-4).
    if (!enabled) {
      setState(IDLE_STATE)
      return
    }

    const current = sourceRef.current
    if (
      !current ||
      seriesId == null ||
      dimX == null ||
      dimY == null ||
      dimZ == null ||
      spX == null ||
      spY == null ||
      spZ == null ||
      dataGeneration == null
    ) {
      setState(IDLE_STATE)
      return
    }

    // Reuse a ready result for the same series identity (AC-2).
    if (
      cacheMatches(
        readyCacheRef.current,
        seriesId,
        dimX,
        dimY,
        dimZ,
        spX,
        spY,
        spZ,
        dataGeneration,
      )
    ) {
      setState(readyCacheRef.current.state)
      return
    }

    const requestId = ++requestRef.current
    const worker = new Worker(new URL('../workers/reconstruction.worker.ts', import.meta.url), {
      type: 'module',
    })
    const deviceOptions = reconstructionOptionsForDevice({
      compactViewport: window.matchMedia('(max-width: 690px)').matches,
      hardwareConcurrency: navigator.hardwareConcurrency,
    })
    const copy = current.data.slice()
    setState({
      status: 'processing',
      progress: 0,
      volume: null,
      message: 'Registering acquired slices',
    })

    worker.addEventListener('message', (event: MessageEvent<{
      type: 'progress' | 'complete' | 'error'
      requestId: number
      progress?: number
      volume?: ReconstructedVolume
      message?: string
    }>) => {
      const message = event.data
      if (message.requestId !== requestId) return
      if (message.type === 'progress') {
        const progress = message.progress || 0
        setState((currentState) => ({
          ...currentState,
          progress,
          message: `Synthesizing anatomical layers · ${Math.round(progress * 100)}%`,
        }))
      } else if (message.type === 'complete' && message.volume) {
        const readyState: ReconstructionState = {
          status: 'ready',
          progress: 1,
          volume: message.volume,
          message: `${message.volume.dimensions[2]} reconstructed planes`,
        }
        readyCacheRef.current = {
          seriesId,
          dimX,
          dimY,
          dimZ,
          spX,
          spY,
          spZ,
          dataGeneration,
          state: readyState,
        }
        setState(readyState)
      } else if (message.type === 'error') {
        setState({
          status: 'error',
          progress: 0,
          volume: null,
          message: message.message || 'Using acquired slices without reconstruction',
        })
      }
    })

    worker.postMessage({
      requestId,
      seriesId,
      data: copy,
      dimensions: current.dimensions,
      spacing: current.spacing,
      options: deviceOptions,
    }, [copy.buffer])

    return () => worker.terminate()
  }, [enabled, seriesId, dimX, dimY, dimZ, spX, spY, spZ, dataGeneration])

  return state
}
