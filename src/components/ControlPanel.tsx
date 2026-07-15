import { Layers3, SlidersHorizontal, Sparkles } from 'lucide-react'
import type { CropBounds, PaletteName, VolumeSettings } from '../types'
import { PALETTES } from '../lib/volume'
import { RangeControl } from './RangeControl'
import type { CameraProjection, CameraView } from './ViewerStage'

interface ControlPanelProps {
  volumeSettings: VolumeSettings
  setVolumeSettings: (settings: VolumeSettings) => void
  projection: CameraProjection
  onProjectionChange: (projection: CameraProjection) => void
  reconstructionEnabled: boolean
  reconstructionReady: boolean
  onReconstructionEnabledChange: (enabled: boolean) => void
  cropBounds: CropBounds
  onCropChange: (bounds: CropBounds) => void
  onSetView: (view: CameraView) => void
  onRotate: (axis: 'x' | 'y' | 'z') => void
}

const volumePresets: Array<{ name: string; settings: Partial<VolumeSettings> }> = [
  { name: 'Soft tissue', settings: { threshold: 0.12, opacity: 0.56, window: 0.82, level: 0.46 } },
  { name: 'Structure', settings: { threshold: 0.32, opacity: 0.76, window: 0.66, level: 0.56 } },
  { name: 'Transparent', settings: { threshold: 0.08, opacity: 0.26, window: 0.92, level: 0.43 } },
]

const lightPresets: Array<{ name: string; settings: Partial<VolumeSettings> }> = [
  { name: 'Front', settings: { shading: 0.7, lightAzimuth: 0, lightElevation: 25 } },
  { name: 'Side', settings: { shading: 0.82, lightAzimuth: 90, lightElevation: 15 } },
  { name: 'Rim', settings: { shading: 0.9, lightAzimuth: 155, lightElevation: 38 } },
]

function PalettePicker({
  value,
  customColors,
  onChange,
  onCustomColorChange,
}: {
  value: PaletteName
  customColors: [string, string, string]
  onChange: (name: PaletteName) => void
  onCustomColorChange: (index: number, color: string) => void
}) {
  return (
    <>
      <div className="palette-row" role="radiogroup" aria-label="Color palette">
        {(Object.keys(PALETTES) as PaletteName[]).map((name) => {
          const colors = name === 'custom' ? customColors : PALETTES[name]
          return (
            <button
              className={value === name ? 'palette active' : 'palette'}
              key={name}
              type="button"
              role="radio"
              aria-checked={value === name}
              onClick={() => onChange(name)}
            >
              <i style={{ background: `linear-gradient(135deg, ${colors.join(',')})` }} />
              <span>{name}</span>
            </button>
          )
        })}
      </div>
      {value === 'custom' ? (
        <div className="custom-palette" aria-label="Custom color stops">
          {(['Shadows', 'Midtones', 'Highlights'] as const).map((label, index) => (
            <label key={label}>
              <span>{label}</span>
              <input
                type="color"
                value={customColors[index]}
                aria-label={`${label} color`}
                onChange={(event) => onCustomColorChange(index, event.target.value)}
              />
            </label>
          ))}
        </div>
      ) : null}
    </>
  )
}

