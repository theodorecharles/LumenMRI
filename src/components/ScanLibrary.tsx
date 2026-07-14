import { useMemo, useState } from 'react'
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
  const frameCount = Math.max(1, series.previewFrames)
  const previewFraction = frameCount > 1
    ? 0.12 + (frame / (frameCount - 1)) * 0.76
    : 0.5
  const previewSlice = Math.round(previewFraction * Math.max(0, series.sliceCount - 1))

  const scrubToPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = Math.max(0, Math.min(0.999999, (event.clientX - bounds.left) / bounds.width))
    setFrame(Math.floor(position * frameCount))
  }

  return (
    <div
      className="series-preview"
      data-preview-frame={frame}
      data-preview-slice={previewSlice}
      onPointerEnter={(event) => {
        setHovered(true)
        scrubToPointer(event)
      }}
      onPointerMove={scrubToPointer}
      onPointerLeave={() => {
        setHovered(false)
        setFrame(0)
      }}
    >
      <span
        className="series-preview-image"
        role="img"
        aria-label={`${series.description} slice preview`}
        style={{
          backgroundImage: `url("${bundledAssetUrl(series.preview)}")`,
          backgroundSize: `${frameCount * 100}% 100%`,
          backgroundPosition: `${frameCount > 1 ? (frame / (frameCount - 1)) * 100 : 50}% center`,
        }}
      />
      <span className="preview-plane">{series.orientation}</span>
      <span className="preview-hover">
        <ScanLine size={13} /> {hovered ? `Slice ${previewSlice + 1}/${series.sliceCount}` : 'Hover to scrub'}
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
