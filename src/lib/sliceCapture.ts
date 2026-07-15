export type CaptureMeasurementTool = 'distance' | 'roi'

export interface CapturePoint {
  x: number
  y: number
}

export interface CaptureMeasurement {
  id: number
  tool: CaptureMeasurementTool
  start: CapturePoint
  end: CapturePoint
  label: string
}

export interface CaptureOrientationLabels {
  top: string
  right: string
  bottom: string
  left: string
}

export interface AnnotatedSliceCaptureInput {
  source: HTMLCanvasElement
  seriesName: string
  sliceIndex: number
  sliceCount: number
  window: number
  level: number
  measurements: CaptureMeasurement[]
  labels: CaptureOrientationLabels
}

export type VolumeCaptureMode = 'acquired' | 'enhanced'

export interface AnnotatedVolumeCaptureInput {
  source: HTMLCanvasElement
  seriesName: string
  orientation: string
  mode: VolumeCaptureMode
  dimensions: [number, number, number]
  paletteName: string
  cropActive: boolean
}

const DISTANCE_STROKE = '#68efff'
const DISTANCE_ENDPOINT = '#b9f9ff'
const ROI_STROKE = '#ffb263'
const ROI_FILL = 'rgba(255, 170, 91, 0.08)'
const LABEL_BG = 'rgba(3, 12, 17, 0.9)'
const MARKER_BG = 'rgba(4, 12, 17, 0.78)'
const META_DIM = '#718991'
const META_ACCENT = '#52cfe5'
const META_MUTED = '#4d626a'

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function drawMeasurementLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tool: CaptureMeasurementTool,
  fontSize: number,
) {
  ctx.save()
  ctx.font = `${fontSize}px "DM Mono", ui-monospace, monospace`
  const paddingX = fontSize * 0.55
  const paddingY = fontSize * 0.4
  const metrics = ctx.measureText(text)
  const boxW = metrics.width + paddingX * 2
  const boxH = fontSize + paddingY * 2
  const boxX = x - boxW / 2
  const boxY = y - boxH - fontSize * 0.55

  ctx.fillStyle = LABEL_BG
  ctx.strokeStyle = tool === 'roi' ? 'rgba(255, 178, 99, 0.56)' : 'rgba(104, 239, 255, 0.48)'
  ctx.lineWidth = Math.max(1, fontSize * 0.08)
  roundRect(ctx, boxX, boxY, boxW, boxH, Math.max(2, fontSize * 0.35))
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = tool === 'roi' ? '#ffe0bd' : '#d9fbff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, x, boxY + boxH / 2)
  ctx.restore()
}

