import type { VolumeData } from '../types'

export interface RoiStats {
  /** Pixel count inside the rectangle (after clamp to slice). */
  count: number
  /** Physical area in mm². */
  area: number
  /** Mean stored intensity (0–255). */
  mean: number
  /** Minimum stored intensity. */
  min: number
  /** Maximum stored intensity. */
  max: number
  /** Population standard deviation of stored intensity. */
  sd: number
}

export interface RoiNormRect {
  start: { x: number; y: number }
  end: { x: number; y: number }
  slice: number
}

/**
 * Accumulate area, mean, min, max, and population SD over the rectangular ROI
 * in normalized (0–1) image coordinates — same pixel walk as the live overlay.
 */
export function computeRoiStats(
  volume: VolumeData,
  rect: RoiNormRect,
  width: number,
  height: number,
): RoiStats {
  const minPixelX = Math.max(
    0,
    Math.min(width - 1, Math.floor(Math.min(rect.start.x, rect.end.x) * width)),
  )
  const maxPixelX = Math.max(
    minPixelX,
    Math.min(width - 1, Math.ceil(Math.max(rect.start.x, rect.end.x) * width) - 1),
  )
  const minPixelY = Math.max(
    0,
    Math.min(height - 1, Math.floor(Math.min(rect.start.y, rect.end.y) * height)),
  )
  const maxPixelY = Math.max(
    minPixelY,
    Math.min(height - 1, Math.ceil(Math.max(rect.start.y, rect.end.y) * height) - 1),
  )

  let sum = 0
  let sumSq = 0
  let count = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  const sliceOffset = rect.slice * width * height

  for (let y = minPixelY; y <= maxPixelY; y += 1) {
    for (let x = minPixelX; x <= maxPixelX; x += 1) {
      const value = volume.data[sliceOffset + y * width + x] ?? 0
      sum += value
      sumSq += value * value
      if (value < min) min = value
      if (value > max) max = value
      count += 1
    }
  }

  if (count === 0) {
    return { count: 0, area: 0, mean: 0, min: 0, max: 0, sd: 0 }
  }

  const mean = sum / count
  // Population variance: E[x²] − μ² (guard float noise).
  const variance = Math.max(0, sumSq / count - mean * mean)
  const area = count * volume.spacing[0] * volume.spacing[1]

  return {
    count,
    area,
    mean,
    min,
    max,
    sd: Math.sqrt(variance),
  }
}

function formatArea(area: number): string {
  return area < 100 ? area.toFixed(1) : area.toFixed(0)
}

function formatIntensity(value: number): string {
  return value.toFixed(0)
}

function formatSd(sd: number): string {
  return sd < 10 ? sd.toFixed(1) : sd.toFixed(0)
}

/**
 * Compact ROI label: two lines when stats are present so the overlay stays readable.
 * Line 1: area · μ — Line 2: σ · min–max
 * Capture and live overlay share this string.
 */
export function formatRoiSummary(stats: RoiStats): string {
  const areaPart = `${formatArea(stats.area)} mm²`
  if (stats.count === 0) return areaPart
  const line1 = `${areaPart} · μ ${formatIntensity(stats.mean)}`
  const line2 = `σ ${formatSd(stats.sd)} · ${formatIntensity(stats.min)}–${formatIntensity(stats.max)}`
  return `${line1}\n${line2}`
}
