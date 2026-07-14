import { Box, FolderOpen, Layers3, LockKeyhole, ScanLine, Sparkles } from 'lucide-react'
import type { ScanProgress } from '../types'

interface EmptyStageProps {
  progress: ScanProgress
  error: string | null
  isDragging: boolean
  onOpen: () => void
  onDemo: () => void
}

export function EmptyStage({ progress, error, isDragging, onOpen, onDemo }: EmptyStageProps) {
  const busy = progress.phase === 'scanning' || progress.phase === 'loading'

  return (
    <div className={isDragging ? 'empty-stage dragging' : 'empty-stage'}>
      <div className="ambient-orbit" aria-hidden="true">
        <i />
        <i />
        <i />
        <span />
      </div>

      <div className="empty-content">
        <div className="empty-kicker">
          <Sparkles size={14} /> GPU-native medical visualization
        </div>
        <h1>
          See every layer.
          <br />
          <em>Then see through them.</em>
        </h1>
        <p>
          Turn a local DICOM series into an explorable transparent volume, a standard 2D
          slice stack, or a linked split view—without uploading a single byte.
        </p>

        {error ? <div className="inline-error">{error}</div> : null}

        {busy ? (
          <div className="load-card" role="status" aria-live="polite">
            <div className="load-ring">
              <span>{Math.round(progress.progress * 100)}</span>%
            </div>
            <div>
              <b>{progress.phase === 'scanning' ? 'Indexing scan' : 'Building volume'}</b>
              <p>{progress.label}</p>
              <div className="progress-track">
                <i style={{ width: `${progress.progress * 100}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-actions">
            <button className="primary-button" type="button" onClick={onOpen}>
              <FolderOpen size={18} /> Open scan folder
            </button>
            <button className="secondary-button" type="button" onClick={onDemo}>
              Explore demo volume
            </button>
          </div>
        )}

        <div className="feature-strip">
          <span>
            <Layers3 size={17} />
            <b>Volume</b>
            Transparent layers
          </span>
          <span>
            <ScanLine size={17} />
            <b>2D + 3D</b>
            Linked slice inspection
          </span>
          <span>
            <LockKeyhole size={17} />
            <b>Local only</b>
            Zero uploads
          </span>
        </div>
      </div>

      <div className="drop-hint">
        <Box size={16} /> {isDragging ? 'Drop the scan folder here' : 'You can also drag a DICOM folder anywhere'}
      </div>
    </div>
  )
}