export function ControlPanel({
  volumeSettings,
  setVolumeSettings,
  projection,
  onProjectionChange,
  reconstructionEnabled,
  reconstructionReady,
  onReconstructionEnabledChange,
  cropBounds,
  onCropChange,
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
          <Layers3 size={14} />
          <span>3D reconstruction</span>
          <small>{reconstructionReady ? 'Ready' : 'Processing'}</small>
        </div>
        <div className="mode-grid" role="group" aria-label="3D reconstruction mode">
          <button
            className={!reconstructionEnabled ? 'active' : ''}
            type="button"
            aria-pressed={!reconstructionEnabled}
            onClick={() => onReconstructionEnabledChange(false)}
          >
            Acquired
          </button>
          <button
            className={reconstructionEnabled ? 'active' : ''}
            type="button"
            aria-pressed={reconstructionEnabled}
            disabled={!reconstructionReady}
            onClick={() => onReconstructionEnabledChange(true)}
          >
            Enhanced
          </button>
        </div>
      </section>

      <section className="control-section">
        <div className="section-label">
          <span>Camera orientation</span>
        </div>
        <div className="projection-grid" role="group" aria-label="Camera projection">
          <button
            className={projection === 'perspective' ? 'active' : ''}
            type="button"
            aria-pressed={projection === 'perspective'}
            onClick={() => onProjectionChange('perspective')}
          >
            Perspective
          </button>
          <button
            className={projection === 'isometric' ? 'active' : ''}
            type="button"
            aria-pressed={projection === 'isometric'}
            onClick={() => onProjectionChange('isometric')}
          >
            Isometric
          </button>
        </div>
        <div className="orientation-grid">
          <button type="button" onClick={() => onSetView('perspective')}>3D</button>
          <button type="button" onClick={() => onSetView('slices')}>Slices</button>
          <button type="button" aria-label="Side view" onClick={() => onSetView('side')}>Side</button>
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
        <RangeControl
          label="3D sharpening"
          value={volumeSettings.sharpness}
          displayValue={`${Math.round(volumeSettings.sharpness * 100)}%`}
          onChange={(sharpness) => updateVolume({ sharpness })}
        />
      </section>

      <section className="control-section slider-stack">
        <div className="section-label">
          <Sparkles size={14} />
          <span>Directional lighting</span>
          <small>Live volume normals</small>
        </div>
        <div className="preset-grid lighting-presets" role="group" aria-label="Lighting presets">
          {lightPresets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              aria-label={`${preset.name} lighting`}
              onClick={() => updateVolume(preset.settings)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <RangeControl
          label="Light intensity"
          value={volumeSettings.shading}
          displayValue={`${Math.round(volumeSettings.shading * 100)}%`}
          onChange={(shading) => updateVolume({ shading })}
        />
        <RangeControl
          label="Light azimuth"
          value={volumeSettings.lightAzimuth}
          min={-180}
          max={180}
          step={1}
          displayValue={`${Math.round(volumeSettings.lightAzimuth)}°`}
          onChange={(lightAzimuth) => updateVolume({ lightAzimuth })}
        />
        <RangeControl
          label="Light elevation"
          value={volumeSettings.lightElevation}
          min={-80}
          max={80}
          step={1}
          displayValue={`${Math.round(volumeSettings.lightElevation)}°`}
          onChange={(lightElevation) => updateVolume({ lightElevation })}
        />
      </section>

      <section className="control-section">
        <div className="section-label">
          <span>Color mapping</span>
        </div>
        <PalettePicker
          value={volumeSettings.palette}
          customColors={volumeSettings.customPalette}
          onChange={(palette) => updateVolume({ palette })}
          onCustomColorChange={(index, color) => {
            const customPalette = [...volumeSettings.customPalette] as [string, string, string]
            customPalette[index] = color
            updateVolume({ palette: 'custom', customPalette })
          }}
        />
      </section>

      <section className="control-section slider-stack clip-control">
        <div className="section-label">
          <span>Crop depth</span>
          <small>Synced with 3D box</small>
        </div>
        <RangeControl
          label="Depth start"
          value={cropBounds.minZ}
          max={Math.max(0, cropBounds.maxZ - 0.035)}
          displayValue={`${Math.round(cropBounds.minZ * 100)}%`}
          onChange={(minZ) => onCropChange({ ...cropBounds, minZ })}
        />
        <RangeControl
          label="Depth end"
          value={cropBounds.maxZ}
          min={Math.min(1, cropBounds.minZ + 0.035)}
          displayValue={`${Math.round(cropBounds.maxZ * 100)}%`}
          onChange={(maxZ) => onCropChange({ ...cropBounds, maxZ })}
        />
      </section>

      <div className="medical-note">
        <span>VIS</span>
        <p>Visualization workspace only. Not intended for diagnosis.</p>
      </div>
    </aside>
  )
}
