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
import { useViewerSession } from './hooks/useViewerSession'
import { useVolumeReconstruction } from './hooks/useVolumeReconstruction'
import { isTextEntryTarget, targetActivatesOnKey } from './lib/keyboardShortcuts'
import {
  anatomicalPlaneFromOrientation,
  mapPlaneLocusToPlane,
  resliceVolume,
  sourcePointToPlane,
} from './lib/mpr'
import { isReconstructionReady } from './lib/reconstructVolume'
import { compositeCompareSlicePng, exportCapturePng, type CaptureExportResult } from './lib/sliceCapture'
import {
  mapRelativeSliceIndex,
  midSliceIndex,
  remapSliceIndexForMprDepthChange,
  sliceIndexFromStackFraction,
  sliceIndexForVolumeChange,
} from './lib/volume'
import type {
  AnatomicalPlane,
  CropBounds,
  Vec3Tuple,
  VolumeData,
  VolumeSettings,
} from './types'
import { ControlPanel } from './components/ControlPanel'
import { EmptyStage } from './components/EmptyStage'
import { ScanLibrary } from './components/ScanLibrary'
import { SeriesPanel } from './components/SeriesPanel'
import { ShortcutSheet } from './components/ShortcutSheet'
import { SliceViewer, type SliceViewerHandle } from './components/SliceViewer'
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

type ViewerLayout = 'volume' | 'slice' | 'split' | 'compare'

