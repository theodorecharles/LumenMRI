import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import dicomParser from 'dicom-parser'
import { Decoder as JpegLosslessDecoder } from 'jpeg-lossless-decoder-js'
import OpenJPEGJS from '@cornerstonejs/codec-openjpeg'
import { PNG } from 'pngjs'

const outputRoot = path.resolve('public/examples')
const datasets = [
  {
    id: 'brain',
    title: 'Brain MRI',
    anatomy: 'Brain',
    description: 'Complete multi-sequence brain MRI study',
    source: process.env.BRAIN_SCAN_SOURCE || '/home/ted/Downloads/scan/s0000001',
    featuredSeries: 'AX FLAIR',
  },
  {
    id: 'shoulder',
    title: 'Left Shoulder MRI',
    anatomy: 'Shoulder',
    description: 'Complete left shoulder MRI study without contrast',
    source: process.env.SHOULDER_SCAN_SOURCE || '/home/ted/Desktop/s0000001',
    featuredSeries: 'Cor PD frFSE FS',
  },
]

const JPEG_LOSSLESS = new Set([
  '1.2.840.10008.1.2.4.57',
  '1.2.840.10008.1.2.4.70',
])
const JPEG_2000 = new Set([
  '1.2.840.10008.1.2.4.90',
  '1.2.840.10008.1.2.4.91',
])
const UNCOMPRESSED = new Set([
  '1.2.840.10008.1.2',
  '1.2.840.10008.1.2.1',
  '1.2.840.10008.1.2.2',
])

const openJPEG = await OpenJPEGJS({ print: () => {}, printErr: () => {} })

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const list = (dataSet, tag) =>
  (dataSet.string(tag) || '')
    .split('\\')
    .map(Number)
    .filter(Number.isFinite)

