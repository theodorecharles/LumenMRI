import { Check, ChevronRight, Columns2, FolderOpen, Layers3, Plus } from 'lucide-react'
import type { SeriesSummary } from '../types'
import { formatBytes } from '../lib/volume'

interface SeriesPanelProps {
  series: SeriesSummary[]
  activeId: string | null
  compareId?: string | null
  busy: boolean
  onSelect: (series: SeriesSummary) => void
  onSetCompare?: (series: SeriesSummary) => void
  onOpen: () => void
}

export function SeriesPanel({
  series,
  activeId,
  compareId = null,
  busy,
  onSelect,
  onSetCompare,
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

      {series.length ? (
        <div className="series-list">
          {series.map((item, index) => {
            const active = item.id === activeId
            const isCompare = item.id === compareId
            return (
              <div
                className={[
                  'series-card-row',
                  active ? 'is-active' : '',
                  isCompare ? 'is-compare' : '',
                ].filter(Boolean).join(' ')}
                key={item.id}
              >
                <button
                  className={active ? 'series-card active' : 'series-card'}
                  type="button"
                  disabled={busy || !item.supported}
                  title={onSetCompare ? 'Open as A · Alt-click set as B' : undefined}
                  onClick={(event) => {
                    if (event.altKey && onSetCompare && !active && item.supported) {
                      event.preventDefault()
                      onSetCompare(item)
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
                      {active ? <em className="series-role-tag" aria-label="Pane A">A</em> : null}
                      {isCompare ? <em className="series-role-tag compare" aria-label="Pane B">B</em> : null}
                    </b>
                    <small>
                      {item.bundled ? 'Included' : item.orientation} · {item.sliceCount} layers
                    </small>
                    <i>
                      {item.columns}×{item.rows} · {formatBytes(item.estimatedMegabytes)} GPU
                    </i>
                  </span>
                  {active ? <Check size={16} /> : <ChevronRight size={16} />}
                </button>
                {onSetCompare && item.supported && !active ? (
                  <button
                    className={isCompare ? 'series-set-b active' : 'series-set-b'}
                    type="button"
                    disabled={busy}
                    title={isCompare ? 'Compare pane B' : 'Set as compare pane B (Alt-click)'}
                    aria-label={isCompare ? `${item.description} is pane B` : `Set ${item.description} as pane B`}
                    aria-pressed={isCompare}
                    onClick={() => onSetCompare(item)}
                  >
                    <Columns2 size={13} />
                    <span>B</span>
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
          <p>
            image layers available locally
            {onSetCompare ? <small className="series-compare-hint">Alt-click or B to pair for Compare</small> : null}
          </p>
        </div>
      ) : null}
    </aside>
  )
}
