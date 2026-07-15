import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Box,
  Camera,
  Columns2,
  Cpu,
  Crop,
  FolderOpen,
  LayoutGrid,
  Layers3,
  Link2,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  Unlink2,
} from 'lucide-react'
import { useDicomLoader } from './hooks/useDicomLoader'
import { useVolumeReconstruction } from './hooks/useVolumeReconstruction'
import { chooseDirectory, filesFromDrop } from './lib/fileAccess'
import { createDemoVolume, linkedSliceIndex } from './lib/volume'
import {
  bundledSeriesSummary,
  loadBundledCatalog,
  loadBundledVolume,
  type BundledCatalog,
  type BundledSeries,
} from './lib/bundledVolume'
import type { CropBounds, SeriesSummary, VolumeData, VolumeSettings } from './types'
import { ControlPanel } from './components/ControlPanel'
import { EmptyStage } from './components/EmptyStage'
import { ScanLibrary } from './components/ScanLibrary'
import { SeriesPanel } from './components/SeriesPanel'
import { SliceViewer, type SliceViewerHandle } from './components/SliceViewer'
import type { ViewerStageHandle } from './components/ViewerStage'

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

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<ViewerStageHandle>(null)
  const sliceViewerRef = useRef<SliceViewerHandle>(null)
  const sliceViewerBRef = useRef<SliceViewerHandle>(null)
  const stageRef = useRef<HTMLElement>(null)
  const volumeCache = useRef(new Map<string, VolumeData>())
  const {
    series,
    volume,
    setVolume,
    compareVolume,
    setCompareVolume,
    progress,
    error,
    scanFiles,
    loadSeries,
  } = useDicomLoader()
  const reconstruction = useVolumeReconstruction(volume)
  const [screen, setScreen] = useState<Screen>('library')
  const [catalog, setCatalog] = useState<BundledCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null)
  const [compareSeriesId, setCompareSeriesId] = useState<string | null>(null)
  const [volumeSettings, setVolumeSettings] = useState(DEFAULT_VOLUME_SETTINGS)
  const [compareSettings, setCompareSettings] = useState(DEFAULT_VOLUME_SETTINGS)
  const [autoRotate, setAutoRotate] = useState(false)
  const [reconstructionEnabled, setReconstructionEnabled] = useState(true)
  const [cameraProjection, setCameraProjection] = useState<'perspective' | 'isometric'>('perspective')
  const [viewerLayout, setViewerLayout] = useState<ViewerLayout>('volume')
  const [sliceIndex, setSliceIndex] = useState(0)
  const [sliceIndexB, setSliceIndexB] = useState(0)
  const [slicesLinked, setSlicesLinked] = useState(true)
  const [showSliceHighlight, setShowSliceHighlight] = useState(false)
  const [cropBounds, setCropBounds] = useState<CropBounds>(FULL_CROP)
  const [cropEditing, setCropEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isStageFullscreen, setIsStageFullscreen] = useState(false)

  const workerBusy = progress.phase === 'scanning' || progress.phase === 'loading'
  const busy = workerBusy || openingId !== null
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

  // Terminal reconstruction failure: stay on acquired data, never leave Enhanced "Processing".
  useEffect(() => {
    if (reconstruction.status === 'error') {
      setReconstructionEnabled(false)
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

  useEffect(() => {
    if (progress.phase !== 'error') return
    setCompareSeriesId(compareVolume?.seriesId ?? null)
  }, [progress.phase, compareVolume])

  const pushViewerLocation = useCallback((id: string) => {
    window.history.pushState({ screen: 'viewer', seriesId: id }, '', `#series/${id}`)
  }, [])

  const loadBundledCached = useCallback(async (selection: BundledSeries) => {
    let selectedVolume = volumeCache.current.get(selection.id)
    if (!selectedVolume) {
      selectedVolume = await loadBundledVolume(selection)
      volumeCache.current.set(selection.id, selectedVolume)
    }
    return selectedVolume
  }, [])

  const openBundledSeries = useCallback(
    async (selection: BundledSeries, pushHistory = true) => {
      if (openingId) return
      setCatalogError(null)
      setOpeningId(selection.id)
      try {
        const selectedVolume = await loadBundledCached(selection)
        setVolume(selectedVolume)
        setActiveSeriesId(selection.id)
        if (compareSeriesId === selection.id) {
          setCompareVolume(null)
          setCompareSeriesId(null)
        }
        setScreen('viewer')
        if (pushHistory) pushViewerLocation(selection.id)
      } catch (loadError: unknown) {
        setCatalogError(
          loadError instanceof Error ? loadError.message : 'The selected volume could not be opened.',
        )
        setScreen('library')
      } finally {
        setOpeningId(null)
      }
    },
    [compareSeriesId, loadBundledCached, openingId, pushViewerLocation, setCompareVolume, setVolume],
  )

  const openBundledCompare = useCallback(
    async (selection: BundledSeries) => {
      if (openingId || selection.id === activeSeriesId) return
      setCatalogError(null)
      setOpeningId(selection.id)
      try {
        const selectedVolume = await loadBundledCached(selection)
        setCompareVolume(selectedVolume)
        setCompareSeriesId(selection.id)
        setSliceIndexB(
          volume
            ? linkedSliceIndex(sliceIndex, volume.dimensions[2], selectedVolume.dimensions[2])
            : Math.floor((selectedVolume.dimensions[2] - 1) / 2),
        )
        setViewerLayout('compare')
        setScreen('viewer')
      } catch (loadError: unknown) {
        setCatalogError(
          loadError instanceof Error
            ? loadError.message
            : 'The compare volume could not be opened.',
        )
      } finally {
        setOpeningId(null)
      }
    },
    [activeSeriesId, loadBundledCached, openingId, setCompareVolume, sliceIndex, volume],
  )

  useEffect(() => {
    const navigateFromHistory = () => {
      if (window.location.hash === '#local') {
        setScreen('viewer')
        return
      }
      const match = window.location.hash.match(/^#series\/(.+)$/)
      if (!match) {
        setScreen('library')
        return
      }
      const id = decodeURIComponent(match[1])
      const included = bundledSeries.find((entry) => entry.id === id)
      if (included) void openBundledSeries(included, false)
      else {
        const local = series.find((entry) => entry.id === id)
        if (local) {
          setActiveSeriesId(local.id)
          setScreen('viewer')
          loadSeries(local.id)
        }
      }
    }
    window.addEventListener('popstate', navigateFromHistory)
    if (bundledSeries.length && window.location.hash) navigateFromHistory()
    return () => window.removeEventListener('popstate', navigateFromHistory)
  }, [bundledSeries, loadSeries, openBundledSeries, series])

  const goHome = useCallback((pushHistory = true) => {
    setScreen('library')
    setAutoRotate(false)
    if (pushHistory) {
      window.history.pushState({ screen: 'library' }, '', `${window.location.pathname}${window.location.search}`)
    }
  }, [])

  const handleFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      setActiveSeriesId(null)
      setCompareSeriesId(null)
      setCompareVolume(null)
      setScreen('viewer')
      window.history.pushState({ screen: 'viewer', local: true }, '', '#local')
      scanFiles(files)
    },
    [scanFiles, setCompareVolume],
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
    if (selection.id === activeSeriesId || busy) return
    const included = bundledSeries.find((entry) => entry.id === selection.id)
    if (included) {
      void openBundledSeries(included)
      return
    }
    if (compareSeriesId === selection.id) {
      setCompareVolume(null)
      setCompareSeriesId(null)
    }
    setActiveSeriesId(selection.id)
    setScreen('viewer')
    pushViewerLocation(selection.id)
    loadSeries(selection.id)
  }

  const selectCompareSeries = (selection: SeriesSummary) => {
    if (busy || selection.id === activeSeriesId) return
    const included = bundledSeries.find((entry) => entry.id === selection.id)
    if (included) {
      void openBundledCompare(included)
      return
    }
    setCompareSeriesId(selection.id)
    setViewerLayout('compare')
    setScreen('viewer')
    loadSeries(selection.id, 'compare')
  }

  const showDemo = () => {
    setActiveSeriesId('demo-phantom')
    setCompareSeriesId(null)
    setCompareVolume(null)
    setVolume(createDemoVolume())
  }

  const setPrimarySlice = useCallback(
    (index: number) => {
      setSliceIndex(index)
      if (slicesLinked && compareVolume) {
        setSliceIndexB(linkedSliceIndex(index, volume?.dimensions[2] || 1, compareVolume.dimensions[2]))
      }
    },
    [compareVolume, slicesLinked, volume],
  )

  const setCompareSlice = useCallback(
    (index: number) => {
      setSliceIndexB(index)
      if (slicesLinked && volume && compareVolume) {
        setSliceIndex(linkedSliceIndex(index, compareVolume.dimensions[2], volume.dimensions[2]))
      }
    },
    [compareVolume, slicesLinked, volume],
  )

  useEffect(() => {
    if (!volume) return
    setSliceIndex(Math.floor((volume.dimensions[2] - 1) / 2))
    setCropBounds(FULL_CROP)
    setCropEditing(false)
  }, [volume])

  useEffect(() => {
    if (!compareVolume) return
    if (slicesLinked && volume) {
      setSliceIndexB(linkedSliceIndex(sliceIndex, volume.dimensions[2], compareVolume.dimensions[2]))
    } else {
      setSliceIndexB(Math.floor((compareVolume.dimensions[2] - 1) / 2))
    }
    // Only re-seed B when the compare series identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: series swap only
  }, [compareVolume?.seriesId])

  useEffect(() => {
    if (!compareVolume) return
    setCompareSeriesId(compareVolume.seriesId)
  }, [compareVolume])

  useEffect(() => {
    if (cropEditing) setAutoRotate(false)
  }, [cropEditing])

  const toggleStageFullscreen = useCallback(() => {
    if (isStageFullscreen) {
      setIsStageFullscreen(false)
      if (document.fullscreenElement) void document.exitFullscreen()
      return
    }

    // iPhone Safari does not consistently support element fullscreen for WebGL.
    // Enter the app-level layout first, then enhance it with native fullscreen
    // on browsers that support it.
    setIsStageFullscreen(true)
    const requestFullscreen = stageRef.current?.requestFullscreen
    if (requestFullscreen) void requestFullscreen.call(stageRef.current).catch(() => undefined)
  }, [isStageFullscreen])

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

  const captureActiveView = useCallback(() => {
    if (viewerLayout === 'slice' || viewerLayout === 'compare') sliceViewerRef.current?.capture()
    else viewerRef.current?.capture()
  }, [viewerLayout])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return
      if (event.key.toLowerCase() === 'r') viewerRef.current?.resetView()
      if (event.key.toLowerCase() === 'f') toggleStageFullscreen()
      if (event.key.toLowerCase() === 's') captureActiveView()
      if (event.key.toLowerCase() === 'l') goHome()
      if (event.key === 'Escape' && isStageFullscreen && !document.fullscreenElement) {
        setIsStageFullscreen(false)
      }
      if (event.key === '1') setViewerLayout('volume')
      if (event.key === '2') setViewerLayout('slice')
      if (event.key === '3') setViewerLayout('split')
      if (event.key === '4') setViewerLayout('compare')
      if (volume) {
        const depth = volume.dimensions[2]
        const step =
          event.key === 'ArrowUp' || event.key === ','
            ? -1
            : event.key === 'ArrowDown' || event.key === '.'
              ? 1
              : 0
        if (step !== 0) {
          event.preventDefault()
          const next = Math.max(0, Math.min(depth - 1, sliceIndex + step))
          setPrimarySlice(next)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    captureActiveView,
    goHome,
    isStageFullscreen,
    setPrimarySlice,
    sliceIndex,
    toggleStageFullscreen,
    volume,
  ])

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
            onSelectCompare={selectCompareSeries}
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
                      <ArrowLeftRight size={15} /> Compare <kbd>4</kbd>
                    </button>
                  </div>
                  <div className="tool-actions">
                    {viewerLayout === 'compare' ? (
                      <button
                        className={slicesLinked ? 'slice-link-toggle active' : 'slice-link-toggle'}
                        type="button"
                        aria-pressed={slicesLinked}
                        aria-label={slicesLinked ? 'Unlock slice indices' : 'Link slice indices by depth'}
                        title={
                          slicesLinked
                            ? 'Slices linked by relative depth — click to unlock'
                            : 'Slices unlocked — click to link by relative depth'
                        }
                        onClick={() => {
                          setSlicesLinked((linked) => {
                            const next = !linked
                            if (next && volume && compareVolume) {
                              setSliceIndexB(
                                linkedSliceIndex(
                                  sliceIndex,
                                  volume.dimensions[2],
                                  compareVolume.dimensions[2],
                                ),
                              )
                            }
                            return next
                          })
                        }}
                      >
                        {slicesLinked ? <Link2 size={14} /> : <Unlink2 size={14} />}
                        <span>{slicesLinked ? 'Linked' : 'Unlocked'}</span>
                      </button>
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
                          title={showSliceHighlight ? 'Hide selected slice in 3D' : 'Show selected slice in 3D'}
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
                    <button className="icon-button" type="button" title="Save image (S)" onClick={captureActiveView}><Camera size={16} /></button>
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
                </div>

                <div className={`stage-view-grid layout-${viewerLayout}`}>
                  {viewerLayout === 'compare' ? (
                    <>
                      <SliceViewer
                        ref={sliceViewerRef}
                        volume={volume}
                        sliceIndex={sliceIndex}
                        onSliceChange={setPrimarySlice}
                        volumeSettings={volumeSettings}
                        onVolumeSettingsChange={(patch) => setVolumeSettings((current) => ({ ...current, ...patch }))}
                        cropBounds={FULL_CROP}
                        onCropChange={setCropBounds}
                        cropEditing={false}
                        onCropEditingChange={setCropEditing}
                        viewerLayout={viewerLayout}
                        paneLabel="A"
                        showCropTools={false}
                      />
                      {compareVolume ? (
                        <SliceViewer
                          ref={sliceViewerBRef}
                          volume={compareVolume}
                          sliceIndex={sliceIndexB}
                          onSliceChange={setCompareSlice}
                          volumeSettings={compareSettings}
                          onVolumeSettingsChange={(patch) => setCompareSettings((current) => ({ ...current, ...patch }))}
                          cropBounds={FULL_CROP}
                          onCropChange={setCropBounds}
                          cropEditing={false}
                          onCropEditingChange={setCropEditing}
                          viewerLayout={viewerLayout}
                          paneLabel="B"
                          showCropTools={false}
                        />
                      ) : (
                        <section className="compare-empty-pane" aria-label="Compare series B empty">
                          <ArrowLeftRight size={28} />
                          <b>Set series B</b>
                          <p>
                            Alt-click a series in the panel, or press its <kbd>B</kbd> control,
                            to open a second sequence side by side.
                          </p>
                        </section>
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
                              sliceIndex={sliceIndex}
                              showSliceHighlight={showSliceHighlight}
                              cropBounds={cropBounds}
                              cropEditing={cropEditing}
                              onCropChange={setCropBounds}
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
                          volume={volume}
                          sliceIndex={sliceIndex}
                          onSliceChange={setPrimarySlice}
                          volumeSettings={volumeSettings}
                          onVolumeSettingsChange={(patch) => setVolumeSettings((current) => ({ ...current, ...patch }))}
                          cropBounds={cropBounds}
                          onCropChange={setCropBounds}
                          cropEditing={cropEditing}
                          onCropEditingChange={setCropEditing}
                          viewerLayout={viewerLayout}
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
                          : openingId ? 'Loading included volume' : progress.label}
                      </span>
                      <b>
                        {reconstruction.status === 'processing' && !busy
                          ? `${Math.round(reconstruction.progress * 100)}%`
                          : openingId ? '…' : `${Math.round(progress.progress * 100)}%`}
                      </b>
                    </div>
                    <i>
                      <span style={{
                        width: reconstruction.status === 'processing' && !busy
                          ? `${reconstruction.progress * 100}%`
                          : openingId ? '65%' : `${progress.progress * 100}%`,
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
            setVolumeSettings={setVolumeSettings}
            projection={cameraProjection}
            onProjectionChange={setCameraProjection}
            reconstructionEnabled={reconstructionEnabled}
            reconstructionReady={reconstruction.volume?.seriesId === volume?.seriesId}
            reconstructionStatus={reconstruction.status}
            reconstructionMessage={reconstruction.message}
            onReconstructionEnabledChange={setReconstructionEnabled}
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
    </div>
  )
}
