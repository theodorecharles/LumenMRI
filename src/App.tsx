import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Camera,
  CircleHelp,
  Columns2,
  Cpu,
  Crop,
  FolderOpen,
  LayoutGrid,
  Layers3,
  Link2,
  Link2Off,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  SquareSplitHorizontal,
} from 'lucide-react'
import { useDicomLoader } from './hooks/useDicomLoader'
import { useVolumeReconstruction } from './hooks/useVolumeReconstruction'
import { chooseDirectory, filesFromDrop } from './lib/fileAccess'
import {
  anatomicalPlaneFromOrientation,
  resliceVolume,
  sourcePointToPlane,
} from './lib/mpr'
import { compositeCompareSlicePng, exportCapturePng, type CaptureExportResult } from './lib/sliceCapture'
import {
  createDemoVolume,
  mapRelativeSliceIndex,
  midSliceIndex,
  sliceIndexFromStackFraction,
} from './lib/volume'
import {
  bundledSeriesSummary,
  loadBundledCatalog,
  loadBundledVolume,
  type BundledCatalog,
  type BundledSeries,
} from './lib/bundledVolume'
import type {
  AnatomicalPlane,
  CropBounds,
  SeriesSummary,
  VolumeData,
  VolumeSettings,
} from './types'
import { ControlPanel } from './components/ControlPanel'
import { EmptyStage } from './components/EmptyStage'
import { ScanLibrary } from './components/ScanLibrary'
import { SeriesPanel } from './components/SeriesPanel'
import { ShortcutSheet } from './components/ShortcutSheet'
import { FIT_VIEW, SliceViewer, type SliceViewerHandle, type ViewTransform } from './components/SliceViewer'
import type { ViewerStageHandle, VolumeSlicePick } from './components/ViewerStage'

const ViewerStage = lazy(() =>
  import('./components/ViewerStage').then((module) => ({ default: module.ViewerStage })),
)

const DEFAULT_VOLUME_SETTINGS: VolumeSettings = {
  threshold: 0.1,
  opacity: 0.44,
  window: 0.82,
  level: 0.46,
  detail: 0.62,
  shading: 0.72,
  lightAzimuth: -35,
  lightElevation: 30,
  sharpness: 0.34,
  palette: 'cyan',
  customPalette: ['#10152e', '#b329ff', '#fff06a'],
}

const FULL_CROP: CropBounds = {
  minX: 0,
  maxX: 1,
  minY: 0,
  maxY: 1,
  minZ: 0,
  maxZ: 1,
}

type Screen = 'library' | 'viewer'
type ViewerLayout = 'volume' | 'slice' | 'split' | 'compare'

