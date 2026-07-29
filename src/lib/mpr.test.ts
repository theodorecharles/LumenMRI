import { describe, expect, it } from 'vitest'
import type { AnatomicalPlane, VolumeData } from '../types'
import {
  anatomicalPlaneFromOrientation,
  resliceVolume,
  rulerLengthMillimeters,
  sourceAxesForPlane,
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

  it('reindexes axial data into coronal slices with physical geometry intact', () => {
    const volume = makeVolume('Axial')
    const coronal = resliceVolume(volume, 'coronal')

    expect(coronal.dimensions).toEqual([2, 4, 3])
    expect(coronal.spacing).toEqual([0.5, 4, 1.5])
    expect(coronal.physicalSize).toEqual([1, 16, 4.5])
    expect(coronal.orientation).toBe('Coronal')
    expect(coronal.sliceCount).toBe(3)
    // Coronal output (x=1, y=source z 2, slice=source y 1) → 1 + 10 + 80.
    expect(coronal.data[1 + 2 * 2 + 1 * 2 * 4]).toBe(91)
  })

  it('reindexes coronal data into sagittal slices', () => {
    const volume = makeVolume('Coronal')
    const sagittal = resliceVolume(volume, 'sagittal')

    expect(sagittal.dimensions).toEqual([4, 3, 2])
    expect(sagittal.spacing).toEqual([4, 1.5, 0.5])
    // Sagittal output (x=source z 2, y=source y 1, slice=source x 1).
    expect(sagittal.data[2 + 1 * 4 + 1 * 4 * 3]).toBe(91)
  })

  it('returns the acquired plane without copying its voxel buffer', () => {
    const volume = makeVolume('Sagittal')
    expect(resliceVolume(volume, 'sagittal')).toBe(volume)
  })

  it('maps a 3D source point into the active plane', () => {
    expect(sourcePointToPlane([0.2, 0.4, 0.8], 'axial', 'coronal')).toEqual({
      x: 0.2,
      y: 0.8,
      stackFraction: 0.4,
    })
    expect(sourcePointToPlane([0.2, 0.4, 0.8], 'coronal', 'sagittal')).toEqual({
      x: 0.8,
      y: 0.4,
      stackFraction: 0.2,
    })
  })

  it('chooses stable metric ruler intervals', () => {
    expect(rulerLengthMillimeters(240)).toBe(50)
    expect(rulerLengthMillimeters(416)).toBe(100)
    expect(rulerLengthMillimeters(32)).toBe(5)
  })
})
