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
          setProgress({ phase: 'loading', progress: message.progress, label: message.label })
          break
        case 'volume-ready':
          setVolume(message.volume)
          setProgress({ phase: 'ready', progress: 1, label: 'GPU volume ready' })
          break
        case 'error':
          setError(message.message)
          setProgress({ phase: 'error', progress: 0, label: message.message })
          break
      }
    })

    return () => dicomWorker.terminate()
  }, [])

  const send = useCallback((message: WorkerRequest) => workerRef.current?.postMessage(message), [])

  const scanFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
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
      setProgress({ phase: 'loading', progress: 0, label: 'Preparing volume' })
      send({ type: 'load-series', seriesId })
    },
    [send],
  )

  const reset = useCallback(() => {
    send({ type: 'reset' })
    setSeries([])
    setVolume(null)
    setError(null)
    setProgress(IDLE_PROGRESS)
  }, [send])

  return { series, volume, setVolume, progress, error, scanFiles, loadSeries, reset }
}
