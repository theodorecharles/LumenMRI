import { Check, ChevronRight, FolderOpen, Layers3, Plus } from 'lucide-react'
import type { SeriesSummary } from '../types'
import { formatBytes } from '../lib/volume'

interface SeriesPanelProps {
  series: SeriesSummary[]
  activeId: string | null
  busy: boolean
  onSelect: (series: SeriesSummary) => void
  onOpen: () => void
}

export function SeriesPanel({ series, activeId, busy, onSelect, onOpen }: SeriesPanelProps) {
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

      {series.length ? (
        <div className="series-list">
          {series.map((item, index) => {
            const active = item.id === activeId
            return (
              <button
                className={active ? 'series-card active' : 'series-card'}
                key={item.id}
                type="button"
                disabled={busy || !item.supported}
                onClick={() => onSelect(item)}
              >
                <span className="series-index">
                  {item.bundled ? 'EX' : String(index + 1).padStart(2, '0')}
                </span>
                <span className="series-copy">
                  <b>{item.description}</b>
                  <small>
                    {item.bundled ? 'Included' : item.orientation} · {item.sliceCount} layers
                  </small>
                  <i>
                    {item.columns}×{item.rows} · {formatBytes(item.estimatedMegabytes)} GPU
                  </i>
                </span>
                {active ? <Check size={16} /> : <ChevronRight size={16} />}
              </button>
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