const COMPARE_WL_DEFAULT: Pick<VolumeSettings, 'window' | 'level'> = {
  window: DEFAULT_VOLUME_SETTINGS.window,
  level: DEFAULT_VOLUME_SETTINGS.level,
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<ViewerStageHandle>(null)
  const sliceViewerRef = useRef<SliceViewerHandle>(null)
  const compareSliceViewerRef = useRef<SliceViewerHandle>(null)
  const stageRef = useRef<HTMLElement>(null)
  const volumeCache = useRef(new Map<string, VolumeData>())
  /** Bumps on each bundled open so a later click can supersede an in-flight load. */
  const openGenerationRef = useRef(0)
  /** Through-plane depth of the last applied volume; null means no prior slice context. */
  const previousDepthRef = useRef<number | null>(null)
  const sliceIndexRef = useRef(0)
  const compareSliceIndexRef = useRef(0)
  /** Sync guard so cancel + re-open in the same tick is not blocked by stale openingId state. */
  const openingIdRef = useRef<string | null>(null)
  const compareOpeningIdRef = useRef<string | null>(null)
  const { series, volume, setVolume, progress, error, setError, scanFiles, loadSeries, cancelInFlight } =
    useDicomLoader()
  const reconstruction = useVolumeReconstruction(volume)
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
  const [volumeSettings, setVolumeSettings] = useState(DEFAULT_VOLUME_SETTINGS)
  const viewLinkedRef = useRef(viewLinked)
  const sliceViewARef = useRef(sliceViewA)
  const volumeSettingsRef = useRef(volumeSettings)
  viewLinkedRef.current = viewLinked
  sliceViewARef.current = sliceViewA
  volumeSettingsRef.current = volumeSettings
  const [autoRotate, setAutoRotate] = useState(false)
  const [reconstructionEnabled, setReconstructionEnabled] = useState(true)
  /** True only when Acquired was forced by a recon error — not a user mode pick. */
  const reconstructionDisabledByErrorRef = useRef(false)
  const [cameraProjection, setCameraProjection] = useState<'perspective' | 'isometric'>('perspective')
  const [viewerLayout, setViewerLayout] = useState<ViewerLayout>('volume')
  const [sliceIndex, setSliceIndex] = useState(0)
  const [slicePlane, setSlicePlane] = useState<AnatomicalPlane>('axial')
  sliceIndexRef.current = sliceIndex
  compareSliceIndexRef.current = compareSliceIndex
  const [showSliceHighlight, setShowSliceHighlight] = useState(false)
  const [cropBounds, setCropBounds] = useState<CropBounds>(FULL_CROP)
  const [cropEditing, setCropEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isStageFullscreen, setIsStageFullscreen] = useState(false)
  const [shortcutSheetOpen, setShortcutSheetOpen] = useState(false)
  /** Brief "Copied" toast after a successful clipboard capture. */
  const [captureToast, setCaptureToast] = useState<string | null>(null)
  const captureToastTimerRef = useRef<number | null>(null)
  /** Brief 2D crosshair flash after a 3D volume slice pick (token forces re-trigger). */
  const [slicePickFlash, setSlicePickFlash] = useState<{
    token: number
    x: number
    y: number
  } | null>(null)
  const slicePickFlashTokenRef = useRef(0)
  const acquiredPlane = anatomicalPlaneFromOrientation(volume?.orientation ?? 'Axial')
  const slicePlaneIsAcquired = slicePlane === acquiredPlane
  const enhancedMprSource = useMemo<VolumeData | null>(() => {
    const enhanced = reconstructionEnabled ? reconstruction.volume : null
    if (!volume || !enhanced || enhanced.seriesId !== volume.seriesId) return volume
    return {
      ...volume,
      seriesId: `${volume.seriesId}::shape-reconstruction`,
      data: enhanced.data,
      dimensions: enhanced.dimensions,
      spacing: enhanced.spacing,
      physicalSize: volume.physicalSize,
      sliceCount: enhanced.dimensions[2],
    }
  }, [reconstruction.volume, reconstructionEnabled, volume])
  const mprSourceVolume = slicePlaneIsAcquired ? volume : enhancedMprSource
  const mprVolume = useMemo(
    () => (mprSourceVolume ? resliceVolume(mprSourceVolume, slicePlane) : null),
    [mprSourceVolume, slicePlane],
  )
  const primarySliceVolume =
    viewerLayout === 'slice' || viewerLayout === 'split' ? mprVolume : volume

  const workerBusy = progress.phase === 'scanning' || progress.phase === 'loading'
  const busy = workerBusy || openingId !== null || compareOpeningId !== null
  const volumeCropped = cropBounds.minX > 0.001 || cropBounds.maxX < 0.999 ||
    cropBounds.minY > 0.001 || cropBounds.maxY < 0.999 ||
    cropBounds.minZ > 0.001 || cropBounds.maxZ < 0.999
  const bundledSeries = useMemo(
    () => catalog?.datasets.flatMap((dataset) => dataset.series) || [],
    [catalog],
  )
  const displaySeries = useMemo(
    () => [...bundledSeries.map(bundledSeriesSummary), ...series],
    [bundledSeries, series],
  )

  const handleReconstructionEnabledChange = useCallback((enabled: boolean) => {
    // Explicit user choice — do not auto-restore Enhanced on a later ready.
    reconstructionDisabledByErrorRef.current = false
    setReconstructionEnabled(enabled)
  }, [])

  const rememberVolume = useCallback((next: VolumeData) => {
    volumeCache.current.set(next.seriesId, next)
  }, [])

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

  const handlePrimaryVolumeSettings = useCallback((patch: Partial<VolumeSettings>) => {
    setVolumeSettings((current) => ({ ...current, ...patch }))
    if (
      viewLinked
      && (patch.window !== undefined || patch.level !== undefined)
    ) {
      setCompareSettings((current) => ({
        window: patch.window ?? current.window,
        level: patch.level ?? current.level,
      }))
    }
  }, [viewLinked])

  const handleCompareVolumeSettings = useCallback((patch: Partial<VolumeSettings>) => {
    if (patch.window === undefined && patch.level === undefined) return
    if (viewLinked) {
      setVolumeSettings((current) => ({
        ...current,
        ...(patch.window !== undefined ? { window: patch.window } : null),
        ...(patch.level !== undefined ? { level: patch.level } : null),
      }))
      setCompareSettings((current) => ({
        window: patch.window ?? current.window,
        level: patch.level ?? current.level,
      }))
      return
    }
    setCompareSettings((current) => ({
      window: patch.window ?? current.window,
      level: patch.level ?? current.level,
    }))
  }, [viewLinked])

  const enableViewLink = useCallback(() => {
    setViewLinked(true)
    setSliceViewB(sliceViewA)
    setCompareSettings({
      window: volumeSettings.window,
      level: volumeSettings.level,
    })
  }, [sliceViewA, volumeSettings.level, volumeSettings.window])

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

  // Terminal reconstruction failure: force Acquired. Re-enable Enhanced only when that
  // disable was error-driven (#2645) — not when the user chose Acquired during processing.
  useEffect(() => {
    if (reconstruction.status === 'error') {
      reconstructionDisabledByErrorRef.current = true
      setReconstructionEnabled(false)
    } else if (
      reconstruction.status === 'ready' &&
      reconstructionDisabledByErrorRef.current
    ) {
      reconstructionDisabledByErrorRef.current = false
      setReconstructionEnabled(true)
    }
  }, [reconstruction.status])
  useEffect(() => {
    if (!series.length || activeSeriesId) return
    const recommended = series.find((item) => item.supported)
    if (!recommended) return
    setActiveSeriesId(recommended.id)
    loadSeries(recommended.id)
  }, [activeSeriesId, loadSeries, series])

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
          volumeCache.current.set(selection.id, selectedVolume)
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
        const primarySettings = volumeSettingsRef.current
        rememberVolume(next)
        setCompareVolume(next)
        setCompareSeriesId(next.seriesId)
        setCompareSettings({
          window: primarySettings.window,
          level: primarySettings.level,
        })
        setSliceViewB(viewLinkedRef.current ? sliceViewARef.current : FIT_VIEW)
        const primaryDepth = volume?.dimensions[2] ?? next.dimensions[2]
        const primaryIndex = volume ? sliceIndexRef.current : midSliceIndex(next.dimensions[2])
        setCompareSliceIndex(
          slicesLinked
            ? mapRelativeSliceIndex(primaryIndex, primaryDepth, next.dimensions[2])
            : midSliceIndex(next.dimensions[2]),
        )
        if (viewerLayout !== 'compare') setViewerLayout('compare')
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
      viewerLayout,
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
    cancelPendingOpen()
    // Abandon in-flight / applied compare so busy cannot stick after leaving the viewer.
    clearCompare()
    setScreen('library')
    setAutoRotate(false)
    if (pushHistory) {
      window.history.pushState({ screen: 'library' }, '', `${window.location.pathname}${window.location.search}`)
    }
  }, [cancelPendingOpen, clearCompare])

  const handleFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
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

  const selectSeries = (selection: SeriesSummary) => {
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
  }

  const showDemo = () => {
    setActiveSeriesId('demo-phantom')
    clearCompare()
    const demo = createDemoVolume()
    setVolume(demo)
    rememberVolume(demo)
  }

  const compareVolumeRef = useRef(compareVolume)
  compareVolumeRef.current = compareVolume
  const slicesLinkedRef = useRef(slicesLinked)
  slicesLinkedRef.current = slicesLinked

  useEffect(() => {
    if (!volume) {
      previousDepthRef.current = null
      return
    }
    rememberVolume(volume)
    setSlicePlane(anatomicalPlaneFromOrientation(volume.orientation))
    const nextDepth = volume.dimensions[2]
    const previousDepth = previousDepthRef.current
    let nextSlice: number
    if (previousDepth != null && previousDepth > 0) {
      nextSlice = mapRelativeSliceIndex(sliceIndexRef.current, previousDepth, nextDepth)
    } else {
      nextSlice = midSliceIndex(nextDepth)
    }
    setSliceIndex(nextSlice)
    previousDepthRef.current = nextDepth
    setCropBounds(FULL_CROP)
    setCropEditing(false)
    // Keep pane B aligned when primary series hops and slices are linked.
    const secondary = compareVolumeRef.current
    if (slicesLinkedRef.current && secondary) {
      setCompareSliceIndex(
        mapRelativeSliceIndex(nextSlice, nextDepth, secondary.dimensions[2]),
      )
    }
  }, [rememberVolume, volume])

  // Local compare load failures clear the worker handler but not this UI busy flag.
  useEffect(() => {
    if (progress.phase === 'error' && compareOpeningId) {
      compareOpeningIdRef.current = null
      setCompareOpeningId(null)
    }
  }, [compareOpeningId, progress.phase])

  const setPrimarySliceIndex = useCallback(
    (index: number) => {
      if (!primarySliceVolume) return
      const depth = primarySliceVolume.dimensions[2]
      const next = Math.max(0, Math.min(depth - 1, index))
      setSliceIndex(next)
      if (slicesLinked && compareVolume) {
        setCompareSliceIndex(
          mapRelativeSliceIndex(next, depth, compareVolume.dimensions[2]),
        )
      }
    },
    [compareVolume, primarySliceVolume, slicesLinked],
  )

  const setSecondarySliceIndex = useCallback(
    (index: number) => {
      if (!compareVolume) return
      const depth = compareVolume.dimensions[2]
      const next = Math.max(0, Math.min(depth - 1, index))
      setCompareSliceIndex(next)
      if (slicesLinked && primarySliceVolume) {
        setSliceIndex(mapRelativeSliceIndex(next, depth, primarySliceVolume.dimensions[2]))
      }
    },
    [compareVolume, primarySliceVolume, slicesLinked],
  )

  useEffect(() => {
    if (
      (viewerLayout !== 'volume' && viewerLayout !== 'compare')
      || !volume
      || slicePlaneIsAcquired
    ) return
    const next = midSliceIndex(volume.dimensions[2])
    setSlicePlane(acquiredPlane)
    setSliceIndex(next)
    if (slicesLinked && compareVolume) {
      setCompareSliceIndex(
        mapRelativeSliceIndex(next, volume.dimensions[2], compareVolume.dimensions[2]),
      )
    }
  }, [
    acquiredPlane,
    compareVolume,
    slicePlaneIsAcquired,
    slicesLinked,
    viewerLayout,
    volume,
  ])

  const changeSlicePlane = useCallback((nextPlane: AnatomicalPlane) => {
    if (!volume || nextPlane === slicePlane) return
    sliceViewerRef.current?.pauseCine()
    const nextSource = nextPlane === acquiredPlane ? volume : enhancedMprSource ?? volume
    const nextVolume = resliceVolume(nextSource, nextPlane)
    setSlicePlane(nextPlane)
    setSliceIndex(midSliceIndex(nextVolume.dimensions[2]))
    setSlicePickFlash(null)
    setCropEditing(false)
    setShowSliceHighlight(false)
  }, [acquiredPlane, enhancedMprSource, slicePlane, volume])

  useEffect(() => {
    if (cropEditing) setAutoRotate(false)
  }, [cropEditing])

  const slicePickEnabled = showSliceHighlight || viewerLayout === 'split'

  const handleVolumeSlicePick = useCallback((pick: VolumeSlicePick) => {
    if (!mprVolume) return
    const point = sourcePointToPlane(pick.sourceFractions, acquiredPlane, slicePlane)
    // Route through setPrimarySliceIndex so Linked mode maps compare pane B.
    setPrimarySliceIndex(
      sliceIndexFromStackFraction(point.stackFraction, mprVolume.dimensions[2]),
    )
    slicePickFlashTokenRef.current += 1
    setSlicePickFlash({
      token: slicePickFlashTokenRef.current,
      x: point.x,
      y: point.y,
    })
  }, [acquiredPlane, mprVolume, setPrimarySliceIndex, slicePlane])

  const toggleStageFullscreen = useCallback(() => {
    if (isStageFullscreen) {
      setIsStageFullscreen(false)
      if (document.fullscreenElement) void document.exitFullscreen()
      return
    }

    // Stage chrome only exists on the viewer; library has no stageRef.
    // Without this guard, F still flips isStageFullscreen and CSS-hides header/footer.
    const stage = stageRef.current
    if (screen !== 'viewer' || !stage) return

    // iPhone Safari does not consistently support element fullscreen for WebGL.
    // Enter the app-level layout first, then enhance it with native fullscreen
    // on browsers that support it.
    setIsStageFullscreen(true)
    const requestFullscreen = stage.requestFullscreen
    if (requestFullscreen) void requestFullscreen.call(stage).catch(() => undefined)
  }, [isStageFullscreen, screen])

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setIsStageFullscreen(false)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    if (screen !== 'viewer') setIsStageFullscreen(false)
  }, [screen])

  const showCaptureToast = useCallback((message: string) => {
    setCaptureToast(message)
    if (captureToastTimerRef.current !== null) {
      window.clearTimeout(captureToastTimerRef.current)
    }
    captureToastTimerRef.current = window.setTimeout(() => {
      setCaptureToast(null)
      captureToastTimerRef.current = null
    }, 1800)
  }, [])

  useEffect(() => {
    return () => {
      if (captureToastTimerRef.current !== null) {
        window.clearTimeout(captureToastTimerRef.current)
      }
    }
  }, [])

  const captureActiveView = useCallback(async () => {
    let result: CaptureExportResult | null = null
    if (viewerLayout === 'compare') {
      const left = sliceViewerRef.current?.captureAnnotatedCanvas()
      if (!left) return
      const volB = compareVolume
      const right = volB ? compareSliceViewerRef.current?.captureAnnotatedCanvas() : null
      if (volB && right) {
        const leftSlug = volume
          ? volume.description.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
          : 'pane-a'
        const rightSlug = volB.description.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
        const filename = `lumen-compare-${leftSlug}-vs-${rightSlug}.png`
        const dataUrl = compositeCompareSlicePng({ left, right, leftLabel: 'A', rightLabel: 'B' })
        result = await exportCapturePng(dataUrl, filename)
      } else {
        const slug = volume
          ? volume.description.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
          : 'pane-a'
        const filename = `lumen-${slug}-slice-${sliceIndex + 1}.png`
        result = await exportCapturePng(left, filename)
      }
    } else if (viewerLayout === 'slice' || viewerLayout === 'split') {
      result = (await sliceViewerRef.current?.capture()) ?? null
    } else {
      result = (await viewerRef.current?.capture()) ?? null
    }
    if (result === 'clipboard') showCaptureToast('Copied')
  }, [compareVolume, showCaptureToast, sliceIndex, viewerLayout, volume])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      // Discoverability sheet: toggle on ?, dismiss on Esc. Works even when a
      // toolbar button is focused so the Help control can be keyboard-driven.
      if (event.key === '?') {
        event.preventDefault()
        setShortcutSheetOpen((open) => !open)
        return
      }
      if (event.key === 'Escape' && shortcutSheetOpen) {
        event.preventDefault()
        setShortcutSheetOpen(false)
        return
      }
      if (shortcutSheetOpen) return

      if (target instanceof HTMLButtonElement) return
      if (event.key.toLowerCase() === 'r') viewerRef.current?.resetView()
      if (event.key.toLowerCase() === 'f') toggleStageFullscreen()
      if (event.key.toLowerCase() === 's') void captureActiveView()
      if (event.key.toLowerCase() === 'l') goHome()
      if (event.key === 'Escape' && isStageFullscreen && !document.fullscreenElement) {
        setIsStageFullscreen(false)
      }
      if (event.key === '1') setViewerLayout('volume')
      if (event.key === '2') setViewerLayout('slice')
      if (event.key === '3') setViewerLayout('split')
      if (event.key === '4') setViewerLayout('compare')
      // Space toggles cine when a SliceViewer is mounted (2D / split / compare).
      if (
        event.key === ' ' &&
        (viewerLayout === 'slice' || viewerLayout === 'split' || viewerLayout === 'compare')
      ) {
        event.preventDefault()
        sliceViewerRef.current?.toggleCine()
      }
      if (primarySliceVolume) {
        const depth = primarySliceVolume.dimensions[2]
        if (event.key === 'Home') {
          event.preventDefault()
          // Match step/slider: user slice jumps pause cine.
          sliceViewerRef.current?.pauseCine()
          setPrimarySliceIndex(0)
          return
        }
        if (event.key === 'End') {
          event.preventDefault()
          sliceViewerRef.current?.pauseCine()
          setPrimarySliceIndex(Math.max(0, depth - 1))
          return
        }
        const step =
          event.key === 'ArrowUp' || event.key === ','
            ? -1
            : event.key === 'ArrowDown' || event.key === '.'
              ? 1
              : 0
        if (step !== 0) {
          event.preventDefault()
          setPrimarySliceIndex(sliceIndexRef.current + step)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [captureActiveView, goHome, isStageFullscreen, primarySliceVolume, setPrimarySliceIndex, shortcutSheetOpen, toggleStageFullscreen, viewerLayout])

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    handleFiles(await filesFromDrop(event.dataTransfer))
  }

  return (
    <div
      className={isStageFullscreen ? 'app-shell stage-fullscreen' : 'app-shell'}
      onDragEnter={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false)
      }}
      onDrop={onDrop}
    >
      <header className="app-header">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="Lumen scan library"
          onClick={(event) => {
            event.preventDefault()
            goHome()
          }}
        >
          <span className="brand-mark"><ScanLine size={20} /></span>
          <span><b>LUMEN</b><small>MRI VOLUME STUDIO</small></span>
        </a>
        <div className="header-status">
          {screen === 'viewer' ? (
            <button className="library-button" type="button" onClick={() => goHome()}>
              <LayoutGrid size={15} /> Scan library
            </button>
          ) : null}
          <span className="privacy-pill"><LockKeyhole size={13} /> Local processing</span>
          <span className="gpu-pill"><i /> WebGL 2</span>
          <button className="header-open" type="button" onClick={openFolder}>
            <FolderOpen size={15} /> Open scan
          </button>
        </div>
      </header>

      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        multiple
        onChange={(event) => {
          handleFiles([...(event.target.files || [])])
          // Allow re-selecting the same folder on the file-input fallback path.
          event.target.value = ''
        }}
      />

      {screen === 'library' ? (
        <ScanLibrary
          catalog={catalog}
          loading={catalogLoading}
          error={catalogError}
          openingId={openingId}
          onOpenSeries={(selection) => void openBundledSeries(selection)}
          onOpenLocal={openFolder}
        />
      ) : (
        <div className="workspace">
          <SeriesPanel
            series={displaySeries}
            activeId={activeSeriesId}
            compareId={compareSeriesId}
            busy={busy}
            onSelect={selectSeries}
            onSetCompare={(selection) => void setCompareSeries(selection)}
            onOpen={openFolder}
          />

          <main
            className={isStageFullscreen ? 'stage-shell is-fullscreen' : 'stage-shell'}
            ref={stageRef}
          >
            {volume ? (
              <>
                <div className="stage-toolbar">
                  <div className="view-switch" role="tablist" aria-label="Viewer layout">
                    <button
                      className={viewerLayout === 'volume' ? 'active' : ''}
                      type="button"
                      role="tab"
                      aria-selected={viewerLayout === 'volume'}
                      onClick={() => setViewerLayout('volume')}
                    >
                      <Layers3 size={15} /> 3D <kbd>1</kbd>
                    </button>
                    <button
                      className={viewerLayout === 'slice' ? 'active' : ''}
                      type="button"
                      role="tab"
                      aria-selected={viewerLayout === 'slice'}
                      onClick={() => setViewerLayout('slice')}
                    >
                      <ScanLine size={15} /> 2D slice <kbd>2</kbd>
                    </button>
                    <button
                      className={viewerLayout === 'split' ? 'active' : ''}
                      type="button"
                      role="tab"
                      aria-selected={viewerLayout === 'split'}
                      onClick={() => setViewerLayout('split')}
                    >
                      <Columns2 size={15} /> Split <kbd>3</kbd>
                    </button>
                    <button
                      className={viewerLayout === 'compare' ? 'active' : ''}
                      type="button"
                      role="tab"
                      aria-selected={viewerLayout === 'compare'}
                      onClick={() => setViewerLayout('compare')}
                    >
                      <SquareSplitHorizontal size={15} /> Compare <kbd>4</kbd>
                    </button>
                  </div>
                  <div className="tool-actions">
                    <button
                      className={shortcutSheetOpen ? 'icon-button active' : 'icon-button'}
                      type="button"
                      aria-label="Keyboard shortcuts"
                      aria-haspopup="dialog"
                      aria-expanded={shortcutSheetOpen}
                      title="Keyboard shortcuts (?)"
                      data-testid="shortcut-help-button"
                      onClick={() => setShortcutSheetOpen((open) => !open)}
                    >
                      <CircleHelp size={16} />
                    </button>
                    {viewerLayout === 'compare' ? (
                      <>
                        <button
                          className={slicesLinked ? 'slice-link-toggle active' : 'slice-link-toggle'}
                          type="button"
                          aria-pressed={slicesLinked}
                          aria-label={slicesLinked ? 'Unlock linked slices' : 'Link slices by relative depth'}
                          title={slicesLinked
                            ? 'Slices linked by relative depth — click to unlock'
                            : 'Slices independent — click to link by relative depth'}
                          data-testid="compare-depth-link-toggle"
                          onClick={() => {
                            setSlicesLinked((linked) => {
                              const next = !linked
                              if (next && volume && compareVolume) {
                                setCompareSliceIndex(
                                  mapRelativeSliceIndex(
                                    sliceIndexRef.current,
                                    volume.dimensions[2],
                                    compareVolume.dimensions[2],
                                  ),
                                )
                              }
                              return next
                            })
                          }}
                        >
                          {slicesLinked ? <Link2 size={14} /> : <Link2Off size={14} />}
                          <span>{slicesLinked ? 'Depth linked' : 'Depth free'}</span>
                        </button>
                        <button
                          className={viewLinked ? 'slice-link-toggle active' : 'slice-link-toggle'}
                          type="button"
                          aria-pressed={viewLinked}
                          aria-label={viewLinked
                            ? 'Unlock linked pan, zoom, and window/level'
                            : 'Link pan, zoom, and window/level'}
                          title={viewLinked
                            ? 'Pan, zoom, and window/level linked — click to unlock'
                            : 'Pan, zoom, and window/level independent — click to link (seeds B from A)'}
                          data-testid="compare-view-link-toggle"
                          onClick={() => {
                            if (viewLinked) {
                              setViewLinked(false)
                              return
                            }
                            enableViewLink()
                          }}
                        >
                          {viewLinked ? <Link2 size={14} /> : <Link2Off size={14} />}
                          <span>{viewLinked ? 'View linked' : 'View free'}</span>
                        </button>
                        {compareSeriesId ? (
                          <button
                            className="icon-button"
                            type="button"
                            title="Clear compare pane B"
                            aria-label="Clear compare pane B"
                            onClick={clearCompare}
                          >
                            <RotateCcw size={15} />
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    {viewerLayout !== 'slice' && viewerLayout !== 'compare' ? (
                      <>
                        <button
                          className={cropEditing ? 'crop-box-toggle active' : 'crop-box-toggle'}
                          type="button"
                          aria-pressed={cropEditing}
                          aria-label={cropEditing ? 'Stop editing 3D crop box' : 'Edit 3D crop box'}
                          title={cropEditing ? 'Stop editing 3D crop box' : 'Edit 3D crop box'}
                          onClick={() => setCropEditing((value) => !value)}
                        >
                          <Crop size={14} /><span>Crop box</span>
                        </button>
                        {volumeCropped ? (
                          <button
                            className="icon-button reset-crop-button"
                            type="button"
                            aria-label="Reset 3D crop"
                            title="Reset 3D crop"
                            onClick={() => setCropBounds(FULL_CROP)}
                          >
                            <RotateCcw size={15} />
                          </button>
                        ) : null}
                        <button
                          className={showSliceHighlight ? 'slice-highlight-toggle active' : 'slice-highlight-toggle'}
                          type="button"
                          aria-pressed={showSliceHighlight}
                          aria-label={showSliceHighlight ? 'Hide selected slice in 3D' : 'Show selected slice in 3D'}
                          title={!slicePlaneIsAcquired
                            ? '3D highlight is available on the acquired plane'
                            : showSliceHighlight
                              ? 'Hide selected slice in 3D'
                              : 'Show selected slice in 3D'}
                          disabled={!slicePlaneIsAcquired}
                          onClick={() => setShowSliceHighlight((value) => !value)}
                        >
                          <ScanLine size={14} /><span>Slice plane</span>
                        </button>
                        <button
                          className={autoRotate ? 'icon-button active' : 'icon-button'}
                          type="button"
                          title={autoRotate ? 'Pause orbit' : 'Auto orbit'}
                          onClick={() => setAutoRotate((value) => !value)}
                        >
                          {autoRotate ? <Pause size={16} /> : <Play size={16} />}
                        </button>
                        <button className="icon-button reset-view-button" type="button" title="Reset view (R)" onClick={() => viewerRef.current?.resetView()}><RotateCcw size={16} /></button>
                      </>
                    ) : null}
                    <button className="icon-button" type="button" title="Save image (S)" onClick={() => void captureActiveView()}><Camera size={16} /></button>
                    <button
                      className="icon-button fullscreen-button"
                      type="button"
                      aria-label={isStageFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                      aria-pressed={isStageFullscreen}
                      title={isStageFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
                      onClick={toggleStageFullscreen}
                    >
                      {isStageFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                  </div>
                  {captureToast ? (
                    <div className="capture-toast" role="status" aria-live="polite">
                      {captureToast}
                    </div>
                  ) : null}
                </div>

                <div className={`stage-view-grid layout-${viewerLayout}`}>
                  {viewerLayout === 'compare' ? (
                    <>
                      <SliceViewer
                        ref={sliceViewerRef}
                        volume={volume}
                        sliceIndex={sliceIndex}
                        onSliceChange={setPrimarySliceIndex}
                        volumeSettings={volumeSettings}
                        onVolumeSettingsChange={handlePrimaryVolumeSettings}
                        cropBounds={cropBounds}
                        onCropChange={setCropBounds}
                        cropEditing={false}
                        onCropEditingChange={() => undefined}
                        viewerLayout={viewerLayout}
                        paneLabel="A"
                        hideCropControls
                        viewTransform={sliceViewA}
                        onViewTransformChange={handleSliceViewA}
                      />
                      {compareVolume ? (
                        <SliceViewer
                          ref={compareSliceViewerRef}
                          volume={compareVolume}
                          sliceIndex={compareSliceIndex}
                          onSliceChange={setSecondarySliceIndex}
                          volumeSettings={viewLinked
                            ? volumeSettings
                            : { ...volumeSettings, ...compareSettings }}
                          onVolumeSettingsChange={handleCompareVolumeSettings}
                          cropBounds={FULL_CROP}
                          onCropChange={() => undefined}
                          cropEditing={false}
                          onCropEditingChange={() => undefined}
                          viewerLayout={viewerLayout}
                          paneLabel="B"
                          hideCropControls
                          viewTransform={sliceViewB}
                          onViewTransformChange={handleSliceViewB}
                          resetControlledViewOnVolumeChange={!viewLinked}
                        />
                      ) : (
                        <div className="compare-empty-pane" role="status">
                          <SquareSplitHorizontal size={28} />
                          <b>Pane B</b>
                          <p>
                            {compareOpeningId
                              ? 'Loading compare series…'
                              : 'Alt-click a series in the list, or press B on a card, to pair a second sequence.'}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {viewerLayout !== 'slice' ? (
                        <section
                          className="viewer-stage-pane"
                          aria-label="3D volume view"
                          data-reconstruction-status={reconstruction.status}
                          data-reconstruction-mode={reconstructionEnabled ? 'enhanced' : 'acquired'}
                          data-camera-projection={cameraProjection}
                          data-crop-editing={cropEditing}
                          data-slice-plane={slicePlane}
                          data-reconstructed-depth={reconstructionEnabled && reconstruction.volume?.seriesId === volume.seriesId
                            ? reconstruction.volume.dimensions[2]
                            : volume.dimensions[2]}
                          data-synthetic-slices={reconstruction.volume?.seriesId === volume.seriesId
                            ? reconstruction.volume.syntheticSlices
                            : 0}
                        >
                          <Suspense fallback={<div className="viewer-loading">Initializing GPU renderer…</div>}>
                            <ViewerStage
                              ref={viewerRef}
                              volume={volume}
                              reconstruction={reconstructionEnabled ? reconstruction.volume : null}
                              projection={cameraProjection}
                              volumeSettings={volumeSettings}
                              autoRotate={autoRotate}
                              sliceIndex={slicePlaneIsAcquired
                                ? sliceIndex
                                : midSliceIndex(volume.dimensions[2])}
                              showSliceHighlight={showSliceHighlight && slicePlaneIsAcquired}
                              cropBounds={cropBounds}
                              cropEditing={cropEditing}
                              onCropChange={setCropBounds}
                              slicePickEnabled={slicePickEnabled}
                              onSlicePick={handleVolumeSlicePick}
                            />
                          </Suspense>
                          <div className="volume-hud top-left">
                            <span className="hud-kicker">
                              {reconstructionEnabled ? 'Enhanced reconstruction' : 'Acquired stack'}
                            </span>
                            <b>{volume.description}</b>
                            <small>
                              {volume.orientation} · {volume.dimensions.join(' × ')} acquired
                              {reconstructionEnabled && reconstruction.volume?.seriesId === volume.seriesId
                                ? ` · +${reconstruction.volume.syntheticSlices} synthetic · ${reconstruction.volume.dimensions[2]} reconstructed planes`
                                : reconstruction.volume?.seriesId === volume.seriesId
                                  ? ` · ${reconstruction.volume.syntheticSlices} synthetic available`
                                  : ''}
                            </small>
                          </div>
                          <div className="volume-hud bottom-left">
                            <MousePointer2 size={14} /><span>Drag to orbit</span><i /><span>Scroll to zoom</span>
                            {slicePickEnabled ? (
                              <>
                                <i /><span>Alt+click → 2D slice</span>
                              </>
                            ) : null}
                          </div>
                          <div className="render-stats">
                            <span>
                              <Cpu size={13} />
                              {reconstructionEnabled && reconstruction.volume?.seriesId === volume.seriesId
                                ? 'SHAPE RECON'
                                : 'ACQUIRED'}
                            </span>
                            <b>
                              {reconstructionEnabled && reconstruction.volume?.seriesId === volume.seriesId
                                ? `${volume.dimensions[2]} + ${reconstruction.volume.syntheticSlices} synth`
                                : `${volume.sliceCount} layers`}
                            </b>
                          </div>
                        </section>
                      ) : null}
                      {viewerLayout !== 'volume' ? (
                        <SliceViewer
                          ref={sliceViewerRef}
                          volume={mprVolume ?? volume}
                          sliceIndex={sliceIndex}
                          onSliceChange={setPrimarySliceIndex}
                          volumeSettings={volumeSettings}
                          onVolumeSettingsChange={(patch) => setVolumeSettings((current) => ({ ...current, ...patch }))}
                          cropBounds={slicePlaneIsAcquired ? cropBounds : FULL_CROP}
                          onCropChange={slicePlaneIsAcquired ? setCropBounds : () => undefined}
                          cropEditing={slicePlaneIsAcquired && cropEditing}
                          onCropEditingChange={slicePlaneIsAcquired ? setCropEditing : () => undefined}
                          viewerLayout={viewerLayout}
                          pickFlash={slicePickFlash}
                          hideCropControls={!slicePlaneIsAcquired}
                          slicePlane={slicePlane}
                          acquiredPlane={acquiredPlane}
                          onSlicePlaneChange={changeSlicePlane}
                        />
                      ) : null}
                    </>
                  )}
                </div>

                {error ? (
                  <div className="stage-inline-error" role="alert">
                    {error}
                  </div>
                ) : null}

                {busy || (reconstruction.status === 'processing' && viewerLayout !== 'slice' && viewerLayout !== 'compare') ? (
                  <div className="stage-progress" role="status">
                    <div>
                      <span>
                        {reconstruction.status === 'processing' && !busy
                          ? reconstruction.message
                          : compareOpeningId
                            ? 'Loading compare series'
                            : openingId
                              ? 'Loading included volume'
                              : progress.label}
                      </span>
                      <b>
                        {reconstruction.status === 'processing' && !busy
                          ? `${Math.round(reconstruction.progress * 100)}%`
                          : openingId || compareOpeningId
                            ? '…'
                            : `${Math.round(progress.progress * 100)}%`}
                      </b>
                    </div>
                    <i>
                      <span style={{
                        width: reconstruction.status === 'processing' && !busy
                          ? `${reconstruction.progress * 100}%`
                          : openingId || compareOpeningId
                            ? '65%'
                            : `${progress.progress * 100}%`,
                      }} />
                    </i>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyStage
                progress={progress}
                error={error}
                isDragging={isDragging}
                onOpen={openFolder}
                onDemo={showDemo}
              />
            )}
          </main>

          <ControlPanel
            volumeSettings={volumeSettings}
            setVolumeSettings={(settings) => {
              setVolumeSettings(settings)
              if (viewLinked) {
                setCompareSettings({
                  window: settings.window,
                  level: settings.level,
                })
              }
            }}
            projection={cameraProjection}
            onProjectionChange={setCameraProjection}
            reconstructionEnabled={reconstructionEnabled}
            reconstructionReady={reconstruction.volume?.seriesId === volume?.seriesId}
            reconstructionStatus={reconstruction.status}
            reconstructionMessage={reconstruction.message}
            onReconstructionEnabledChange={handleReconstructionEnabledChange}
            cropBounds={cropBounds}
            onCropChange={setCropBounds}
            onSetView={(view) => viewerRef.current?.setView(view)}
            onRotate={(axis) => viewerRef.current?.rotateVolume(axis)}
          />
        </div>
      )}

      <footer className="app-footer">
        <span><Box size={12} /> {screen === 'library' ? `${bundledSeries.length} included sequences` : volume?.description || 'No active volume'}</span>
        <span>All scan data stays on this device</span>
        <span className={error || progress.phase === 'error' ? 'footer-ready is-error' : 'footer-ready'}>
          <i />
          {busy ? progress.label : error || progress.phase === 'error' ? progress.label || error : 'Renderer ready'}
        </span>
      </footer>

      <ShortcutSheet open={shortcutSheetOpen} onClose={() => setShortcutSheetOpen(false)} />
    </div>
  )
}
