import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ScanProgress,
  SeriesSummary,
  VolumeData,
  WorkerRequest,
  WorkerResponse,
} from '../types'

const IDLE_PROGRESS: ScanProgress = {
  phase: 'idle',
  progress: 0,
  label: 'Ready',
}

export type LoadSeriesOptions = {
  /** When set, volume-ready is delivered here instead of replacing the primary volume. */
  onVolume?: (volume: VolumeData) => void
}

export function useDicomLoader() {
  const workerRef = useRef<Worker | null>(null)
  /** One-shot handler for compare-pane loads that must not clobber the primary volume. */
  const pendingOnVolumeRef = useRef<((volume: VolumeData) => void) | null>(null)
  const [series, setSeries] = useState<SeriesSummary[]>([])
  const [volume, setVolume] = useState<VolumeData | null>(null)
  const [progress, setProgress] = useState<ScanProgress>(IDLE_PROGRESS)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dicomWorker = new Worker(new URL('../workers/dicom.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = dicomWorker

    dicomWorker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      switch (message.type) {
        case 'scan-progress':
          setProgress({ phase: 'scanning', progress: message.progress, label: message.label })
          break
        case 'scan-complete':
          pendingOnVolumeRef.current = null
          setSeries(message.series)
          setProgress({
            phase: 'ready',
            progress: 1,
            label: `${message.series.length} MRI series indexed`,
          })
          break
        case 'load-progress':
          setProgress({ phase: 'loading', progress: message.progress, label: message.label })
          break
        case 'volume-ready': {
          const onVolume = pendingOnVolumeRef.current
          pendingOnVolumeRef.current = null
          if (onVolume) {
            onVolume(message.volume)
          } else {
            setVolume(message.volume)
          }
          setError(null)
          setProgress({ phase: 'ready', progress: 1, label: 'GPU volume ready' })
          break
        }
        case 'error':
          pendingOnVolumeRef.current = null
          setError(message.message)
          setProgress({ phase: 'error', progress: 0, label: message.message })
          break
      }
    })

    return () => dicomWorker.terminate()
  }, [])

  const send = useCallback((message: WorkerRequest) => workerRef.current?.postMessage(message), [])

  // Bundled / demo paths set volume outside the worker. Always clear sticky error
  // and progress so stage-inline-error and footer is-error do not outlive a valid open.
  const setVolumeClearingError = useCallback((next: VolumeData | null) => {
    setVolume(next)
    setError(null)
    setProgress(
      next
        ? { phase: 'ready', progress: 1, label: 'GPU volume ready' }
        : IDLE_PROGRESS,
    )
  }, [])

  const scanFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      pendingOnVolumeRef.current = null
      setError(null)
      setSeries([])
      setVolume(null)
      setProgress({ phase: 'scanning', progress: 0, label: 'Reading DICOM headers' })
      send({ type: 'scan', files })
    },
    [send],
  )

  const loadSeries = useCallback(
    (seriesId: string, options?: LoadSeriesOptions) => {
      setError(null)
      setProgress({ phase: 'loading', progress: 0, label: 'Preparing volume' })
      pendingOnVolumeRef.current = options?.onVolume ?? null
      send({ type: 'load-series', seriesId })
    },
    [send],
  )

  const reset = useCallback(() => {
    pendingOnVolumeRef.current = null
    send({ type: 'reset' })
    setSeries([])
    setVolume(null)
    setError(null)
    setProgress(IDLE_PROGRESS)
  }, [send])

  return {
    series,
    volume,
    setVolume: setVolumeClearingError,
    progress,
    error,
    setError,
    scanFiles,
    loadSeries,
    reset,
  }
}
