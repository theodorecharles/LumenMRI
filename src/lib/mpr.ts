import type { AnatomicalPlane, Vec3Tuple, VolumeData } from '../types'

/**
 * Anatomical axis order for each diagnostic plane:
 * left/right, anterior/posterior, and inferior/superior are axes 0, 1, and 2.
 */
const PLANE_AXES: Record<AnatomicalPlane, Vec3Tuple> = {
  axial: [0, 1, 2],
  coronal: [0, 2, 1],
  sagittal: [1, 2, 0],
}

const PLANE_LABELS: Record<AnatomicalPlane, string> = {
  axial: 'Axial',
  coronal: 'Coronal',
  sagittal: 'Sagittal',
}

export interface PlanePoint {
  x: number
  y: number
  stackFraction: number
}

export function anatomicalPlaneFromOrientation(orientation: string): AnatomicalPlane {
  const normalized = orientation.toLowerCase()
  if (normalized.includes('cor')) return 'coronal'
  if (normalized.includes('sag')) return 'sagittal'
  return 'axial'
}

/**
 * Return source-volume axes for target plane x, y, and through-plane depth.
 * The loader already exposes acquired pixels in diagnostic display order, so
 * orthogonal MPR only needs an exact axis permutation (no interpolation).
 */
export function sourceAxesForPlane(
  acquiredPlane: AnatomicalPlane,
  targetPlane: AnatomicalPlane,
): Vec3Tuple {
  const sourceAnatomicalAxes = PLANE_AXES[acquiredPlane]
  return PLANE_AXES[targetPlane].map(
    (anatomicalAxis) => sourceAnatomicalAxes.indexOf(anatomicalAxis),
  ) as Vec3Tuple
}

/**
 * Map source image-space fractions into x/y/stack fractions for an MPR plane.
 * Used by Alt+click 3D→2D linking without allocating another volume.
 */
export function sourcePointToPlane(
  sourcePoint: Vec3Tuple,
  acquiredPlane: AnatomicalPlane,
  targetPlane: AnatomicalPlane,
): PlanePoint {
  const axes = sourceAxesForPlane(acquiredPlane, targetPlane)
  return {
    x: sourcePoint[axes[0]],
    y: sourcePoint[axes[1]],
    stackFraction: sourcePoint[axes[2]],
  }
}

/**
 * Reindex an acquired orthogonal volume into one active diagnostic plane.
 * Intensities are copied exactly; dimensions, spacing, and physical size follow
 * the same axis permutation so all existing 2D tools remain physically correct.
 */
export function resliceVolume(
  volume: VolumeData,
  targetPlane: AnatomicalPlane,
): VolumeData {
  const acquiredPlane = anatomicalPlaneFromOrientation(volume.orientation)
  if (targetPlane === acquiredPlane) return volume

  const axes = sourceAxesForPlane(acquiredPlane, targetPlane)
  const outputDimensions = axes.map((axis) => volume.dimensions[axis]) as Vec3Tuple
  const outputSpacing = axes.map((axis) => volume.spacing[axis]) as Vec3Tuple
  const outputPhysicalSize = axes.map((axis) => volume.physicalSize[axis]) as Vec3Tuple
  const [sourceWidth, sourceHeight] = volume.dimensions
  const [outputWidth, outputHeight, outputDepth] = outputDimensions
  const output = new Uint8Array(volume.data.length)
  const sourceCoordinates: Vec3Tuple = [0, 0, 0]

  let outputIndex = 0
  for (let z = 0; z < outputDepth; z += 1) {
    sourceCoordinates[axes[2]] = z
    for (let y = 0; y < outputHeight; y += 1) {
      sourceCoordinates[axes[1]] = y
      for (let x = 0; x < outputWidth; x += 1) {
        sourceCoordinates[axes[0]] = x
        const sourceIndex =
          sourceCoordinates[0]
          + sourceCoordinates[1] * sourceWidth
          + sourceCoordinates[2] * sourceWidth * sourceHeight
        output[outputIndex] = volume.data[sourceIndex] ?? 0
        outputIndex += 1
      }
    }
  }

  return {
    ...volume,
    seriesId: `${volume.seriesId}::mpr-${targetPlane}`,
    data: output,
    dimensions: outputDimensions,
    spacing: outputSpacing,
    physicalSize: outputPhysicalSize,
    orientation: PLANE_LABELS[targetPlane],
    sliceCount: outputDepth,
  }
}

/** Largest 1/2/5 × 10ⁿ ruler that fits in roughly 30% of an image axis. */
export function rulerLengthMillimeters(axisSpanMillimeters: number): number {
  if (!Number.isFinite(axisSpanMillimeters) || axisSpanMillimeters <= 0) return 1
  const target = axisSpanMillimeters * 0.3
  const power = 10 ** Math.floor(Math.log10(target))
  const normalized = target / power
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1
  return step * power
}
