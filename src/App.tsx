import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Camera,
  Columns2,
  Cpu,
  FolderOpen,
  LayoutGrid,
  Layers3,
  LockKeyhole,
  Maximize2,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
} from 'lucide-react'
import { useDicomLoader } from './hooks/useDicomLoader'
import { chooseDirectory, filesFromDrop } from './lib/fileAccess'
import { createDemoVolume } from './lib/volume'
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
  clip: 1,
  palette: 'cyan',
}

const FULL_CROP: CropBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 }

type Screen = 'library' | 'viewer'
type ViewerLayout = 'volume' | 'slice' | 'split'

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<ViewerStageHandle>(null)
  const sliceViewerRef = useRef<SliceViewerHandle>(null)
  const stageRef = useRef<HTMLElement>(null)
  const volumeCache = useRef(new Map<string, VolumeData>())
  const { series, volume, setVolume, progress, error, scanFiles, loadSeries } = useDicomLoader()
  const [screen, setScreen] = useState<Screen>('library')
  const [catalog, setCatalog] = useState<BundledCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null)
  const [volumeSettings, setVolumeSettings] = useState(DEFAULT_VOLUME_SETTINGS)
  const [autoRotate, setAutoRotate] = useState(false)
  const [viewerLayout, setViewerLayout] = useState<ViewerLayout>('volume')
  const [sliceIndex, setSliceIndex] = useState(0)
  const [showSliceHighlight, setShowSliceHighlight] = useState(false)
  const [cropBounds, setCropBounds] = useState<CropBounds>(FULL_CROP)
  const [cropEditing, setCropEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const workerBusy = progress.phase === 'scanning' || progress.phase === 'loading'
  const busy = workerBusy || openingId !== null
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

  useEffect(() => {
    if (!series.length || activeSeriesId) return
    const recommended = series.find((item) => item.supported)
    if (!recommended) return
    setActiveSeriesId(recommended.id)
    loadSeries(recommended.id)
  }, [activeSeriesId, loadSeries, series])

  const pushViewerLocation = useCallback((id: string) => {
    window.history.pushState({ screen: 'viewer', seriesId: id }, '', `#series/${id}`)
  }, [])

  const openBundledSeries = useCallback(
    async (selection: BundledSeries, pushHistory = true) => {
      if (openingId) return
      setCatalogError(null)
      setOpeningId(selection.id)
      try {
        let selectedVolume = volumeCache.current.get(selection.id)
        if (!selectedVolume) {
          selectedVolume = await loadBundledVolume(selection)
          volumeCache.current.set(selection.id, selectedVolume)
        }
        setVolume(selectedVolume)
        setActiveSeriesId(selection.id)
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
    [openingId, pushViewerLocation, setVolume],
  )

  useEffect(() => {
    const navigateFromHistory = () => {
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
      setScreen('viewer')
      window.history.pushState({ screen: 'viewer', local: true }, '', '#local')
      scanFiles(files)
    },
    [scanFiles],
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
    setActiveSeriesId(selection.id)
    setScreen('viewer')
    pushViewerLocation(selection.id)
    loadSeries(selection.id)
  }

  const showDemo = () => {
    setActiveSeriesId('demo-phantom')
    setVolume(createDemoVolume())
  }

  useEffect(() => {
    if (!volume) return
    setSliceIndex(Math.floor((volume.dimensions[2] - 1) / 2))
    setCropBounds(FULL_CROP)
    setCropEditing(false)
  }, [volume])

  const toggleStageFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else if (stageRef.current) void stageRef.current.requestFullscreen()
  }, [])

  const captureActiveView = useCallback(() => {
    if (viewerLayout === 'slice') sliceViewerRef.current?.capture()
    else viewerRef.current?.capture()
  }, [viewerLayout])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return
      if (event.key.toLowerCase() === 'r') viewerRef.current?.resetView()
      if (event.key.toLowerCase() === 'f') toggleStageFullscreen()
      if (event.key.toLowerCase() === 's') captureActiveView()
      if (event.key.toLowerCase() === 'l') goHome()
      if (event.key === '1') setViewerLayout('volume')
      if (event.key === '2') setViewerLayout('slice')
      if (event.key === '3') setViewerLayout('split')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [captureActiveView, goHome, toggleStageFullscreen])

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    handleFiles(await filesFromDrop(event.dataTransfer))
  }

  return (
    <div
      className="app-shell"
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
        onChange={(event) => handleFiles([...(event.target.files || [])])}
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
            busy={busy}
            onSelect={selectSeries}
            onOpen={openFolder}
          />

          <main className="stage-shell" ref={stageRef}>
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
                  </div>
                  <div className="tool-actions">
                    {viewerLayout !== 'slice' ? (
                      <>
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
                        <button className="icon-button" type="button" title="Reset view (R)" onClick={() => viewerRef.current?.resetView()}><RotateCcw size={16} /></button>
                      </>
                    ) : null}
                    <button className="icon-button" type="button" title="Save image (S)" onClick={captureActiveView}><Camera size={16} /></button>
                    <button className="icon-button" type="button" title="Fullscreen (F)" onClick={toggleStageFullscreen}><Maximize2 size={16} /></button>
                  </div>
                </div>

                <div className={`stage-view-grid layout-${viewerLayout}`}>
                  {viewerLayout !== 'slice' ? (
                    <section className="viewer-stage-pane" aria-label="3D volume view">
                      <Suspense fallback={<div className="viewer-loading">Initializing GPU renderer…</div>}>
                        <ViewerStage
                          ref={viewerRef}
                          volume={volume}
                          volumeSettings={volumeSettings}
                          autoRotate={autoRotate}
                          sliceIndex={sliceIndex}
                          showSliceHighlight={showSliceHighlight}
                          cropBounds={cropBounds}
                        />
                      </Suspense>
                      <div className="volume-hud top-left">
                        <span className="hud-kicker">Active reconstruction</span>
                        <b>{volume.description}</b>
                        <small>{volume.orientation} · {volume.dimensions.join(' × ')} voxels</small>
                      </div>
                      <div className="volume-hud bottom-left">
                        <MousePointer2 size={14} /><span>Drag to orbit</span><i /><span>Scroll to zoom</span>
                      </div>
                      <div className="render-stats">
                        <span><Cpu size={13} /> GPU</span><b>{volume.sliceCount} layers</b>
                      </div>
                    </section>
                  ) : null}
                  {viewerLayout !== 'volume' ? (
                    <SliceViewer
                      ref={sliceViewerRef}
                      volume={volume}
                      sliceIndex={sliceIndex}
                      onSliceChange={setSliceIndex}
                      volumeSettings={volumeSettings}
                      cropBounds={cropBounds}
                      onCropChange={setCropBounds}
                      cropEditing={cropEditing}
                      onCropEditingChange={setCropEditing}
                    />
                  ) : null}
                </div>

                {busy ? (
                  <div className="stage-progress" role="status">
                    <div>
                      <span>{openingId ? 'Loading included volume' : progress.label}</span>
                      <b>{openingId ? '…' : `${Math.round(progress.progress * 100)}%`}</b>
                    </div>
                    <i><span style={{ width: openingId ? '65%' : `${progress.progress * 100}%` }} /></i>
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
            onSetView={(view) => viewerRef.current?.setView(view)}
            onRotate={(axis) => viewerRef.current?.rotateVolume(axis)}
          />
        </div>
      )}

      <footer className="app-footer">
        <span><Box size={12} /> {screen === 'library' ? `${bundledSeries.length} included sequences` : volume?.description || 'No active volume'}</span>
        <span>All scan data stays on this device</span>
        <span className="footer-ready"><i /> {busy ? progress.label : 'Renderer ready'}</span>
      </footer>
    </div>
  )
}
