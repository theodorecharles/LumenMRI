import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ControlPanel } from './ControlPanel'
import type { CropBounds, VolumeSettings } from '../types'

const volumeSettings: VolumeSettings = {
  threshold: 0.1,
  opacity: 0.44,
  window: 0.82,
  level: 0.46,
  detail: 0.62,
  shading: 0.72,
  lightAzimuth: -35,
  lightElevation: 30,
  sharpness: 0.34,
  palette: 'cyan',
  customPalette: ['#10152e', '#b329ff', '#fff06a'],
}

const cropBounds: CropBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ControlPanel>> = {},
) {
  return render(
    <ControlPanel
      volumeSettings={volumeSettings}
      setVolumeSettings={() => {}}
      projection="perspective"
      onProjectionChange={() => {}}
      reconstructionEnabled={false}
      reconstructionReady={false}
      reconstructionStatus="idle"
      reconstructionMessage="Waiting for volume"
      onReconstructionEnabledChange={() => {}}
      cropBounds={cropBounds}
      onCropChange={() => {}}
      onSetView={() => {}}
      onRotate={() => {}}
      {...overrides}
    />,
  )
}

// vitest globals are off in this project, so testing-library auto-cleanup is not wired.
afterEach(cleanup)

describe('ControlPanel 3D reconstruction', () => {
  it('reports Waiting and disables Enhanced when no reconstruction is available', () => {
    renderPanel()
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enhanced' })).toBeDisabled()
  })

  it('reports Ready and enables Enhanced once the reconstruction matches the volume', () => {
    renderPanel({ reconstructionReady: true, reconstructionStatus: 'ready' })
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enhanced' })).toBeEnabled()
  })
})