export default function App() {
  const session = useViewerSession()
  const {
    inputRef,
    primarySliceIndexRef,
    primarySettingsRef,
    screen,
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
    volume,
    progress,
    error,
    busy,
    bundledSeries,
    displaySeries,
    clearCompare,
    openBundledSeries,
    setCompareSeries,
    goHome,
    handleFiles,
    openFolder,
    selectSeries,
    showDemo,
    onDropFiles,
  } = session

  const viewerRef = useRef<ViewerStageHandle>(null)
  const sliceViewerRef = useRef<SliceViewerHandle>(null)
  const compareSliceViewerRef = useRef<SliceViewerHandle>(null)
  const stageRef = useRef<HTMLElement>(null)
  /** Through-plane depth of the last applied volume; null means no prior slice context. */
  const previousDepthRef = useRef<number | null>(null)
  /** Whether sliceIndex belonged to that volume's acquired stack before it changed. */
  const previousSlicePlaneWasAcquiredRef = useRef<boolean | null>(null)
  /**
   * Active 2D/MPR stack depth + plane + series for remapping sliceIndex when
   * reformat depth changes without a plane/series switch (recon ready /
   * Enhanced toggle). Series hop is owned by the volume-change effect.
   */
  const previousMprStackDepthRef = useRef<number | null>(null)
  const previousMprSlicePlaneRef = useRef<AnatomicalPlane | null>(null)
  const previousMprSeriesIdRef = useRef<string | null>(null)
  const sliceIndexRef = useRef(0)
  const compareSliceIndexRef = useRef(0)
  const reconstruction = useVolumeReconstruction(volume)
  const [volumeSettings, setVolumeSettings] = useState(DEFAULT_VOLUME_SETTINGS)
  primarySettingsRef.current = {
    window: volumeSettings.window,
    level: volumeSettings.level,
  }
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
  primarySliceIndexRef.current = sliceIndex
  const [showSliceHighlight, setShowSliceHighlight] = useState(false)
  const [cropBounds, setCropBounds] = useState<CropBounds>(FULL_CROP)
  const [cropEditing, setCropEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isStageFullscreen, setIsStageFullscreen] = useState(false)
  const [shortcutSheetOpen, setShortcutSheetOpen] = useState(false)
  /** Brief "Copied" toast after a successful clipboard capture. */
  const [captureToast, setCaptureToast] = useState<string | null>(null)
  const captureToastTimerRef = useRef<number | null>(null)
  /** Brief 2D crosshair flash after a 3D volume pick or MPR plane switch (token re-triggers). */
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
  /**
   * Grid the 3D view and every non-acquired MPR reformat sample from. Reconstruction
   * scales the acquired in-plane grid to the device texture budget, so reformat sizes
   * follow this, not the acquired columns/rows.
   */
  const renderGrid = useMemo<Vec3Tuple | null>(() => {
    if (!volume) return null
    return reconstructionEnabled && reconstruction.volume?.seriesId === volume.seriesId
      ? reconstruction.volume.dimensions
      : volume.dimensions
  }, [reconstruction.volume, reconstructionEnabled, volume])
  const primarySliceVolume =
    viewerLayout === 'slice' || viewerLayout === 'split' ? mprVolume : volume

  const volumeCropped = cropBounds.minX > 0.001 || cropBounds.maxX < 0.999 ||
    cropBounds.minY > 0.001 || cropBounds.maxY < 0.999 ||
    cropBounds.minZ > 0.001 || cropBounds.maxZ < 0.999

  const handleReconstructionEnabledChange = useCallback((enabled: boolean) => {
    // Explicit user choice — do not auto-restore Enhanced on a later ready.
    reconstructionDisabledByErrorRef.current = false
    setReconstructionEnabled(enabled)
  }, [])

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
  }, [setCompareSettings, viewLinked])

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
  }, [setCompareSettings, viewLinked])

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

  // Compare pane B applied — enter compare layout (session owns the series, App owns layout chrome).
  useEffect(() => {
    if (compareSeriesId) setViewerLayout('compare')
  }, [compareSeriesId])

  const compareVolumeRef = useRef(compareVolume)
  compareVolumeRef.current = compareVolume
  const slicesLinkedRef = useRef(slicesLinked)
  slicesLinkedRef.current = slicesLinked

  useEffect(() => {
    if (!volume) {
      previousDepthRef.current = null
      previousSlicePlaneWasAcquiredRef.current = null
      return
    }
    setSlicePlane(anatomicalPlaneFromOrientation(volume.orientation))
    const nextDepth = volume.dimensions[2]
    const nextSlice = sliceIndexForVolumeChange(
      sliceIndexRef.current,
      previousDepthRef.current,
      nextDepth,
      previousSlicePlaneWasAcquiredRef.current,
    )
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
  }, [setCompareSliceIndex, volume])

  // Update after the volume-change effect so a series hop reads the plane state
  // belonging to the volume that was visible before the hop.
  useEffect(() => {
    if (!volume) return
    previousSlicePlaneWasAcquiredRef.current = slicePlaneIsAcquired
  }, [slicePlaneIsAcquired, volume])

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
    [compareVolume, primarySliceVolume, setCompareSliceIndex, slicesLinked],
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
    [compareVolume, primarySliceVolume, setCompareSliceIndex, slicesLinked],
  )

  // Keep sliceIndex in MPR stack space when reformat depth changes on the same
  // non-acquired plane (reconstruction ready, Enhanced/Acquired toggle).
  useEffect(() => {
    if (!mprVolume || !volume) {
      previousMprStackDepthRef.current = null
      previousMprSlicePlaneRef.current = null
      previousMprSeriesIdRef.current = null
      return
    }
    const nextDepth = mprVolume.dimensions[2]
    const previousDepth = previousMprStackDepthRef.current
    const planeChanged =
      previousMprSlicePlaneRef.current != null
      && previousMprSlicePlaneRef.current !== slicePlane
    const seriesChanged =
      previousMprSeriesIdRef.current != null
      && previousMprSeriesIdRef.current !== volume.seriesId
    const nextSlice = remapSliceIndexForMprDepthChange(
      sliceIndexRef.current,
      previousDepth,
      nextDepth,
      { planeChanged, slicePlaneIsAcquired, seriesChanged },
    )
    if (nextSlice !== sliceIndexRef.current) {
      setSliceIndex(nextSlice)
      if (slicesLinkedRef.current && compareVolumeRef.current) {
        setCompareSliceIndex(
          mapRelativeSliceIndex(
            nextSlice,
            nextDepth,
            compareVolumeRef.current.dimensions[2],
          ),
        )
      }
    }
    previousMprStackDepthRef.current = nextDepth
    previousMprSlicePlaneRef.current = slicePlane
    previousMprSeriesIdRef.current = volume.seriesId
  }, [mprVolume, slicePlane, slicePlaneIsAcquired, volume])

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
    setCompareSliceIndex,
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
    // Keep the anatomy under the current locus (last pick, else image center)
    // via the same sourcePointToPlane / inverse path as Alt+click picks.
    const currentDepth = mprVolume?.dimensions[2] ?? volume.dimensions[2]
    const stackFraction =
      currentDepth <= 1
        ? 0.5
        : Math.max(0, Math.min(1, sliceIndex / (currentDepth - 1)))
    const mapped = mapPlaneLocusToPlane(
      {
        x: slicePickFlash?.x ?? 0.5,
        y: slicePickFlash?.y ?? 0.5,
        stackFraction,
      },
      acquiredPlane,
      slicePlane,
      nextPlane,
    )
    setSlicePlane(nextPlane)
    setSliceIndex(sliceIndexFromStackFraction(mapped.stackFraction, nextVolume.dimensions[2]))
    // Flash at the mapped in-plane point so the preserved locus is obvious.
    slicePickFlashTokenRef.current += 1
    setSlicePickFlash({
      token: slicePickFlashTokenRef.current,
      x: mapped.x,
      y: mapped.y,
    })
    setCropEditing(false)
    setShowSliceHighlight(false)
  }, [
    acquiredPlane,
    enhancedMprSource,
    mprVolume,
    sliceIndex,
    slicePickFlash,
    slicePlane,
    volume,
  ])

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

  // Leaving the viewer via goHome — stop auto-orbit chrome.
  useEffect(() => {
    if (screen === 'library') setAutoRotate(false)
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
      if (isTextEntryTarget(target)) return

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

      // A focused button/link consumes Space and Enter itself; running a viewer
      // shortcut on those would double-fire the control. Every other shortcut
      // keeps working while a toolbar control holds focus after a click.
      if (targetActivatesOnKey(target, event.key)) return
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
    await onDropFiles(event.dataTransfer)
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
                          data-reconstructed-width={renderGrid?.[0] ?? volume.dimensions[0]}
                          data-reconstructed-height={renderGrid?.[1] ?? volume.dimensions[1]}
                          data-reconstructed-depth={renderGrid?.[2] ?? volume.dimensions[2]}
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
            reconstructionReady={isReconstructionReady(reconstruction.volume, volume)}
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
