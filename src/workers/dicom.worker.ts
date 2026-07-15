/// <reference lib="webworker" />

import dicomParser, { type DataSet } from 'dicom-parser'
import OpenJPEGJS from '@cornerstonejs/codec-openjpeg'
import { Decoder } from 'jpeg-lossless-decoder-js'
import type {
  SeriesSummary,
  Vec3Tuple,
  VolumeData,
  WorkerRequest,
  WorkerResponse,
} from '../types'

const worker = self as DedicatedWorkerGlobalScope

const JPEG_LOSSLESS_SYNTAXES = new Set([
  '1.2.840.10008.1.2.4.57',
  '1.2.840.10008.1.2.4.70',
])

const JPEG_2000_SYNTAXES = new Set([
  '1.2.840.10008.1.2.4.90',
  '1.2.840.10008.1.2.4.91',
])

const UNCOMPRESSED_SYNTAXES = new Set([
  '1.2.840.10008.1.2',
  '1.2.840.10008.1.2.1',
  '1.2.840.10008.1.2.2',
])

interface SliceRecord {
  file: File
  seriesId: string
  description: string
  protocol: string
  modality: string
  rows: number
  columns: number
  pixelSpacing: [number, number]
  sliceThickness: number
  spacingBetweenSlices: number
  position: Vec3Tuple | null
  orientation: [number, number, number, number, number, number] | null
  sortPosition: number
  instanceNumber: number
  transferSyntax: string
  bitsAllocated: number
  bitsStored: number
  pixelRepresentation: number
  photometricInterpretation: string
  rescaleSlope: number
  rescaleIntercept: number
}

let recordsBySeries = new Map<string, SliceRecord[]>()
let openJPEGPromise: ReturnType<typeof OpenJPEGJS> | null = null
/** Monotonic token: scan/load-series/cancel/reset bump it so in-flight work can stop without posting stale results. */
let jobGeneration = 0
/** Promise chain that forces scan/load/cancel/reset to run one at a time. */
let jobQueue: Promise<void> = Promise.resolve()

class JobCancelled extends Error {
  constructor() {
    super('Job cancelled')
    this.name = 'JobCancelled'
  }
}

function assertJobActive(generation: number) {
  if (generation !== jobGeneration) throw new JobCancelled()
}

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  worker.postMessage(message, transfer)
}

function postIfActive(generation: number, message: WorkerResponse, transfer: Transferable[] = []) {
  assertJobActive(generation)
  post(message, transfer)
}

function cleanString(dataSet: DataSet, tag: string, fallback = ''): string {
  return dataSet.string(tag)?.trim() || fallback
}

function numberList(dataSet: DataSet, tag: string): number[] {
  const value = cleanString(dataSet, tag)
  if (!value) return []
  return value
    .split('\\')
    .map(Number)
    .filter(Number.isFinite)
}

function cross(a: number[], b: number[]): Vec3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function orientationName(orientation: number[] | null): string {
  if (!orientation || orientation.length !== 6) return 'Unknown'
  const normal = cross(orientation.slice(0, 3), orientation.slice(3, 6))
  const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)))
  return axis === 2 ? 'Axial' : axis === 1 ? 'Coronal' : 'Sagittal'
}

