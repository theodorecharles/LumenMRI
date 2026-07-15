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

/** Map local Z in a centered volume box (−sizeZ/2…+sizeZ/2) to a stack index. */
export function sliceIndexFromLocalZ(localZ: number, sizeZ: number, depth: number): number {
  if (depth <= 1 || sizeZ <= 0) return 0
  const fraction = Math.max(0, Math.min(1, localZ / sizeZ + 0.5))
  return Math.round(fraction * (depth - 1))
}

/**
 * Ray vs axis-aligned box centered at origin with full size (sizeX, sizeY, sizeZ).
 * Returns local Z of the chord midpoint (stable stack pick from oblique views).
 */
export function localZFromVolumeRay(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  size: [number, number, number],
): number | null {
  const half = [size[0] * 0.5, size[1] * 0.5, size[2] * 0.5] as const
  const o = [origin.x, origin.y, origin.z] as const
  const d = [direction.x, direction.y, direction.z] as const
  let tNear = -Infinity
  let tFar = Infinity
  for (let axis = 0; axis < 3; axis += 1) {
    const min = -half[axis]
    const max = half[axis]
    if (Math.abs(d[axis]) < 1e-8) {
      if (o[axis] < min || o[axis] > max) return null
      continue
    }
    let t1 = (min - o[axis]) / d[axis]
    let t2 = (max - o[axis]) / d[axis]
    if (t1 > t2) {
      const swap = t1
      t1 = t2
      t2 = swap
    }
    tNear = Math.max(tNear, t1)
    tFar = Math.min(tFar, t2)
    if (tNear > tFar) return null
  }
  if (tFar < 0) return null
  const t0 = Math.max(0, tNear)
  if (tFar < t0) return null
  const tMid = (t0 + tFar) * 0.5
  return o[2] + d[2] * tMid
}

export function formatBytes(megabytes: number): string {
  if (megabytes < 1) return `${Math.max(1, Math.round(megabytes * 1024))} KB`
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`
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
