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

/**
 * Direction each plane's x, y, and through-plane axis advances along its
 * anatomical axis, where +1 means toward left, posterior, and superior.
 * Display convention: axial rows run A→P, coronal and sagittal rows run S→I,
 * and stacks run inferior→superior, anterior→posterior, right→left.
 */
const PLANE_AXIS_SIGNS: Record<AnatomicalPlane, Vec3Tuple> = {
  axial: [1, 1, 1],
  coronal: [1, -1, 1],
  sagittal: [1, -1, 1],
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
 * orthogonal MPR only needs an axis permutation plus the direction reversals
 * from `sourceAxisFlipsForPlane` (no interpolation).
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
 * Report which target-plane axes run opposite their source axis in patient
 * space. A permutation alone would leave an axial stack's superior end at the
 * bottom of a coronal or sagittal row, contradicting the S/I overlay labels, so
 * every axis whose anatomical direction the mapping inverts must be reversed.
 */
export function sourceAxisFlipsForPlane(
  acquiredPlane: AnatomicalPlane,
  targetPlane: AnatomicalPlane,
): [boolean, boolean, boolean] {
  const sourceAnatomicalAxes = PLANE_AXES[acquiredPlane]
  const sourceSigns = PLANE_AXIS_SIGNS[acquiredPlane]
  return PLANE_AXES[targetPlane].map((anatomicalAxis, targetAxis) => {
    const sourceAxis = sourceAnatomicalAxes.indexOf(anatomicalAxis)
    return sourceSigns[sourceAxis] !== PLANE_AXIS_SIGNS[targetPlane][targetAxis]
  }) as [boolean, boolean, boolean]
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
  const flips = sourceAxisFlipsForPlane(acquiredPlane, targetPlane)
  const fraction = (targetAxis: number) => {
    const value = sourcePoint[axes[targetAxis]]
    return flips[targetAxis] ? 1 - value : value
  }
  return {
    x: fraction(0),
    y: fraction(1),
    stackFraction: fraction(2),
  }
}

/**
 * Reindex an acquired orthogonal volume into one active diagnostic plane.
 * Intensities are copied exactly; dimensions, spacing, and physical size follow
 * the same axis permutation so all existing 2D tools remain physically correct.
 * Inverted axes are traversed in reverse so rows and slices advance in the
 * patient direction the plane's overlay labels claim.
 */
export function resliceVolume(
  volume: VolumeData,
  targetPlane: AnatomicalPlane,
): VolumeData {
  const acquiredPlane = anatomicalPlaneFromOrientation(volume.orientation)
  if (targetPlane === acquiredPlane) return volume

  const axes = sourceAxesForPlane(acquiredPlane, targetPlane)
  const flips = sourceAxisFlipsForPlane(acquiredPlane, targetPlane)
  const outputDimensions = axes.map((axis) => volume.dimensions[axis]) as Vec3Tuple
  const outputSpacing = axes.map((axis) => volume.spacing[axis]) as Vec3Tuple
  const outputPhysicalSize = axes.map((axis) => volume.physicalSize[axis]) as Vec3Tuple
  const [sourceWidth, sourceHeight] = volume.dimensions
  const [outputWidth, outputHeight, outputDepth] = outputDimensions
  const output = new Uint8Array(volume.data.length)
  const sourceCoordinates: Vec3Tuple = [0, 0, 0]
  // Reversed axes read from the far end so patient direction matches the overlay.
  const sourceIndexFor = (targetAxis: number, outputCoordinate: number) =>
    flips[targetAxis]
      ? outputDimensions[targetAxis] - 1 - outputCoordinate
      : outputCoordinate

  let outputIndex = 0
  for (let z = 0; z < outputDepth; z += 1) {
    sourceCoordinates[axes[2]] = sourceIndexFor(2, z)
    for (let y = 0; y < outputHeight; y += 1) {
      sourceCoordinates[axes[1]] = sourceIndexFor(1, y)
      for (let x = 0; x < outputWidth; x += 1) {
        sourceCoordinates[axes[0]] = sourceIndexFor(0, x)
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
