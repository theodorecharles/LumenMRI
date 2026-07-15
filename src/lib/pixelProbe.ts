import type { VolumeData } from '../types'

export interface PixelProbeSample {
  /** Column index (x), 0-based. */
  col: number
  /** Row index (y), 0-based. */
  row: number
  /** Stored normalized intensity in volume.data (0–255). */
  intensity: number
  /** Window/level display gray (0–255). */
  display: number
  /** Approximate original scalar from volume.scalarRange. */
  scalar: number
}

/**
 * Sample a single voxel under normalized canvas coordinates (0–1).
 * Returns null when the point is outside the slice or the volume is empty.
 */
export function samplePixelAt(
  volume: VolumeData,
  sliceIndex: number,
  normX: number,
  normY: number,
  window: number,
  level: number,
): PixelProbeSample | null {
  const [width, height, depth] = volume.dimensions
  if (width <= 0 || height <= 0 || depth <= 0) return null
  if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return null

  const slice = Math.max(0, Math.min(depth - 1, sliceIndex))
  const col = Math.max(0, Math.min(width - 1, Math.floor(normX * width)))
  const row = Math.max(0, Math.min(height - 1, Math.floor(normY * height)))
  const intensity = volume.data[slice * width * height + row * width + col] ?? 0

  const windowLow = (level - window * 0.5) * 255
  const windowWidth = Math.max(4, window * 255)
  const display = Math.max(
    0,
    Math.min(255, ((intensity - windowLow) / windowWidth) * 255),
  )

  const [scalarMin, scalarMax] = volume.scalarRange
  const scalar = scalarMin + (intensity / 255) * (scalarMax - scalarMin)

  return {
    col,
    row,
    intensity,
    display: Math.round(display),
    scalar,
  }
}

export function formatProbeScalar(scalar: number): string {
  if (!Number.isFinite(scalar)) return '—'
  const abs = Math.abs(scalar)
  if (abs >= 100) return scalar.toFixed(0)
  if (abs >= 10) return scalar.toFixed(1)
  return scalar.toFixed(2)
}