function median(values: number[], fallback: number): number {
  if (!values.length) return fallback
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function parseSlice(file: File, dataSet: DataSet): SliceRecord | null {
  const modality = cleanString(dataSet, 'x00080060')
  const seriesId = cleanString(dataSet, 'x0020000e')
  const rows = dataSet.uint16('x00280010') || 0
  const columns = dataSet.uint16('x00280011') || 0

  if (modality !== 'MR' || !seriesId || !rows || !columns) return null

  const positionValues = numberList(dataSet, 'x00200032')
  const orientationValues = numberList(dataSet, 'x00200037')
  const spacingValues = numberList(dataSet, 'x00280030')
  const position =
    positionValues.length === 3 ? (positionValues as Vec3Tuple) : null
  const orientation =
    orientationValues.length === 6
      ? (orientationValues as SliceRecord['orientation'])
      : null
  const normal = orientation
    ? cross(orientation.slice(0, 3), orientation.slice(3, 6))
    : null

  return {
    file,
    seriesId,
    description: cleanString(dataSet, 'x0008103e', 'Untitled MRI series'),
    protocol: cleanString(dataSet, 'x00181030'),
    modality,
    rows,
    columns,
    pixelSpacing: [spacingValues[0] || 1, spacingValues[1] || spacingValues[0] || 1],
    sliceThickness: dataSet.floatString('x00180050') || 1,
    spacingBetweenSlices: dataSet.floatString('x00180088') || 0,
    position,
    orientation,
    sortPosition: position && normal ? dot(position, normal) : 0,
    instanceNumber: dataSet.intString('x00200013') || 0,
    transferSyntax: cleanString(dataSet, 'x00020010'),
    bitsAllocated: dataSet.uint16('x00280100') || 16,
    bitsStored: dataSet.uint16('x00280101') || 16,
    pixelRepresentation: dataSet.uint16('x00280103') || 0,
    photometricInterpretation: cleanString(dataSet, 'x00280004', 'MONOCHROME2'),
    rescaleSlope: dataSet.floatString('x00281053') ?? 1,
    rescaleIntercept: dataSet.floatString('x00281052') ?? 0,
  }
}

function sortRecords(records: SliceRecord[]): SliceRecord[] {
  const hasGeometry = records.every((record) => record.position && record.orientation)
  return [...records].sort((a, b) =>
    hasGeometry
      ? a.sortPosition - b.sortPosition || a.instanceNumber - b.instanceNumber
      : a.instanceNumber - b.instanceNumber,
  )
}

function summarize(records: SliceRecord[]): SeriesSummary {
  const sorted = sortRecords(records)
  const first = sorted[0]
  const distances = sorted
    .slice(1)
    .map((record, index) => Math.abs(record.sortPosition - sorted[index].sortPosition))
    .filter((distance) => distance > 0.0001)
  const zSpacing = median(
    distances,
    first.spacingBetweenSlices || first.sliceThickness || 1,
  )
  const spacing: Vec3Tuple = [first.pixelSpacing[1], first.pixelSpacing[0], zSpacing]
  const physicalSize: Vec3Tuple = [
    first.columns * spacing[0],
    first.rows * spacing[1],
    Math.max(first.sliceThickness, sorted.length * spacing[2]),
  ]
  const supported =
    JPEG_LOSSLESS_SYNTAXES.has(first.transferSyntax) ||
    JPEG_2000_SYNTAXES.has(first.transferSyntax) ||
    UNCOMPRESSED_SYNTAXES.has(first.transferSyntax)
  const physicalVolume = physicalSize[0] * physicalSize[1] * physicalSize[2]
  const seriesName = `${first.description} ${first.protocol}`
  const sequenceWeight = /FLAIR/i.test(seriesName)
    ? 1.28
    : /DIFF|ADC/i.test(seriesName)
      ? 0.72
      : /HEMO/i.test(seriesName)
        ? 0.84
        : /\bT[12]\b/i.test(seriesName)
          ? 1.08
          : 1

  return {
    id: first.seriesId,
    description: first.description,
    protocol: first.protocol,
    modality: first.modality,
    sliceCount: sorted.length,
    rows: first.rows,
    columns: first.columns,
    spacing,
    physicalSize,
    orientation: orientationName(first.orientation),
    transferSyntax: first.transferSyntax,
    supported,
    estimatedMegabytes: (first.rows * first.columns * sorted.length) / 1024 / 1024,
    score: supported
      ? Math.cbrt(physicalVolume) * Math.log2(sorted.length + 1) * sequenceWeight
      : 0,
  }
}

async function scanFiles(files: File[], generation: number) {
  recordsBySeries = new Map()
  let dicomCount = 0

  for (let index = 0; index < files.length; index += 1) {
    assertJobActive(generation)
    const file = files[index]
    if (file.size >= 132) {
      try {
        const buffer = await file.arrayBuffer()
        assertJobActive(generation)
        const dataSet = dicomParser.parseDicom(new Uint8Array(buffer), {
          untilTag: 'x7fe00010',
        })
        const record = parseSlice(file, dataSet)
        if (record) {
          const group = recordsBySeries.get(record.seriesId) || []
          group.push(record)
          recordsBySeries.set(record.seriesId, group)
          dicomCount += 1
        }
      } catch (error) {
        if (error instanceof JobCancelled) throw error
        // Folder exports commonly contain launchers and text files. Ignore non-DICOM input.
      }
    }

    if (index % 4 === 0 || index === files.length - 1) {
      postIfActive(generation, {
        type: 'scan-progress',
        progress: (index + 1) / Math.max(files.length, 1),
        label: `Indexing ${index + 1} of ${files.length} files`,
      })
    }
  }

  if (!dicomCount) {
    throw new Error('No MRI image series were found in that selection.')
  }

  const series = [...recordsBySeries.values()]
    .map(summarize)
    .sort((a, b) => b.score - a.score)
  postIfActive(generation, { type: 'scan-complete', series })
}

function compressedPixels(dataSet: DataSet): Uint8Array {
  const pixelData = dataSet.elements.x7fe00010
  if (!pixelData?.fragments?.length) {
    throw new Error('The DICOM image has no readable pixel fragments.')
  }

  const frame = pixelData.basicOffsetTable?.length
    ? dicomParser.readEncapsulatedImageFrame(dataSet, pixelData, 0)
    : dicomParser.readEncapsulatedPixelDataFromFragments(
        dataSet,
        pixelData,
        0,
        pixelData.fragments.length,
      )
  return frame as Uint8Array
}

async function decodePixels(dataSet: DataSet, record: SliceRecord): Promise<Uint16Array | Uint8Array> {
  const pixelCount = record.rows * record.columns

  if (JPEG_LOSSLESS_SYNTAXES.has(record.transferSyntax)) {
    const compressed = compressedPixels(dataSet)
    const decoded = new Decoder().decompress(
      compressed.buffer as ArrayBuffer,
      compressed.byteOffset,
      compressed.byteLength,
    )
    return record.bitsAllocated <= 8
      ? new Uint8Array(decoded, 0, pixelCount)
      : new Uint16Array(decoded, 0, pixelCount)
  }

  if (JPEG_2000_SYNTAXES.has(record.transferSyntax)) {
    const compressed = compressedPixels(dataSet)
    openJPEGPromise ||= OpenJPEGJS({ print: () => {}, printErr: () => {} })
    const openJPEG = await openJPEGPromise
    const decoder = new openJPEG.J2KDecoder()
    try {
      decoder.getEncodedBuffer(compressed.byteLength).set(compressed)
      decoder.decode()
      const decoded = decoder.getDecodedBuffer()
      return record.bitsAllocated <= 8
        ? new Uint8Array(decoded.slice(0, pixelCount))
        : new Uint16Array(
            new Uint16Array(
              decoded.buffer,
              decoded.byteOffset,
              Math.min(pixelCount, decoded.byteLength / 2),
            ),
          )
    } finally {
      decoder.delete()
    }
  }

  if (!UNCOMPRESSED_SYNTAXES.has(record.transferSyntax)) {
    throw new Error(`Unsupported DICOM transfer syntax: ${record.transferSyntax}`)
  }

  const pixelData = dataSet.elements.x7fe00010
  if (!pixelData) throw new Error('The DICOM image contains no pixel data.')
  const output = record.bitsAllocated <= 8 ? new Uint8Array(pixelCount) : new Uint16Array(pixelCount)

  for (let index = 0; index < pixelCount; index += 1) {
    output[index] =
      record.bitsAllocated <= 8
        ? dataSet.byteArray[pixelData.dataOffset + index]
        : dataSet.byteArrayParser.readUint16(
            dataSet.byteArray,
            pixelData.dataOffset + index * 2,
          )
  }
  return output
}

function signedValue(value: number, bitsStored: number): number {
  const signBit = 2 ** (bitsStored - 1)
  return value & signBit ? value - 2 ** bitsStored : value
}

function percentileBounds(
  values: Int16Array | Uint16Array,
  min: number,
  max: number,
): [number, number] {
  if (min === max) return [min, max + 1]
  const bucketCount = 4096
  const histogram = new Uint32Array(bucketCount)
  const scale = (bucketCount - 1) / (max - min)

  for (let index = 0; index < values.length; index += 1) {
    histogram[Math.min(bucketCount - 1, Math.floor((values[index] - min) * scale))] += 1
  }

  const lowTarget = values.length * 0.002
  const highTarget = values.length * 0.998
  let cumulative = 0
  let lowBucket = 0
  let highBucket = bucketCount - 1

  for (let index = 0; index < bucketCount; index += 1) {
    cumulative += histogram[index]
    if (cumulative >= lowTarget) {
      lowBucket = index
      break
    }
  }

  cumulative = 0
  for (let index = 0; index < bucketCount; index += 1) {
    cumulative += histogram[index]
    if (cumulative >= highTarget) {
      highBucket = index
      break
    }
  }

  return [
    min + lowBucket / scale,
    Math.max(min + (highBucket + 1) / scale, min + lowBucket / scale + 1),
  ]
}

async function loadSeries(seriesId: string, generation: number) {
  assertJobActive(generation)
  const source = recordsBySeries.get(seriesId)
  if (!source?.length) throw new Error('That MRI series is no longer available.')
  // Snapshot the series list so a later scan cannot mutate the array mid-load.
  const records = sortRecords([...source])
  const summary = summarize(records)
  const { rows, columns } = records[0]
  const voxelCount = rows * columns * records.length
  const signed = records[0].pixelRepresentation === 1
  const rawBuffer = new ArrayBuffer(voxelCount * 2)
  const raw = signed ? new Int16Array(rawBuffer) : new Uint16Array(rawBuffer)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (let sliceIndex = 0; sliceIndex < records.length; sliceIndex += 1) {
    assertJobActive(generation)
    const record = records[sliceIndex]
    if (record.rows !== rows || record.columns !== columns) {
      throw new Error('This series mixes incompatible slice dimensions.')
    }

    const buffer = await record.file.arrayBuffer()
    assertJobActive(generation)
    const dataSet = dicomParser.parseDicom(new Uint8Array(buffer))
    const pixels = await decodePixels(dataSet, record)
    assertJobActive(generation)
    const destinationOffset = sliceIndex * rows * columns

    for (let index = 0; index < pixels.length; index += 1) {
      const value = signed ? signedValue(pixels[index], record.bitsStored) : pixels[index]
      raw[destinationOffset + index] = value
      min = Math.min(min, value)
      max = Math.max(max, value)
    }

    postIfActive(generation, {
      type: 'load-progress',
      progress: (sliceIndex + 1) / records.length,
      label: `Decoding layer ${sliceIndex + 1} of ${records.length}`,
    })

    if (sliceIndex % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  assertJobActive(generation)
  const [windowLow, windowHigh] = percentileBounds(raw, min, max)
  const normalized = new Uint8Array(voxelCount)
  const range = Math.max(1, windowHigh - windowLow)
  const invert = records[0].photometricInterpretation === 'MONOCHROME1'

  for (let index = 0; index < raw.length; index += 1) {
    let value = Math.max(0, Math.min(255, ((raw[index] - windowLow) / range) * 255))
    if (invert) value = 255 - value
    normalized[index] = Math.round(value)
  }

  const slope = records[0].rescaleSlope
  const intercept = records[0].rescaleIntercept
  const volume: VolumeData = {
    seriesId,
    description: summary.description,
    data: normalized,
    dimensions: [columns, rows, records.length],
    spacing: summary.spacing,
    physicalSize: summary.physicalSize,
    scalarRange: [windowLow * slope + intercept, windowHigh * slope + intercept],
    fullScalarRange: [min * slope + intercept, max * slope + intercept],
    orientation: summary.orientation,
    sliceCount: records.length,
  }

  postIfActive(generation, { type: 'volume-ready', volume }, [normalized.buffer])
}

worker.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const data = event.data

  // scan / load-series / cancel / reset invalidate in-flight work and queued older generations.
  // load-series bumps so a new series selection cancels a prior decode; cancel abandons load
  // without wiping recordsBySeries (bundled/demo open while a local load is running).
  if (
    data.type === 'scan' ||
    data.type === 'load-series' ||
    data.type === 'cancel' ||
    data.type === 'reset'
  ) {
    jobGeneration += 1
  }
  const generation = jobGeneration

  jobQueue = jobQueue
    .catch(() => {
      // Keep the chain alive after a failed job so later work still runs.
    })
    .then(async () => {
      if (generation !== jobGeneration) return

      switch (data.type) {
        case 'scan':
          await scanFiles(data.files, generation)
          break
        case 'load-series':
          await loadSeries(data.seriesId, generation)
          break
        case 'cancel':
          break
        case 'reset':
          recordsBySeries = new Map()
          break
      }
    })
    .catch((error: unknown) => {
      if (error instanceof JobCancelled) return
      if (generation !== jobGeneration) return
      post({
        type: 'error',
        message: error instanceof Error ? error.message : 'The DICOM data could not be processed.',
      })
    })
})

export {}