const median = (values, fallback) => {
  if (!values.length) return fallback
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

const orientationName = (orientation) => {
  if (orientation.length !== 6) return 'Unknown'
  const normal = cross(orientation.slice(0, 3), orientation.slice(3, 6))
  const absolute = normal.map(Math.abs)
  const axis = absolute.indexOf(Math.max(...absolute))
  return axis === 2 ? 'Axial' : axis === 1 ? 'Coronal' : 'Sagittal'
}

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function readSliceMetadata(file) {
  const source = fs.readFileSync(file)
  const dataSet = dicomParser.parseDicom(
    new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
    { untilTag: 'x7fe00010' },
  )
  if (dataSet.string('x00080060')?.trim() !== 'MR') return null
  const seriesId = dataSet.string('x0020000e')?.trim()
  const rows = dataSet.uint16('x00280010')
  const columns = dataSet.uint16('x00280011')
  if (!seriesId || !rows || !columns) return null

  const position = list(dataSet, 'x00200032')
  const orientation = list(dataSet, 'x00200037')
  const normal = orientation.length === 6
    ? cross(orientation.slice(0, 3), orientation.slice(3, 6))
    : [0, 0, 1]
  const pixelSpacing = list(dataSet, 'x00280030')

  return {
    file,
    seriesId,
    description: dataSet.string('x0008103e')?.trim() || 'Untitled MRI series',
    position,
    orientation,
    sortPosition: position.length === 3 ? dot(position, normal) : 0,
    instance: dataSet.intString('x00200013') || 0,
    rows,
    columns,
    bitsAllocated: dataSet.uint16('x00280100') || 16,
    bitsStored: dataSet.uint16('x00280101') || 16,
    pixelRepresentation: dataSet.uint16('x00280103') || 0,
    pixelSpacing: [pixelSpacing[0] || 1, pixelSpacing[1] || pixelSpacing[0] || 1],
    thickness: dataSet.floatString('x00180050') || 1,
    spacingBetween: dataSet.floatString('x00180088') || 0,
    transferSyntax: dataSet.string('x00020010')?.trim() || '',
    slope: dataSet.floatString('x00281053') ?? 1,
    intercept: dataSet.floatString('x00281052') ?? 0,
    photometric: dataSet.string('x00280004')?.trim() || 'MONOCHROME2',
  }
}

function scanDataset(dataset) {
  const groups = new Map()
  for (const name of fs.readdirSync(dataset.source)) {
    const file = path.join(dataset.source, name)
    if (!fs.statSync(file).isFile()) continue
    try {
      const slice = readSliceMetadata(file)
      if (!slice) continue
      const group = groups.get(slice.seriesId) || []
      group.push(slice)
      groups.set(slice.seriesId, group)
    } catch {
      // Structured reports and non-image files are expected in exported studies.
    }
  }

  const result = [...groups.values()]
  result.forEach((slices) =>
    slices.sort((a, b) => a.sortPosition - b.sortPosition || a.instance - b.instance),
  )
  result.sort((a, b) => {
    if (a[0].description === dataset.featuredSeries) return -1
    if (b[0].description === dataset.featuredSeries) return 1
    return a[0].description.localeCompare(b[0].description)
  })
  return result
}

function compressedFrame(dataSet) {
  const pixelElement = dataSet.elements.x7fe00010
  if (!pixelElement?.fragments?.length) throw new Error('Missing encapsulated pixel data')
  return pixelElement.basicOffsetTable?.length
    ? dicomParser.readEncapsulatedImageFrame(dataSet, pixelElement, 0)
    : dicomParser.readEncapsulatedPixelDataFromFragments(
        dataSet,
        pixelElement,
        0,
        pixelElement.fragments.length,
      )
}

async function decodePixels(dataSet, slice) {
  const pixelCount = slice.rows * slice.columns

  if (JPEG_LOSSLESS.has(slice.transferSyntax)) {
    const compressed = compressedFrame(dataSet)
    const decoded = new JpegLosslessDecoder().decompress(
      compressed.buffer,
      compressed.byteOffset,
      compressed.byteLength,
    )
    return slice.bitsAllocated <= 8
      ? new Uint8Array(decoded, 0, pixelCount)
      : new Uint16Array(decoded, 0, pixelCount)
  }

  if (JPEG_2000.has(slice.transferSyntax)) {
    const compressed = compressedFrame(dataSet)
    const decoder = new openJPEG.J2KDecoder()
    try {
      decoder.getEncodedBuffer(compressed.byteLength).set(compressed)
      decoder.decode()
      const decoded = decoder.getDecodedBuffer()
      return slice.bitsAllocated <= 8
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

  if (UNCOMPRESSED.has(slice.transferSyntax)) {
    const pixelElement = dataSet.elements.x7fe00010
    if (!pixelElement) throw new Error('Missing pixel data')
    const output = slice.bitsAllocated <= 8
      ? new Uint8Array(pixelCount)
      : new Uint16Array(pixelCount)
    for (let index = 0; index < pixelCount; index += 1) {
      output[index] = slice.bitsAllocated <= 8
        ? dataSet.byteArray[pixelElement.dataOffset + index]
        : dataSet.byteArrayParser.readUint16(
            dataSet.byteArray,
            pixelElement.dataOffset + index * 2,
          )
    }
    return output
  }

  throw new Error(`Unsupported transfer syntax ${slice.transferSyntax}`)
}

function percentileBounds(values, min, max) {
  if (min === max) return [min, max + 1]
  const bucketCount = 4096
  const histogram = new Uint32Array(bucketCount)
  const scale = (bucketCount - 1) / (max - min)
  for (const value of values) {
    histogram[Math.min(bucketCount - 1, Math.floor((value - min) * scale))] += 1
  }
  const bucketAt = (percentile) => {
    const target = values.length * percentile
    let cumulative = 0
    for (let index = 0; index < bucketCount; index += 1) {
      cumulative += histogram[index]
      if (cumulative >= target) return index
    }
    return bucketCount - 1
  }
  const low = min + bucketAt(0.002) / scale
  const high = Math.max(low + 1, min + (bucketAt(0.998) + 1) / scale)
  return [low, high]
}

function createPreviewSprite(data, dimensions, physicalSize, outputPath) {
  const frameSize = 192
  const frameCount = 8
  const [width, height, depth] = dimensions
  const imageAspect = physicalSize[0] / Math.max(physicalSize[1], 0.001)
  const drawWidth = imageAspect >= 1 ? frameSize : Math.max(1, Math.round(frameSize * imageAspect))
  const drawHeight = imageAspect >= 1 ? Math.max(1, Math.round(frameSize / imageAspect)) : frameSize
  const offsetX = Math.floor((frameSize - drawWidth) / 2)
  const offsetY = Math.floor((frameSize - drawHeight) / 2)
  const png = new PNG({ width: frameSize * frameCount, height: frameSize })
  const sliceSize = width * height

  for (let frame = 0; frame < frameCount; frame += 1) {
    const fraction = 0.12 + (frame / Math.max(1, frameCount - 1)) * 0.76
    const slice = Math.round(fraction * Math.max(0, depth - 1))
    for (let y = 0; y < frameSize; y += 1) {
      for (let x = 0; x < frameSize; x += 1) {
        const outputIndex = ((frame * frameSize + x) + y * png.width) * 4
        let red = 3
        let green = 7
        let blue = 11
        if (x >= offsetX && x < offsetX + drawWidth && y >= offsetY && y < offsetY + drawHeight) {
          const sourceX = Math.min(width - 1, Math.floor(((x - offsetX) / drawWidth) * width))
          const sourceY = Math.min(height - 1, Math.floor(((y - offsetY) / drawHeight) * height))
          const value = data[sourceX + sourceY * width + slice * sliceSize]
          red = Math.round(value * 0.7)
          green = Math.round(value * 0.9)
          blue = value
        }
        png.data[outputIndex] = red
        png.data[outputIndex + 1] = green
        png.data[outputIndex + 2] = blue
        png.data[outputIndex + 3] = 255
      }
    }
  }
  fs.writeFileSync(outputPath, PNG.sync.write(png, { colorType: 6 }))
}

async function generateSeries(dataset, slices, seriesIndex) {
  const first = slices[0]
  const voxelCount = first.rows * first.columns * slices.length
  const signed = first.pixelRepresentation === 1
  const rawBuffer = new ArrayBuffer(voxelCount * 2)
  const raw = signed ? new Int16Array(rawBuffer) : new Uint16Array(rawBuffer)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex += 1) {
    const slice = slices[sliceIndex]
    const source = fs.readFileSync(slice.file)
    const dataSet = dicomParser.parseDicom(
      new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
    )
    const pixels = await decodePixels(dataSet, slice)
    const destination = sliceIndex * first.rows * first.columns
    const signBit = 2 ** (slice.bitsStored - 1)
    const signedRange = 2 ** slice.bitsStored
    for (let index = 0; index < first.rows * first.columns; index += 1) {
      const unsignedValue = pixels[index]
      const value = signed && unsignedValue & signBit
        ? unsignedValue - signedRange
        : unsignedValue
      raw[destination + index] = value
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }

  const [windowLow, windowHigh] = percentileBounds(raw, min, max)
  const normalized = new Uint8Array(voxelCount)
  const range = windowHigh - windowLow
  for (let index = 0; index < raw.length; index += 1) {
    let value = Math.max(0, Math.min(255, ((raw[index] - windowLow) / range) * 255))
    if (first.photometric === 'MONOCHROME1') value = 255 - value
    normalized[index] = Math.round(value)
  }

  const distances = slices
    .slice(1)
    .map((slice, index) => Math.abs(slice.sortPosition - slices[index].sortPosition))
    .filter((distance) => distance > 0.0001)
  const zSpacing = median(distances, first.spacingBetween || first.thickness || 1)
  const spacing = [first.pixelSpacing[1], first.pixelSpacing[0], zSpacing]
  const physicalSize = [
    first.columns * spacing[0],
    first.rows * spacing[1],
    Math.max(first.thickness, slices.length * spacing[2]),
  ]
  const sequence = String(seriesIndex + 1).padStart(2, '0')
  const slug = `${sequence}-${slugify(first.description)}`
  const datasetRoot = path.join(outputRoot, dataset.id)
  const assetRelative = `${dataset.id}/${slug}.volume`
  const previewRelative = `${dataset.id}/${slug}.preview.png`
  const assetPath = path.join(outputRoot, assetRelative)
  const previewPath = path.join(outputRoot, previewRelative)
  const compressed = gzipSync(normalized, { level: 9 })
  fs.writeFileSync(assetPath, compressed)
  createPreviewSprite(
    normalized,
    [first.columns, first.rows, slices.length],
    physicalSize,
    previewPath,
  )

  console.log(
    `  ${sequence}/${first.description}: ${slices.length} layers, ` +
      `${(compressed.byteLength / 1024 / 1024).toFixed(1)} MB`,
  )

  return {
    id: `${dataset.id}-${slug}`,
    datasetId: dataset.id,
    datasetTitle: dataset.title,
    anatomy: dataset.anatomy,
    description: first.description,
    encoding: 'gzip',
    asset: assetRelative,
    preview: previewRelative,
    previewFrames: 8,
    dimensions: [first.columns, first.rows, slices.length],
    spacing,
    physicalSize,
    scalarRange: [
      windowLow * first.slope + first.intercept,
      windowHigh * first.slope + first.intercept,
    ],
    fullScalarRange: [
      min * first.slope + first.intercept,
      max * first.slope + first.intercept,
    ],
    orientation: orientationName(first.orientation),
    sliceCount: slices.length,
    byteLength: normalized.byteLength,
    compressedByteLength: compressed.byteLength,
    featured: first.description === dataset.featuredSeries,
  }
}

fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(outputRoot, { recursive: true })

const catalog = { version: 2, datasets: [] }
for (const dataset of datasets) {
  const seriesGroups = scanDataset(dataset)
  if (!seriesGroups.length) throw new Error(`No MRI series found in ${dataset.source}`)
  fs.mkdirSync(path.join(outputRoot, dataset.id), { recursive: true })
  console.log(`${dataset.title}: ${seriesGroups.length} series`)
  const series = []
  for (let index = 0; index < seriesGroups.length; index += 1) {
    series.push(await generateSeries(dataset, seriesGroups[index], index))
  }
  catalog.datasets.push({
    id: dataset.id,
    title: dataset.title,
    anatomy: dataset.anatomy,
    description: dataset.description,
    series,
  })
}

fs.writeFileSync(
  path.join(outputRoot, 'index.json'),
  `${JSON.stringify(catalog, null, 2)}\n`,
)

const totalSeries = catalog.datasets.reduce((total, dataset) => total + dataset.series.length, 0)
console.log(`Wrote ${totalSeries} de-identified series to ${outputRoot}`)
