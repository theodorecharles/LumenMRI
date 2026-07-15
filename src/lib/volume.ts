import type { PaletteName, Vec3Tuple, VolumeData } from '../types'

export const PALETTES: Record<PaletteName, [string, string, string]> = {
  cyan: ['#071b28', '#20c8e9', '#e8fbff'],
  thermal: ['#19002f', '#ff3b0a', '#fff36a'],
  ember: ['#220812', '#ff6b3d', '#fff1c7'],
  bone: ['#0e1218', '#a9bdc7', '#ffffff'],
  custom: ['#10152e', '#b329ff', '#fff06a'],
}

export function normalizePhysicalSize(size: Vec3Tuple): Vec3Tuple {
  const largest = Math.max(...size, 1)
  return [size[0] / largest, size[1] / largest, size[2] / largest]
}

export function formatBytes(megabytes: number): string {
  if (megabytes < 1) return `${Math.max(1, Math.round(megabytes * 1024))} KB`
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`
}

/** Mid-stack index for a volume of the given through-plane depth. */
export function midSliceIndex(depth: number): number {
  if (depth <= 0) return 0
  return Math.floor((depth - 1) / 2)
}

/**
 * Map a slice index from one stack depth to another by relative through-plane
 * position. Used when hopping series so AX FLAIR → AX T1 keeps the same
 * fractional depth instead of always jumping to mid-stack.
 */
export function mapRelativeSliceIndex(
  previousIndex: number,
  previousDepth: number,
  nextDepth: number,
): number {
  if (nextDepth <= 0) return 0
  if (nextDepth === 1) return 0
  if (previousDepth <= 0) return midSliceIndex(nextDepth)
  if (previousDepth === 1) return midSliceIndex(nextDepth)

  const clampedPrev = Math.max(0, Math.min(previousDepth - 1, previousIndex))
  const fraction = clampedPrev / (previousDepth - 1)
  return Math.max(0, Math.min(nextDepth - 1, Math.round(fraction * (nextDepth - 1))))
}

export function createDemoVolume(size = 96): VolumeData {
  const width = size
  const height = Math.round(size * 1.06)
  const depth = Math.round(size * 0.82)
  const data = new Uint8Array(width * height * depth)

  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const nx = (x / (width - 1) - 0.5) * 2
        const ny = (y / (height - 1) - 0.5) * 2
        const nz = (z / (depth - 1) - 0.5) * 2
        const head = nx * nx / 0.76 + ny * ny / 0.96 + nz * nz / 0.72
        const brain = nx * nx / 0.56 + ny * ny / 0.72 + nz * nz / 0.54
        const ventricleLeft =
          ((nx - 0.13) ** 2) / 0.018 + ((ny + 0.02) ** 2) / 0.07 + (nz * nz) / 0.12
        const ventricleRight =
          ((nx + 0.13) ** 2) / 0.018 + ((ny + 0.02) ** 2) / 0.07 + (nz * nz) / 0.12
        const folds =
          Math.sin(x * 0.38 + Math.sin(z * 0.17) * 2) *
          Math.cos(y * 0.31 - z * 0.11)
        let value = 0

        if (head < 1) value = 32 + Math.max(0, 1 - head) * 18
        if (brain < 1) value = 90 + (1 - brain) * 80 + folds * 18
        if (ventricleLeft < 1 || ventricleRight < 1) value = 18

        const skullBand = Math.abs(head - 0.91)
        if (skullBand < 0.045) value = Math.max(value, 205 - skullBand * 900)

        data[x + y * width + z * width * height] = Math.max(
          0,
          Math.min(255, Math.round(value)),
        )
      }
    }
  }

  return {
    seriesId: 'demo-phantom',
    description: 'Synthetic MRI phantom',
    data,
    dimensions: [width, height, depth],
    spacing: [1, 1, 1.4],
    physicalSize: [width, height, depth * 1.4],
    scalarRange: [0, 255],
    fullScalarRange: [0, 255],
    orientation: 'Axial',
    sliceCount: depth,
  }
}
