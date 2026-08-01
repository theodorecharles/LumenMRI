import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDicomLoader } from './useDicomLoader'
import { chooseDirectory, filesFromDrop } from '../lib/fileAccess'
import { FIT_VIEW, type ViewTransform } from '../lib/sliceView'
import { createDemoVolume, mapRelativeSliceIndex, midSliceIndex } from '../lib/volume'
import {
  bundledSeriesSummary,
  loadBundledCatalog,
  loadBundledVolume,
  type BundledCatalog,
  type BundledSeries,
} from '../lib/bundledVolume'
import { clearAnnotationStash, createAnnotationStash } from '../lib/annotationStash'
import { VolumeCache } from '../lib/volumeCache'
import type { SeriesSummary, VolumeData, VolumeSettings } from '../types'

export type Screen = 'library' | 'viewer'

const COMPARE_WL_DEFAULT: Pick<VolumeSettings, 'window' | 'level'> = {
  window: 0.82,
  level: 0.46,
}

/**
 * Owns library↔viewer navigation, bundled open generations, local scan/load,
 * compare pane B loads, volume cache, hash/popstate, and cancel/busy coordination
 * with useDicomLoader. App should only compose this with layout/UI chrome.
 */
export function useViewerSession() {
  const inputRef = useRef<HTMLInputElement>(null)
  const volumeCache = useRef(new VolumeCache())
  /** Bumps on each bundled open so a later click can supersede an in-flight load. */
  const openGenerationRef = useRef(0)
  /** Sync guard so cancel + re-open in the same tick is not blocked by stale openingId state. */
  const openingIdRef = useRef<string | null>(null)
  const compareOpeningIdRef = useRef<string | null>(null)
  /** App writes primary slice index so compare-apply can map linked depth. */
  const primarySliceIndexRef = useRef(0)
  /** App writes primary W/L so compare-apply can seed pane B. */
  const primarySettingsRef = useRef<Pick<VolumeSettings, 'window' | 'level'>>(COMPARE_WL_DEFAULT)
  /**
   * Session 2D annotation stash keyed by seriesId. Shared across primary + Compare B
   * SliceViewers so series-card clicks and Compare B hops only stash/restore (AC-3).
   * clearAnnotationStash is reserved for library home / new local open (AC-4) — never
   * call it from selectSeries or setCompareSeries.
   */
  const annotationStashRef = useRef(createAnnotationStash())

  const { series, volume, setVolume, progress, error, setError, scanFiles, loadSeries, cancelInFlight } =
    useDicomLoader()

  const [screen, setScreen] = useState<Screen>('library')
  const [catalog, setCatalog] = useState<BundledCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null)
  const [compareSeriesId, setCompareSeriesId] = useState<string | null>(null)
  const [compareVolume, setCompareVolume] = useState<VolumeData | null>(null)
  const [compareOpeningId, setCompareOpeningId] = useState<string | null>(null)
  const [compareSettings, setCompareSettings] = useState(COMPARE_WL_DEFAULT)
  const [compareSliceIndex, setCompareSliceIndex] = useState(0)
  const [slicesLinked, setSlicesLinked] = useState(true)
  /** Mirror pan/zoom + window/level across Compare panes (independent of depth link). */
  const [viewLinked, setViewLinked] = useState(true)
  const [sliceViewA, setSliceViewA] = useState<ViewTransform>(FIT_VIEW)
  const [sliceViewB, setSliceViewB] = useState<ViewTransform>(FIT_VIEW)

  const viewLinkedRef = useRef(viewLinked)
  const sliceViewARef = useRef(sliceViewA)
  viewLinkedRef.current = viewLinked
  sliceViewARef.current = sliceViewA

  const workerBusy = progress.phase === 'scanning' || progress.phase === 'loading'
  const busy = workerBusy || openingId !== null || compareOpeningId !== null

  const bundledSeries = useMemo(
    () => catalog?.datasets.flatMap((dataset) => dataset.series) || [],
    [catalog],
  )
  const displaySeries = useMemo(
    () => [...bundledSeries.map(bundledSeriesSummary), ...series],
    [bundledSeries, series],
  )

  const rememberVolume = useCallback((next: VolumeData) => {
    volumeCache.current.set(next)
  }, [])

  // Pin active primary + compare so LRU eviction can drop the rest for GC.
  useEffect(() => {
    volumeCache.current.setPins(activeSeriesId, compareSeriesId)
  }, [activeSeriesId, compareSeriesId])

  const clearCompare = useCallback(() => {
    compareOpeningIdRef.current = null
    setCompareOpeningId(null)
    setCompareSeriesId(null)
    setCompareVolume(null)
    setCompareSliceIndex(0)
    setCompareSettings(COMPARE_WL_DEFAULT)
    setSliceViewB(FIT_VIEW)
  }, [])

  const handleSliceViewA = useCallback((next: ViewTransform) => {
    setSliceViewA(next)
    if (viewLinked) setSliceViewB(next)
  }, [viewLinked])

  const handleSliceViewB = useCallback((next: ViewTransform) => {
    setSliceViewB(next)
    if (viewLinked) setSliceViewA(next)
  }, [viewLinked])

  const enableViewLink = useCallback(() => {
    setViewLinked(true)
    setSliceViewB(sliceViewA)
    setCompareSettings({
      window: primarySettingsRef.current.window,
      level: primarySettingsRef.current.level,
    })
  }, [sliceViewA])

  useEffect(() => {
    let cancelled = false
    loadBundledCatalog()
      .then((nextCatalog) => {
        if (cancelled) return
        setCatalog(nextCatalog)
        setCatalogLoading(false)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setCatalogError(
          loadError instanceof Error ? loadError.message : 'The included scan library failed to load.',
        )
        setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    inputRef.current?.setAttribute('webkitdirectory', '')
    inputRef.current?.setAttribute('directory', '')
  }, [])

  useEffect(() => {
    // Library home must not auto-load: goHome during scan can leave activeSeriesId null
    // while series later fills (or residual series remains). Only recommend in the viewer.
    if (screen !== 'viewer' || !series.length || activeSeriesId) return
    const recommended = series.find((item) => item.supported)
    if (!recommended) return
    setActiveSeriesId(recommended.id)
    loadSeries(recommended.id)
  }, [activeSeriesId, loadSeries, screen, series])

  // Failed loads leave the previous volume in place. Revert the series highlight
  // to the last successful volume so the panel matches the stage. Skip when
  // volume is null (first-load failure) — clearing activeSeriesId would re-fire
  // the auto-recommend effect and infinite-retry a failing series.
  useEffect(() => {
    if (progress.phase !== 'error' || !volume) return
    setActiveSeriesId(volume.seriesId)
  }, [progress.phase, volume])

  const pushViewerLocation = useCallback((id: string) => {
    window.history.pushState({ screen: 'viewer', seriesId: id }, '', `#series/${id}`)
  }, [])

  const cancelPendingOpen = useCallback(() => {
    openGenerationRef.current += 1
    openingIdRef.current = null
    setOpeningId(null)
  }, [])

  const openBundledSeries = useCallback(
    async (selection: BundledSeries, pushHistory = true) => {
      // Latest click wins: bump generation so an in-flight open cannot apply after a newer one.
      const generation = ++openGenerationRef.current
      openingIdRef.current = selection.id
      // Cancel any in-flight local load-series before async fetch so volume-ready
      // / load-progress cannot overwrite the bundled volume or flip progress.
      cancelInFlight()
      // cancelInFlight drops worker results without error — abandon in-flight compare open
      // so compareOpeningId cannot leave busy stuck. Keep an already-applied pane B.
      if (compareOpeningIdRef.current) {
        compareOpeningIdRef.current = null
        setCompareOpeningId(null)
      }
      setCatalogError(null)
      setError(null)
      setOpeningId(selection.id)
      try {
        let selectedVolume = volumeCache.current.get(selection.id)
        if (!selectedVolume) {
          selectedVolume = await loadBundledVolume(selection)
          // Cache even if superseded/cancelled so a later open of the same series is free.
          volumeCache.current.set(selectedVolume)
        }
        // Stale generation (superseded click or user left open intent) — do not force viewer.
        if (generation !== openGenerationRef.current) return
        setVolume(selectedVolume)
        rememberVolume(selectedVolume)
        setActiveSeriesId(selection.id)
        // Primary replaced the compare series — drop B so A/B never share the same stack.
        if (compareSeriesId === selection.id) clearCompare()
        setScreen('viewer')
        if (pushHistory) pushViewerLocation(selection.id)
      } catch (loadError: unknown) {
        if (generation !== openGenerationRef.current) return
        const message =
          loadError instanceof Error ? loadError.message : 'The selected volume could not be opened.'
        // goHome leaves the last volume in state. Library opens must always surface via
        // catalogError (ScanLibrary only reads that prop). Keep setError only when already
        // on the viewer with a residual volume so the stage/footer can show the failure.
        if (volume && screen !== 'library') {
          setError(message)
        } else {
          setCatalogError(message)
          setScreen('library')
        }
      } finally {
        if (generation === openGenerationRef.current) {
          openingIdRef.current = null
          setOpeningId(null)
        }
      }
    },
    [cancelInFlight, clearCompare, compareSeriesId, pushViewerLocation, rememberVolume, screen, setError, setVolume, volume],
  )

  const setCompareSeries = useCallback(
    async (selection: SeriesSummary) => {
      if (!selection.supported || selection.id === activeSeriesId) return

      const applyCompareVolume = (next: VolumeData) => {
        const primarySettings = primarySettingsRef.current
        rememberVolume(next)
        setCompareVolume(next)
        setCompareSeriesId(next.seriesId)
        setCompareSettings({
          window: primarySettings.window,
          level: primarySettings.level,
        })
        setSliceViewB(viewLinkedRef.current ? sliceViewARef.current : FIT_VIEW)
        const primaryDepth = volume?.dimensions[2] ?? next.dimensions[2]
        const primaryIndex = volume ? primarySliceIndexRef.current : midSliceIndex(next.dimensions[2])
        setCompareSliceIndex(
          slicesLinked
            ? mapRelativeSliceIndex(primaryIndex, primaryDepth, next.dimensions[2])
            : midSliceIndex(next.dimensions[2]),
        )
      }

      const cached = volumeCache.current.get(selection.id)
      if (cached) {
        applyCompareVolume(cached)
        return
      }

      const included = bundledSeries.find((entry) => entry.id === selection.id)
      if (included) {
        const generation = selection.id
        compareOpeningIdRef.current = generation
        setCompareOpeningId(generation)
        setError(null)
        try {
          const loaded = await loadBundledVolume(included)
          if (compareOpeningIdRef.current !== generation) return
          applyCompareVolume(loaded)
        } catch (loadError: unknown) {
          if (compareOpeningIdRef.current !== generation) return
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'The compare series could not be opened.',
          )
        } finally {
          if (compareOpeningIdRef.current === generation) {
            compareOpeningIdRef.current = null
            setCompareOpeningId(null)
          }
        }
        return
      }

      // Local DICOM: load via worker without replacing the primary volume.
      compareOpeningIdRef.current = selection.id
      setCompareOpeningId(selection.id)
      loadSeries(selection.id, {
        onVolume: (next) => {
          if (compareOpeningIdRef.current !== selection.id) return
          applyCompareVolume(next)
          compareOpeningIdRef.current = null
          setCompareOpeningId(null)
        },
      })
    },
    [
      activeSeriesId,
      bundledSeries,
      loadSeries,
      rememberVolume,
      setError,
      slicesLinked,
      volume,
    ],
  )

  useEffect(() => {
    const navigateFromHistory = () => {
      if (window.location.hash === '#local') {
        cancelPendingOpen()
        setScreen('viewer')
        return
      }
      const match = window.location.hash.match(/^#series\/(.+)$/)
      if (!match) {
        // Browser Back to library while a bundled open is in flight.
        clearAnnotationStash(annotationStashRef.current)
        cancelPendingOpen()
        clearCompare()
        setScreen('library')
        return
      }
      const id = decodeURIComponent(match[1])
      const included = bundledSeries.find((entry) => entry.id === id)
      if (included) {
        // Already loading this series — leave the in-flight open alone.
        if (openingIdRef.current === included.id) return
        // Different series (or idle): drop any pending open so history can win.
        cancelPendingOpen()
        void openBundledSeries(included, false)
      } else {
        const local = series.find((entry) => entry.id === id)
        if (local) {
          cancelPendingOpen()
          // Cancel in-flight worker load (compare or prior primary). load-series alone does
          // not bump jobGeneration; without cancel the compare job can still post volume-ready
          // after pendingOnVolume is cleared and install B as primary.
          cancelInFlight()
          // Drop compare-open flag so busy does not stick after abandon.
          if (compareOpeningIdRef.current) {
            compareOpeningIdRef.current = null
            setCompareOpeningId(null)
          }
          setActiveSeriesId(local.id)
          setScreen('viewer')
          loadSeries(local.id)
        }
      }
    }
    window.addEventListener('popstate', navigateFromHistory)
    if (bundledSeries.length && window.location.hash) navigateFromHistory()
    return () => window.removeEventListener('popstate', navigateFromHistory)
  }, [bundledSeries, cancelInFlight, cancelPendingOpen, clearCompare, loadSeries, openBundledSeries, series])

  const goHome = useCallback((pushHistory = true) => {
    clearAnnotationStash(annotationStashRef.current)
    cancelPendingOpen()
    // Match openBundledSeries: drop in-flight scan/load so volume-ready cannot setVolume
    // after L / Scan library / brand leave the viewer (AC-1, AC-2).
    cancelInFlight()
    // Abandon in-flight / applied compare so busy cannot stick after leaving the viewer.
    clearCompare()
    setScreen('library')
    if (pushHistory) {
      window.history.pushState({ screen: 'library' }, '', `${window.location.pathname}${window.location.search}`)
    }
  }, [cancelInFlight, cancelPendingOpen, clearCompare])

  const handleFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      clearAnnotationStash(annotationStashRef.current)
      // Drop any in-flight bundled open so a late fetch cannot overwrite this local intent.
      cancelPendingOpen()
      clearCompare()
      setActiveSeriesId(null)
      setScreen('viewer')
      window.history.pushState({ screen: 'viewer', local: true }, '', '#local')
      scanFiles(files)
    },
    [cancelPendingOpen, clearCompare, scanFiles],
  )

  const openFolder = useCallback(async () => {
    try {
      const files = await chooseDirectory()
      if (files === null) inputRef.current?.click()
      else handleFiles(files)
    } catch (openError) {
      console.error(openError)
      inputRef.current?.click()
    }
  }, [handleFiles])

  const selectSeries = useCallback(
    (selection: SeriesSummary) => {
      if (busy) return
      // Same-id is a no-op unless first load failed (error + no volume). Error-revert
      // intentionally leaves activeSeriesId in that case to avoid auto-recommend loops;
      // re-select must still retry the load.
      if (selection.id === activeSeriesId) {
        if (progress.phase !== 'error' || volume) return
      }
      const included = bundledSeries.find((entry) => entry.id === selection.id)
      if (included) {
        void openBundledSeries(included)
        return
      }
      setActiveSeriesId(selection.id)
      if (compareSeriesId === selection.id) clearCompare()
      setScreen('viewer')
      pushViewerLocation(selection.id)
      loadSeries(selection.id)
    },
    [
      activeSeriesId,
      busy,
      bundledSeries,
      clearCompare,
      compareSeriesId,
      loadSeries,
      openBundledSeries,
      progress.phase,
      pushViewerLocation,
      volume,
    ],
  )

  const showDemo = useCallback(() => {
    setActiveSeriesId('demo-phantom')
    clearCompare()
    const demo = createDemoVolume()
    setVolume(demo)
    rememberVolume(demo)
  }, [clearCompare, rememberVolume, setVolume])

  // Cache primary volumes as they land (local load path, demo, etc.).
  useEffect(() => {
    if (!volume) return
    rememberVolume(volume)
  }, [rememberVolume, volume])

  // Local compare load failures clear the worker handler but not this UI busy flag.
  useEffect(() => {
    if (progress.phase === 'error' && compareOpeningId) {
      compareOpeningIdRef.current = null
      setCompareOpeningId(null)
    }
  }, [compareOpeningId, progress.phase])

  const onDropFiles = useCallback(
    async (dataTransfer: DataTransfer) => {
      handleFiles(await filesFromDrop(dataTransfer))
    },
    [handleFiles],
  )

  return {
    inputRef,
    primarySliceIndexRef,
    primarySettingsRef,
    /** Stable Map identity for the session; SliceViewers share this instance. */
    annotationStash: annotationStashRef.current,
    screen,
    setScreen,
    catalog,
    catalogLoading,
    catalogError,
    openingId,
    activeSeriesId,
    compareSeriesId,
    compareVolume,
    compareOpeningId,
    compareSettings,
    setCompareSettings,
    compareSliceIndex,
    setCompareSliceIndex,
    slicesLinked,
    setSlicesLinked,
    viewLinked,
    setViewLinked,
    sliceViewA,
    sliceViewB,
    handleSliceViewA,
    handleSliceViewB,
    enableViewLink,
    series,
    volume,
    setVolume,
    progress,
    error,
    setError,
    busy,
    bundledSeries,
    displaySeries,
    rememberVolume,
    clearCompare,
    openBundledSeries,
    setCompareSeries,
    goHome,
    handleFiles,
    openFolder,
    selectSeries,
    showDemo,
    onDropFiles,
  }
}
