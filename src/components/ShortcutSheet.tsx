import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

/** Outer list = alternatives (or); inner list = chord (+). */
export type ShortcutKeys = string[][]

export interface ShortcutEntry {
  keys: ShortcutKeys
  label: string
}

export interface ShortcutSection {
  title: string
  entries: ShortcutEntry[]
}

/** Single source of truth for the in-app sheet (mirrors README + 2D gestures). */
export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Layout',
    entries: [
      { keys: [['1']], label: '3D volume' },
      { keys: [['2']], label: '2D slice' },
      { keys: [['3']], label: 'Linked split view' },
      { keys: [['4']], label: 'Compare' },
    ],
  },
  {
    title: '2D navigation',
    entries: [
      { keys: [['↑'], [',']], label: 'Previous slice' },
      { keys: [['↓'], ['.']], label: 'Next slice' },
      { keys: [['Home'], ['End']], label: 'First / last slice (pauses cine)' },
      { keys: [['Space']], label: 'Toggle cine play (2D and split layouts)' },
      { keys: [['Scroll']], label: 'Step through slices' },
      { keys: [['Ctrl', 'Scroll']], label: 'Zoom 2D (⌘ on Mac)' },
      { keys: [['Drag']], label: 'Pan when zoomed' },
    ],
  },
  {
    title: 'Capture & workspace',
    entries: [
      { keys: [['S']], label: 'Save active view' },
      { keys: [['R']], label: 'Reset 3D camera' },
      { keys: [['F']], label: 'Toggle fullscreen' },
      { keys: [['L']], label: 'Scan library' },
      { keys: [['?']], label: 'Open or close this sheet' },
    ],
  },
  {
    title: 'Mouse modifiers',
    entries: [
      { keys: [['Shift', 'Drag']], label: 'Window / level (2D)' },
      { keys: [['RMB', 'Drag']], label: 'Window / level (2D)' },
      { keys: [['Drag']], label: 'Orbit 3D volume' },
      { keys: [['Scroll']], label: 'Zoom 3D volume' },
      {
        keys: [['Alt', 'Click']],
        label: 'Set linked 2D slice from volume pick (Slice plane on, or Split layout)',
      },
    ],
  },
]

function KeysDisplay({ keys }: { keys: ShortcutKeys }) {
  return (
    <span className="shortcut-keys">
      {keys.map((chord, chordIndex) => (
        <span key={`chord-${chordIndex}`} className="shortcut-chord">
          {chordIndex > 0 ? <span className="shortcut-key-sep">/</span> : null}
          {chord.map((key, keyIndex) => (
            <span key={`${key}-${keyIndex}`} className="shortcut-key-group">
              {keyIndex > 0 ? <span className="shortcut-key-plus">+</span> : null}
              <kbd>{key}</kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

interface ShortcutSheetProps {
  open: boolean
  onClose: () => void
}

export function ShortcutSheet({ open, onClose }: ShortcutSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="shortcut-sheet-backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="shortcut-sheet-backdrop"
    >
      <div
        className="shortcut-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-sheet-title"
        data-testid="shortcut-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shortcut-sheet-header">
          <div>
            <span className="eyebrow">Keyboard & mouse</span>
            <h2 id="shortcut-sheet-title">Shortcuts</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-button shortcut-sheet-close"
            type="button"
            aria-label="Close shortcuts"
            title="Close (Esc or ?)"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="shortcut-sheet-grid">
          {SHORTCUT_SECTIONS.map((section) => (
            <section key={section.title} className="shortcut-sheet-section">
              <h3>{section.title}</h3>
              <ul>
                {section.entries.map((entry) => (
                  <li key={`${section.title}-${entry.label}-${entry.keys.flat().join('-')}`}>
                    <KeysDisplay keys={entry.keys} />
                    <span className="shortcut-label">{entry.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="shortcut-sheet-footer">
          Press <kbd>?</kbd> or <kbd>Esc</kbd> to dismiss
        </p>
      </div>
    </div>
  )
}
