import { describe, expect, it } from 'vitest'
import type { AnatomicalPlane, VolumeData } from '../types'
import {
  anatomicalPlaneFromOrientation,
  resliceVolume,
  rulerLengthMillimeters,
  sourceAxesForPlane,
  sourceAxisFlipsForPlane,
  sourcePointToPlane,
} from './mpr'

function makeVolume(orientation: string): VolumeData {
  const dimensions: [number, number, number] = [2, 3, 4]
  const data = new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2])
  for (let z = 0; z < dimensions[2]; z += 1) {
    for (let y = 0; y < dimensions[1]; y += 1) {
      for (let x = 0; x < dimensions[0]; x += 1) {
        data[x + y * dimensions[0] + z * dimensions[0] * dimensions[1]] =
          x + y * 10 + z * 40
      }
    }
  }
  return {
    seriesId: 'mpr-test',
    description: 'MPR test',
    data,
    dimensions,
    spacing: [0.5, 1.5, 4],
    physicalSize: [1, 4.5, 16],
    scalarRange: [0, 255],
    fullScalarRange: [0, 255],
    orientation,
    sliceCount: dimensions[2],
  }
}

/** Voxel intensity at an x/y/slice triple of any (source or reformatted) volume. */
function voxelAt(volume: VolumeData, x: number, y: number, slice: number) {
  const [width, height] = volume.dimensions
  return volume.data[x + y * width + slice * width * height]
}

/** Image-space fraction triple addressing one source voxel, as the 3D pick emits. */
function voxelFractions(volume: VolumeData, x: number, y: number, z: number) {
  const [width, height, depth] = volume.dimensions
  return [x / (width - 1), y / (height - 1), z / (depth - 1)] as [number, number, number]
}