function drawOrientationMarker(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
) {
  ctx.save()
  ctx.fillStyle = MARKER_BG
  ctx.strokeStyle = 'rgba(60, 211, 237, 0.35)'
  ctx.lineWidth = Math.max(1, size * 0.06)
  ctx.beginPath()
  ctx.arc(x, y, size / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#62d9ec'
  ctx.font = `${Math.round(size * 0.42)}px "DM Mono", ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5)
  ctx.restore()
}

function drawMetadataLines(
  ctx: CanvasRenderingContext2D,
  stripLines: Array<{ text: string; color: string }>,
  scale: number,
) {
  const fontSize = Math.max(9, Math.round(10 * scale))
  const lineGap = fontSize * 1.35
  const pad = Math.max(8, Math.round(10 * scale))
  const top = pad + Math.round(4 * scale)

  ctx.save()
  ctx.font = `${fontSize}px "DM Mono", ui-monospace, monospace`
  ctx.textBaseline = 'top'

  const maxWidth = Math.max(...stripLines.map((line) => ctx.measureText(line.text).width))
  const stripH = stripLines.length * lineGap + pad * 0.6
  const stripW = maxWidth + pad * 1.4

  ctx.fillStyle = 'rgba(3, 10, 14, 0.72)'
  roundRect(ctx, pad * 0.4, top - pad * 0.35, stripW, stripH, Math.max(3, 4 * scale))
  ctx.fill()

  stripLines.forEach((line, index) => {
    ctx.fillStyle = line.color
    ctx.fillText(line.text, pad, top + index * lineGap)
  })
  ctx.restore()
}

function drawMetadataStrip(
  ctx: CanvasRenderingContext2D,
  input: AnnotatedSliceCaptureInput,
  scale: number,
) {
  // Thin corner strip: series name, slice index, W/L.
  drawMetadataLines(
    ctx,
    [
      { text: input.seriesName, color: META_DIM },
      {
        text: `SL ${String(input.sliceIndex + 1).padStart(3, '0')} / ${String(input.sliceCount).padStart(3, '0')}`,
        color: META_ACCENT,
      },
      {
        text: `W ${Math.round(input.window * 255)} · L ${Math.round(input.level * 255)}`,
        color: META_MUTED,
      },
    ],
    scale,
  )
}

function drawVolumeMetadataStrip(
  ctx: CanvasRenderingContext2D,
  input: AnnotatedVolumeCaptureInput,
  scale: number,
) {
  const [width, height, depth] = input.dimensions
  const modeLabel = input.mode === 'enhanced' ? 'Enhanced' : 'Acquired'
  const stripLines: Array<{ text: string; color: string }> = [
    { text: input.seriesName, color: META_DIM },
    { text: `${input.orientation} · ${modeLabel}`, color: META_ACCENT },
    { text: `${width} × ${height} × ${depth}`, color: META_MUTED },
    { text: `Palette ${input.paletteName}`, color: META_MUTED },
  ]
  if (input.cropActive) {
    stripLines.push({ text: 'Crop active', color: META_MUTED })
  }
  drawMetadataLines(ctx, stripLines, scale)
}

/**
 * Composite the intensity canvas with measurement overlays, orientation markers,
 * and a thin metadata strip into a PNG data URL.
 */
export function compositeAnnotatedSlicePng(input: AnnotatedSliceCaptureInput): string {
  const { source } = input
  const width = source.width
  const height = source.height
  if (!width || !height) return source.toDataURL('image/png')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return source.toDataURL('image/png')

  ctx.drawImage(source, 0, 0)

  const scale = Math.max(0.75, Math.min(width, height) / 360)
  const stroke = Math.max(1.25, 1.5 * scale)
  const endpointR = Math.max(2.5, 3.5 * scale)
  const labelFont = Math.max(9, Math.round(10 * scale))

  for (const measurement of input.measurements) {
    const x1 = measurement.start.x * width
    const y1 = measurement.start.y * height
    const x2 = measurement.end.x * width
    const y2 = measurement.end.y * height

    if (measurement.tool === 'distance') {
      ctx.save()
      ctx.strokeStyle = DISTANCE_STROKE
      ctx.lineWidth = stroke
      ctx.setLineDash([4 * scale, 2 * scale])
      ctx.shadowColor = 'rgba(60, 211, 237, 0.85)'
      ctx.shadowBlur = 3 * scale
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.shadowBlur = 0
      for (const [cx, cy] of [
        [x1, y1],
        [x2, y2],
      ] as const) {
        ctx.fillStyle = '#07141a'
        ctx.strokeStyle = DISTANCE_ENDPOINT
        ctx.lineWidth = stroke
        ctx.beginPath()
        ctx.arc(cx, cy, endpointR, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()

      const labelX = ((measurement.start.x + measurement.end.x) * 0.5)
      const labelY = ((measurement.start.y + measurement.end.y) * 0.5)
      drawMeasurementLabel(
        ctx,
        measurement.label,
        Math.max(0.05, Math.min(0.95, labelX)) * width,
        Math.max(0.05, Math.min(0.95, labelY)) * height,
        'distance',
        labelFont,
      )
    } else {
      const rx = Math.min(x1, x2)
      const ry = Math.min(y1, y2)
      const rw = Math.abs(x2 - x1)
      const rh = Math.abs(y2 - y1)
      ctx.save()
      ctx.fillStyle = ROI_FILL
      ctx.strokeStyle = ROI_STROKE
      ctx.lineWidth = stroke
      ctx.setLineDash([5 * scale, 2 * scale])
      ctx.shadowColor = 'rgba(255, 147, 72, 0.7)'
      ctx.shadowBlur = 3 * scale
      ctx.strokeRect(rx, ry, rw, rh)
      ctx.shadowBlur = 0
      ctx.fillRect(rx, ry, rw, rh)
      ctx.restore()

      const labelX = Math.max(measurement.start.x, measurement.end.x)
      const labelY = Math.min(measurement.start.y, measurement.end.y)
      drawMeasurementLabel(
        ctx,
        measurement.label,
        Math.max(0.05, Math.min(0.95, labelX)) * width,
        Math.max(0.05, Math.min(0.95, labelY)) * height,
        'roi',
        labelFont,
      )
    }
  }

  const markerSize = Math.max(16, Math.round(20 * scale))
  const edgePad = Math.max(10, Math.round(14 * scale))
  drawOrientationMarker(ctx, input.labels.top, width / 2, edgePad + markerSize / 2 + Math.round(36 * scale), markerSize)
  drawOrientationMarker(ctx, input.labels.bottom, width / 2, height - edgePad - markerSize / 2, markerSize)
  drawOrientationMarker(ctx, input.labels.left, edgePad + markerSize / 2, height / 2, markerSize)
  drawOrientationMarker(ctx, input.labels.right, width - edgePad - markerSize / 2, height / 2, markerSize)

  drawMetadataStrip(ctx, input, scale)

  return canvas.toDataURL('image/png')
}

/**
 * Composite a WebGL volume frame with a thin metadata strip (series, mode,
 * dimensions, palette, crop) into a PNG data URL. No 3D measurements.
 */
export function compositeAnnotatedVolumePng(input: AnnotatedVolumeCaptureInput): string {
  const { source } = input
  const width = source.width
  const height = source.height
  if (!width || !height) return source.toDataURL('image/png')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return source.toDataURL('image/png')

  ctx.drawImage(source, 0, 0)

  const scale = Math.max(0.75, Math.min(width, height) / 360)
  drawVolumeMetadataStrip(ctx, input, scale)

  return canvas.toDataURL('image/png')
}
