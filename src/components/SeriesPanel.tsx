import { Check, ChevronRight, FolderOpen, Layers3, Plus } from 'lucide-react'
import type { SeriesSummary } from '../types'
import { formatBytes } from '../lib/volume'

interface SeriesPanelProps {
  series: SeriesSummary[]
  activeId: string | null
  compareId?: string | null
  busy: boolean
  onSelect: (series: SeriesSummary) => void
  onSelectCompare?: (series: SeriesSummary) => void
  onOpen: () => void
}

export function SeriesPanel({
  series,
  activeId,
  compareId = null,
  busy,
  onSelect,
  onSelectCompare,
  onOpen,
}: SeriesPanelProps) {
  return (
    <aside className="series-panel" aria-label="MRI series">
      <div className="panel-heading series-heading">
        <div>
          <span className="eyebrow">Dataset</span>
          <h2>Scan series</h2>
        </div>
        <button className="icon-button" type="button" title="Open another scan" onClick={onOpen}>
          <Plus size={18} />
        </button>
      </div>

      {onSelectCompare ? (
        <p className="series-compare-hint">
          Click opens A · Alt-click or <b>B</b> sets compare series
        </p>
      ) : null}

      {series.length ? (
        <div className="series-list">
          {series.map((item, index) => {
            const isA = item.id === activeId
            const isB = item.id === compareId
            return (
              <div
                className={[
                  'series-card-row',
                  isA ? 'is-a' : '',
                  isB ? 'is-b' : '',
                ].filter(Boolean).join(' ')}
                key={item.id}
              >
                <button
                  className={isA || isB ? 'series-card active' : 'series-card'}
                  type="button"
                  disabled={busy || !item.supported}
                  title={
                    onSelectCompare
                      ? 'Open as primary (A). Alt-click to set as compare (B).'
                      : undefined
                  }
                  onClick={(event) => {
                    if (onSelectCompare && (event.altKey || event.metaKey)) {
                      event.preventDefault()
                      onSelectCompare(item)
                      return
                    }
                    onSelect(item)
                  }}
                >
                  <span className="series-index">
                    {item.bundled ? 'EX' : String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="series-copy">
                    <b>
                      {item.description}
                      {isA ? <span className="series-slot-badge slot-a">A</span> : null}
                      {isB ? <span className="series-slot-badge slot-b">B</span> : null}
                    </b>
                    <small>
                      {item.bundled ? 'Included' : item.orientation} · {item.sliceCount} layers
                    </small>
                    <i>
                      {item.columns}×{item.rows} · {formatBytes(item.estimatedMegabytes)} GPU
                    </i>
                  </span>
                  {isA && !isB ? <Check size={16} /> : <ChevronRight size={16} />}
                </button>
                {onSelectCompare ? (
                  <button
                    className={isB ? 'series-set-b active' : 'series-set-b'}
                    type="button"
                    disabled={busy || !item.supported || item.id === activeId}
                    title="Set as compare series (B)"
                    aria-label={`Set ${item.description} as compare series B`}
                    aria-pressed={isB}
                    onClick={() => onSelectCompare(item)}
                  >
                    B
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="series-empty">
          <Layers3 size={24} />
          <p>No dataset loaded</p>
          <button type="button" onClick={onOpen}>
            <FolderOpen size={15} /> Open folder
          </button>
        </div>
      )}

      {series.length ? (
        <div className="dataset-summary">
          <span>{series.reduce((total, item) => total + item.sliceCount, 0)}</span>
          <p>image layers available locally</p>
        </div>
      ) : null}
    </aside>
  )
}