describe('orthogonal MPR', () => {
  it.each([
    ['Axial', 'axial'],
    ['coronal acquisition', 'coronal'],
    ['SAG', 'sagittal'],
    ['Unknown', 'axial'],
  ] as const)('normalizes %s orientation to %s', (orientation, expected) => {
    expect(anatomicalPlaneFromOrientation(orientation)).toBe(expected)
  })

  it.each([
    ['axial', 'coronal', [0, 2, 1]],
    ['axial', 'sagittal', [1, 2, 0]],
    ['coronal', 'axial', [0, 2, 1]],
    ['coronal', 'sagittal', [2, 1, 0]],
    ['sagittal', 'axial', [2, 0, 1]],
    ['sagittal', 'coronal', [2, 1, 0]],
  ] as [AnatomicalPlane, AnatomicalPlane, [number, number, number]][])(
    'maps %s source axes into %s',
    (acquired, target, expected) => {
      expect(sourceAxesForPlane(acquired, target)).toEqual(expected)
    },
  )

  it.each([
    ['axial', 'coronal', [false, true, false]],
    ['axial', 'sagittal', [false, true, false]],
    ['coronal', 'axial', [false, false, true]],
    ['sagittal', 'axial', [false, false, true]],
    ['coronal', 'sagittal', [false, false, false]],
    ['sagittal', 'coronal', [false, false, false]],
  ] as [AnatomicalPlane, AnatomicalPlane, [boolean, boolean, boolean]][])(
    'reverses the inverted %s → %s axes',
    (acquired, target, expected) => {
      expect(sourceAxisFlipsForPlane(acquired, target)).toEqual(expected)
    },
  )

  it('reindexes axial data into coronal slices with physical geometry intact', () => {
    const volume = makeVolume('Axial')
    const coronal = resliceVolume(volume, 'coronal')

    expect(coronal.dimensions).toEqual([2, 4, 3])
    expect(coronal.spacing).toEqual([0.5, 4, 1.5])
    expect(coronal.physicalSize).toEqual([1, 16, 4.5])
    expect(coronal.orientation).toBe('Coronal')
    expect(coronal.sliceCount).toBe(3)
    // Coronal output (x=1, y=source z 1, slice=source y 1) → 1 + 10 + 40.
    expect(voxelAt(coronal, 1, 2, 1)).toBe(51)
  })

  it('puts the superior end of an axial stack at the top of coronal rows', () => {
    const volume = makeVolume('Axial')
    const coronal = resliceVolume(volume, 'coronal')
    const [, , sourceDepth] = volume.dimensions
    const [, coronalHeight] = coronal.dimensions

    // Row 0 is the S marker, so it must read the most superior source slice.
    expect(voxelAt(coronal, 0, 0, 0)).toBe(voxelAt(volume, 0, 0, sourceDepth - 1))
    expect(voxelAt(coronal, 0, coronalHeight - 1, 0)).toBe(voxelAt(volume, 0, 0, 0))
    for (let slice = 0; slice < coronal.dimensions[2]; slice += 1) {
      for (let y = 0; y < coronalHeight; y += 1) {
        for (let x = 0; x < coronal.dimensions[0]; x += 1) {
          expect(voxelAt(coronal, x, y, slice))
            .toBe(voxelAt(volume, x, slice, sourceDepth - 1 - y))
        }
      }
    }
  })

  it('puts the superior end of an axial stack at the top of sagittal rows', () => {
    const volume = makeVolume('Axial')
    const sagittal = resliceVolume(volume, 'sagittal')
    const [, , sourceDepth] = volume.dimensions

    expect(sagittal.dimensions).toEqual([3, 4, 2])
    expect(voxelAt(sagittal, 0, 0, 0)).toBe(voxelAt(volume, 0, 0, sourceDepth - 1))
    for (let slice = 0; slice < sagittal.dimensions[2]; slice += 1) {
      for (let y = 0; y < sagittal.dimensions[1]; y += 1) {
        for (let x = 0; x < sagittal.dimensions[0]; x += 1) {
          expect(voxelAt(sagittal, x, y, slice))
            .toBe(voxelAt(volume, slice, x, sourceDepth - 1 - y))
        }
      }
    }
  })

  it('orders axial slices reformatted from a coronal stack inferior to superior', () => {
    const volume = makeVolume('Coronal')
    const axial = resliceVolume(volume, 'axial')
    const [, sourceHeight] = volume.dimensions

    expect(axial.dimensions).toEqual([2, 4, 3])
    // Coronal row 0 is superior, so it belongs to the last axial slice.
    expect(voxelAt(axial, 0, 0, 0)).toBe(voxelAt(volume, 0, sourceHeight - 1, 0))
    expect(voxelAt(axial, 0, 0, axial.dimensions[2] - 1)).toBe(voxelAt(volume, 0, 0, 0))
  })

  it('reindexes coronal data into sagittal slices', () => {
    const volume = makeVolume('Coronal')
    const sagittal = resliceVolume(volume, 'sagittal')

    expect(sagittal.dimensions).toEqual([4, 3, 2])
    expect(sagittal.spacing).toEqual([4, 1.5, 0.5])
    // Coronal and sagittal share row direction, so no axis reverses here.
    expect(voxelAt(sagittal, 2, 1, 1)).toBe(91)
  })

  it.each(['coronal', 'sagittal'] as const)(
    'restores the acquired voxel order when %s is reformatted back to axial',
    (intermediatePlane) => {
      const volume = makeVolume('Axial')
      const roundTrip = resliceVolume(resliceVolume(volume, intermediatePlane), 'axial')

      expect(roundTrip.dimensions).toEqual(volume.dimensions)
      expect(Array.from(roundTrip.data)).toEqual(Array.from(volume.data))
    },
  )

  it('returns the acquired plane without copying its voxel buffer', () => {
    const volume = makeVolume('Sagittal')
    expect(resliceVolume(volume, 'sagittal')).toBe(volume)
  })

  it('maps a 3D source point into the active plane', () => {
    // Axial +z is superior but coronal rows run downward to I, so y mirrors.
    const coronalPoint = sourcePointToPlane([0.2, 0.4, 0.8], 'axial', 'coronal')
    expect(coronalPoint.x).toBeCloseTo(0.2, 10)
    expect(coronalPoint.y).toBeCloseTo(0.2, 10)
    expect(coronalPoint.stackFraction).toBeCloseTo(0.4, 10)
    expect(sourcePointToPlane([0.2, 0.4, 0.8], 'coronal', 'sagittal')).toEqual({
      x: 0.8,
      y: 0.4,
      stackFraction: 0.2,
    })
  })

  it.each(['coronal', 'sagittal'] as const)(
    'lands the 3D pick on the same voxel the %s reformat shows',
    (targetPlane) => {
      const volume = makeVolume('Axial')
      const reformatted = resliceVolume(volume, targetPlane)
      const point = sourcePointToPlane(voxelFractions(volume, 1, 2, 3), 'axial', targetPlane)
      const [width, height, depth] = reformatted.dimensions
      const picked = voxelAt(
        reformatted,
        Math.round(point.x * (width - 1)),
        Math.round(point.y * (height - 1)),
        Math.round(point.stackFraction * (depth - 1)),
      )

      expect(picked).toBe(voxelAt(volume, 1, 2, 3))
    },
  )

  it('chooses stable metric ruler intervals', () => {
    expect(rulerLengthMillimeters(240)).toBe(50)
    expect(rulerLengthMillimeters(416)).toBe(100)
    expect(rulerLengthMillimeters(32)).toBe(5)
  })
})
