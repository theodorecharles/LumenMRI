import { Layers3, SlidersHorizontal, Sparkles } from 'lucide-react'
import type { PaletteName, VolumeSettings } from '../types'
import { PALETTES } from '../lib/volume'
import { RangeControl } from './RangeControl'

interface ControlPanelProps {
  volumeSettings: VolumeSettings
  setVolumeSettings: (settings: VolumeSettings) => void
  onSetView: (view: 'perspective' | 'slices' | 'side' | 'top') => void
  onRotate: (axis: 'x' | 'y' | 'z') => void
}

const volumePresets: Array<{ name: string; settings: Partial<VolumeSettings> }> = [
  { name: 'Soft tissue', settings: { threshold: 0.12, opacity: 0.56, window: 0.82, level: 0.46 } },
  { name: 'Structure', settings: { threshold: 0.32, opacity: 0.76, window: 0.66, level: 0.56 } },
  { name: 'Transparent', settings: { threshold: 0.08, opacity: 0.26, window: 0.92, level: 0.43 } },
]

function PalettePicker({ value, onChange }: { value: PaletteName; onChange: (name: PaletteName) => void }) {
  return (
    <div className="palette-row" role="radiogroup" aria-label="Color palette">
      {(Object.keys(PALETTES) as PaletteName[]).map((name) => (
        <button
          className={value === name ? 'palette active' : 'palette'}
          key={name}
          type="button"
          role="radio"
          aria-checked={value === name}
          onClick={() => onChange(name)}
        >
          <i style={{ background: `linear-gradient(135deg, ${PALETTES[name].join(',')})` }} />
          <span>{name}</span>
        </button>
      ))}
    </div>
  )
}

export function ControlPanel({
  volumeSettings,
  setVolumeSettings,
  onSetView,
  onRotate,
}: ControlPanelProps) {
  const updateVolume = (patch: Partial<VolumeSettings>) =>
    setVolumeSettings({ ...volumeSettings, ...patch })

  return (
    <aside className="control-panel" aria-label="Rendering controls">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Rendering</span>
          <h2>Volume controls</h2>
        </div>
        <SlidersHorizontal size={18} />
      </div>

      <section className="control-section">
        <div className="section-label">
          <Layers3 size={14} />
          <span>Look preset</span>
        </div>
        <div className="preset-grid">
          {volumePresets.map((preset) => (
            <button key={preset.name} type="button" onClick={() => updateVolume(preset.settings)}>
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      <section className="control-section">
        <div className="section-label">
          <span>Camera orientation</span>
        </div>
        <div className="orientation-grid">
          <button type="button" onClick={() => onSetView('perspective')}>3D</button>
          <button type="button" onClick={() => onSetView('slices')}>Slices</button>
          <button type="button" onClick={() => onSetView('side')}>Side</button>
          <button type="button" onClick={() => onSetView('top')}>Top</button>
        </div>
        <div className="section-label rotate-label">
          <span>Rotate dataset 90°</span>
          <small>Correct sideways scans</small>
        </div>
        <div className="rotation-grid">
          <button type="button" onClick={() => onRotate('x')}>X axis</button>
          <button type="button" onClick={() => onRotate('y')}>Y axis</button>
          <button type="button" onClick={() => onRotate('z')}>Z axis</button>
        </div>
      </section>

      <section className="control-section slider-stack">
        <div className="section-label">
          <Sparkles size={14} />
          <span>Transfer function</span>
        </div>
        <RangeControl
          label="Signal threshold"
          value={volumeSettings.threshold}
          onChange={(threshold) => updateVolume({ threshold })}
        />
        <RangeControl
          label="Volume opacity"
          value={volumeSettings.opacity}
          onChange={(opacity) => updateVolume({ opacity })}
        />
        <RangeControl
          label="Window"
          value={volumeSettings.window}
          min={0.1}
          onChange={(window) => updateVolume({ window })}
        />
        <RangeControl
          label="Level"
          value={volumeSettings.level}
          onChange={(level) => updateVolume({ level })}
        />
        <RangeControl
          label="Ray detail"
          value={volumeSettings.detail}
          displayValue={`${Math.round(112 + volumeSettings.detail * 320)}×`}
          onChange={(detail) => updateVolume({ detail })}
        />
      </section>

      <section className="control-section">
        <div className="section-label">
          <span>Color mapping</span>
        </div>
        <PalettePicker
          value={volumeSettings.palette}
          onChange={(palette) => updateVolume({ palette })}
        />
      </section>

      <section className="control-section slider-stack clip-control">
        <div className="section-label">
          <span>Section depth</span>
          <small>Reveal internal anatomy</small>
        </div>
        <RangeControl
          label="Visible depth"
          value={volumeSettings.clip}
          displayValue={`${Math.round(volumeSettings.clip * 100)}%`}
          onChange={(clip) => updateVolume({ clip })}
        />
      </section>

      <div className="medical-note">
        <span>VIS</span>
        <p>Visualization workspace only. Not intended for diagnosis.</p>
      </div>
    </aside>
  )
}
