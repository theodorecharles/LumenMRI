import { useEffect, useMemo, useState } from 'react'
import { Box, ChevronRight, FolderOpen, Layers3, Maximize2, ScanLine } from 'lucide-react'
import type { BundledCatalog, BundledSeries } from '../lib/bundledVolume'
import { bundledAssetUrl } from '../lib/bundledVolume'
import { formatBytes } from '../lib/volume'

interface ScanLibraryProps {
  catalog: BundledCatalog | null
  loading: boolean
  error: string | null
  openingId: string | null
  onOpenSeries: (series: BundledSeries) => void
  onOpenLocal: () => void
}

function SeriesPreview({ series }: { series: BundledSeries }) {
  const [frame, setFrame] = useState(0)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!hovered || series.previewFrames < 2) return
    const interval = window.setInterval(
      () => setFrame((value) => (value + 1) % series.previewFrames),
      145,
    )
    return () => window.clearInterval(interval)
  }, [hovered, series.previewFrames])

  return (
    <div
      className="series-preview"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setFrame(0)
      }}
    >
      <img
        src={bundledAssetUrl(series.preview)}
        alt={`${series.description} animated slice preview`}
        style={{
          width: `${series.previewFrames * 100}%`,
          transform: `translateX(-${(frame * 100) / series.previewFrames}%)`,
        }}
      />
      <span className="preview-plane">{series.orientation}</span>
      <span className="preview-hover">
        <ScanLine size={13} /> {hovered ? `Layer ${frame + 1}/${series.previewFrames}` : 'Hover to scrub'}
      </span>
      <span className="preview-open">
        <Maximize2 size={14} /> Open viewer
      </span>
    </div>
  )
}

export function ScanLibrary({
  catalog,
  loading,
  error,
  openingId,
  onOpenSeries,
  onOpenLocal,
}: ScanLibraryProps) {
  const [filter, setFilter] = useState('all')
  const allSeries = useMemo(
    () => catalog?.datasets.flatMap((dataset) => dataset.series) || [],
    [catalog],
  )
  const visibleSeries = filter === 'all'
    ? allSeries
    : allSeries.filter((series) => series.datasetId === filter)
  const totalLayers = allSeries.reduce((total, series) => total + series.sliceCount, 0)

  return (
    <main className="scan-library">
      <div className="library-hero">
        <div>
          <span className="eyebrow">Included studies</span>
          <h1>Scan library</h1>
          <p>Explore every sequence from both de-identified MRI studies. Hover a card to scrub through its layers, then open it in linked 2D, 3D, or split views.</p>
        </div>
        <button className="primary-button" type="button" onClick={onOpenLocal}>
          <FolderOpen size={17} /> Open another scan
        </button>
      </div>

      <div className="library-toolbar">
        <div className="dataset-tabs" role="tablist" aria-label="Filter scan studies">
          <button
            className={filter === 'all' ? 'active' : ''}
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            All sequences <span>{allSeries.length}</span>
          </button>
          {catalog?.datasets.map((dataset) => (
            <button
              className={filter === dataset.id ? 'active' : ''}
              key={dataset.id}
              type="button"
              role="tab"
              aria-selected={filter === dataset.id}
              onClick={() => setFilter(dataset.id)}
            >
              {dataset.title} <span>{dataset.series.length}</span>
            </button>
          ))}
        </div>
        <div className="library-stats">
          <span><Box size={13} /> {catalog?.datasets.length || 0} studies</span>
          <span><Layers3 size={13} /> {totalLayers.toLocaleString()} layers</span>
        </div>
      </div>

      {error ? <div className="library-error">{error}</div> : null}

      <div className="scan-grid" aria-busy={loading}>
        {loading
          ? Array.from({ length: 8 }, (_, index) => <div className="scan-card skeleton" key={index} />)
          : visibleSeries.map((series) => (
              <article className={openingId === series.id ? 'scan-card opening' : 'scan-card'} key={series.id}>
                <button type="button" onClick={() => onOpenSeries(series)}>
                  <SeriesPreview series={series} />
                  <span className="scan-card-copy">
                    <span className="scan-card-study">{series.datasetTitle}</span>
                    <b>{series.description}</b>
                    <small>
                      {series.sliceCount} layers · {series.dimensions[0]}×{series.dimensions[1]}
                    </small>
                    <span className="scan-card-footer">
                      <i>{formatBytes(series.compressedByteLength / 1024 / 1024)}</i>
                      <em>{openingId === series.id ? 'Loading volume…' : 'View volume'} <ChevronRight size={13} /></em>
                    </span>
                  </span>
                </button>
              </article>
            ))}
      </div>
    </main>
  )
}
