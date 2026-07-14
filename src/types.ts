export type PaletteName = 'cyan' | 'ember' | 'bone'

export type Vec3Tuple = [number, number, number]

export interface SeriesSummary {
  id: string
  description: string
  protocol: string
  modality: string
  sliceCount: number
  rows: number
  columns: number
  spacing: Vec3Tuple
  physicalSize: Vec3Tuple
  orientation: string
  transferSyntax: string
  supported: boolean
  estimatedMegabytes: number
  score: number
  bundled?: boolean
}

export interface VolumeData {
  seriesId: string
  description: string
  data: Uint8Array
  dimensions: Vec3Tuple
  spacing: Vec3Tuple
  physicalSize: Vec3Tuple
  scalarRange: [number, number]
  fullScalarRange: [number, number]
  orientation: string
  sliceCount: number
}

export interface ScanProgress {
  phase: 'idle' | 'scanning' | 'loading' | 'ready' | 'error'
  progress: number
  label: string
}

export interface VolumeSettings {
  threshold: number
  opacity: number
  window: number
  level: number
  detail: number
  clip: number
  palette: PaletteName
}

export interface CropBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type WorkerRequest =
  | { type: 'scan'; files: File[] }
  | { type: 'load-series'; seriesId: string }
  | { type: 'reset' }

export type WorkerResponse =
  | { type: 'scan-progress'; progress: number; label: string }
  | { type: 'scan-complete'; series: SeriesSummary[] }
  | { type: 'load-progress'; progress: number; label: string }
  | { type: 'volume-ready'; volume: VolumeData }
  | { type: 'error'; message: string }
