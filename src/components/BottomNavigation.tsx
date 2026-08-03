import { CircleHelp, FolderOpen, LayoutGrid } from 'lucide-react'
import type { Screen } from '../hooks/useViewerSession'

interface BottomNavigationProps {
  screen: Screen
  detail: string
  status: string
  statusIsError: boolean
  onLibrary: () => void
  onOpen: () => void
  onShortcuts: () => void
}

/**
 * Primary shell navigation. It must remain a direct child of `.app-shell`, after
 * `.app-main`, so it never inherits scrolling or route-level visual effects.
 */
export function BottomNavigation({
  screen,
  detail,
  status,
  statusIsError,
  onLibrary,
  onOpen,
  onShortcuts,
}: BottomNavigationProps) {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <div className="bottom-nav-actions">
        <button
          className={screen === 'library' ? 'active' : ''}
          type="button"
          aria-current={screen === 'library' ? 'page' : undefined}
          onClick={onLibrary}
        >
          <LayoutGrid size={14} /> Library
        </button>
        <button type="button" onClick={onOpen}>
          <FolderOpen size={14} /> Open scan
        </button>
        <button type="button" onClick={onShortcuts}>
          <CircleHelp size={14} /> Shortcuts
        </button>
      </div>

      <span className="bottom-nav-detail">{detail}</span>
      <span className={statusIsError ? 'bottom-nav-ready is-error' : 'bottom-nav-ready'}>
        <i />
        {status}
      </span>
    </nav>
  )
}
