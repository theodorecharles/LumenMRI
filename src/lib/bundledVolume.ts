import type { SeriesSummary, VolumeData } from '../types'

export interface BundledSeries {
  id: string
  datasetId: string
  datasetTitle: string
  anatomy: string
  description: string
  encoding: 'gzip'
  asset: string
  preview: string
  previewFrames: number
  dimensions: [number, number, number]
  spacing: [number, number, number]
  physicalSize: [number, number, number]
  scalarRange: [number, number]
  fullScalarRange: [number, number]
  orientation: string
  sliceCount: number
  byteLength: number
  compressedByteLength: number
  featured: boolean
}

export interface BundledDataset {
  id: string
  title: string
  anatomy: string
  description: string
  series: BundledSeries[]
}

export interface BundledCatalog {
  version: number
  datasets: BundledDataset[]
}

function assetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return `${base}${relativePath}`
}

export function bundledAssetUrl(relativePath: string): string {
  return assetUrl(`examples/${relativePath}`)
}

export async function loadBundledCatalog(): Promise<BundledCatalog> {
  const response = await fetch(bundledAssetUrl('index.json'))
  if (!response.ok) throw new Error('The included scan library could not be loaded.')
  const catalog = (await response.json()) as BundledCatalog
  if (catalog.version !== 2 || !Array.isArray(catalog.datasets)) {
    throw new Error('The included scan library uses an unsupported format.')
  }
  return catalog
}

export async function loadBundledVolume(series: BundledSeries): Promise<VolumeData> {
  const response = await fetch(bundledAssetUrl(series.asset))
  if (!response.ok || !response.body) {
    throw new Error(`The ${series.description} volume could not be loaded.`)
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress the included MRI volume.')
  }

  const stream = response.body.pipeThrough(new DecompressionStream('gzip'))
  const data = new Uint8Array(await new Response(stream).arrayBuffer())
  const expectedLength = series.dimensions.reduce((total, value) => total * value, 1)
  if (data.byteLength !== series.byteLength || data.byteLength !== expectedLength) {
    throw new Error(`The ${series.description} volume failed its integrity check.`)
  }

  return {
    seriesId: series.id,
    description: `${series.datasetTitle} · ${series.description}`,
    data,
    dimensions: series.dimensions,
    spacing: series.spacing,
    physicalSize: series.physicalSize,
    scalarRange: series.scalarRange,
    fullScalarRange: series.fullScalarRange,
    orientation: series.orientation,
    sliceCount: series.sliceCount,
  }
}

export function bundledSeriesSummary(series: BundledSeries): SeriesSummary {
  return {
    id: series.id,
    description: series.description,
    protocol: series.datasetTitle,
    modality: 'MR',
    sliceCount: series.sliceCount,
    rows: series.dimensions[1],
    columns: series.dimensions[0],
    spacing: series.spacing,
    physicalSize: series.physicalSize,
    orientation: series.orientation,
    transferSyntax: 'Preprocessed volume',
    supported: true,
    estimatedMegabytes: series.byteLength / 1024 / 1024,
    score: series.featured ? Number.POSITIVE_INFINITY : series.sliceCount,
    bundled: true,
  }
}
