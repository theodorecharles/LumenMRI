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

export function useDicomLoader() {
  const workerRef = useRef<Worker | null>(null)
  /** Series id for the in-flight load-series the UI still wants; null = ignore volume-ready. */
  const pendingLoadSeriesIdRef = useRef<string | null>(null)
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
          setSeries(message.series)
          setProgress({
            phase: 'ready',
            progress: 1,
            label: `${message.series.length} MRI series indexed`,
          })
          break
        case 'load-progress':
          // Drop progress from a load the UI has already abandoned (bundled/demo/home).
          if (!pendingLoadSeriesIdRef.current) break
          setProgress({ phase: 'loading', progress: message.progress, label: message.label })
          break
        case 'volume-ready':
          // Stale decode after leave/bundled/demo must not overwrite the volume the user opened.
          if (message.volume.seriesId !== pendingLoadSeriesIdRef.current) break
          pendingLoadSeriesIdRef.current = null
          setVolume(message.volume)
          setProgress({ phase: 'ready', progress: 1, label: 'GPU volume ready' })
          break
        case 'error':
          // After abandonLoad, cancel stops the worker before it posts; still ignore if we
          // already cleared the pending series (race with a message already in flight).
          if (pendingLoadSeriesIdRef.current) {
            pendingLoadSeriesIdRef.current = null
          }
          setError(message.message)
          setProgress({ phase: 'error', progress: 0, label: message.message })
          break
      }
    })

    return () => dicomWorker.terminate()
  }, [])

  const send = useCallback((message: WorkerRequest) => workerRef.current?.postMessage(message), [])

  /**
   * Stop caring about an in-flight load-series and tell the worker to drop it.
   * Clears loading progress so the UI does not stay busy after leave/home.
   */
  const abandonLoad = useCallback(() => {
    const hadPending = pendingLoadSeriesIdRef.current !== null
    pendingLoadSeriesIdRef.current = null
    send({ type: 'cancel' })
    if (hadPending) {
      setProgress((current) =>
        current.phase === 'loading'
          ? { phase: 'ready', progress: 1, label: current.label }
          : current,
      )
    }
  }, [send])

  /**
   * Set volume from outside a worker load (bundled series, demo). Abandons any in-flight
   * local decode so a late volume-ready cannot overwrite this volume.
   */
  const setVolumeExternal = useCallback(
    (next: VolumeData | null) => {
      pendingLoadSeriesIdRef.current = null
      send({ type: 'cancel' })
      setVolume(next)
      if (next) {
        setError(null)
        setProgress({ phase: 'ready', progress: 1, label: 'GPU volume ready' })
      }
    },
    [send],
  )

  const scanFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      pendingLoadSeriesIdRef.current = null
      setError(null)
      setSeries([])
      setVolume(null)
      setProgress({ phase: 'scanning', progress: 0, label: 'Reading DICOM headers' })
      send({ type: 'scan', files })
    },
    [send],
  )

  const loadSeries = useCallback(
    (seriesId: string) => {
      setError(null)
      pendingLoadSeriesIdRef.current = seriesId
      setProgress({ phase: 'loading', progress: 0, label: 'Preparing volume' })
      send({ type: 'load-series', seriesId })
    },
    [send],
  )

  const reset = useCallback(() => {
    pendingLoadSeriesIdRef.current = null
    send({ type: 'reset' })
    setSeries([])
    setVolume(null)
    setError(null)
    setProgress(IDLE_PROGRESS)
  }, [send])

  return {
    series,
    volume,
    setVolume: setVolumeExternal,
    progress,
    error,
    scanFiles,
    loadSeries,
    reset,
    abandonLoad,
  }
}
