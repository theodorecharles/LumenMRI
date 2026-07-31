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

export function useVolumeReconstruction(
  source: VolumeData | null,
  options: UseVolumeReconstructionOptions = {},
) {
  const enabled = options.enabled ?? true
  const seriesId = options.seriesId ?? source?.seriesId ?? null
  const requestRef = useRef(0)
  const [state, setState] = useState<ReconstructionState>(IDLE_STATE)

  useEffect(() => {
    // No source or reconstruction disabled: do not create a worker.
    if (!source || !enabled) {
      setState(IDLE_STATE)
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
    const copy = source.data.slice()
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
        setState((current) => ({
          ...current,
          progress,
          message: `Synthesizing anatomical layers · ${Math.round(progress * 100)}%`,
        }))
      } else if (message.type === 'complete' && message.volume) {
        setState({
          status: 'ready',
          progress: 1,
          volume: message.volume,
          message: `${message.volume.dimensions[2]} reconstructed planes`,
        })
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
      seriesId: seriesId ?? source.seriesId,
      data: copy,
      dimensions: source.dimensions,
      spacing: source.spacing,
      options: deviceOptions,
    }, [copy.buffer])

    return () => worker.terminate()
  }, [source, enabled, seriesId])

  return state
}
