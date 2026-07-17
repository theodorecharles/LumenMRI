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

/** Normalized (0–1) pin with labels already formatted for the live pin overlay. */
export interface CapturePinnedProbe {
  x: number
  y: number
  /** e.g. "I 128" or "I 128 · 1024" */
  intensityLabel: string
  /** e.g. "c 42 · r 17" */
  coordsLabel: string
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
  /** Current-slice pins only; omitted or empty skips drawing. */
  pinnedProbes?: CapturePinnedProbe[]
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
const PROBE_STROKE = 'rgba(126, 245, 196, 0.95)'
const PROBE_LABEL_BG = 'rgba(2, 10, 8, 0.86)'
const PROBE_LABEL_BORDER = 'rgba(110, 240, 190, 0.4)'
const PROBE_LABEL_TEXT = '#e8fff6'
const PROBE_COORDS_TEXT = '#8ebfad'

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
  const lines = text.split('\n')
  const paddingX = fontSize * 0.55
  const paddingY = fontSize * 0.4
  const lineGap = fontSize * 0.2
  let maxLineW = 0
  for (const line of lines) {
    maxLineW = Math.max(maxLineW, ctx.measureText(line).width)
  }
  const boxW = maxLineW + paddingX * 2
  const boxH = lines.length * fontSize + Math.max(0, lines.length - 1) * lineGap + paddingY * 2
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
  const firstBaseline = boxY + paddingY + fontSize / 2
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i]!, x, firstBaseline + i * (fontSize + lineGap))
  }
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

/**
 * Draw a pinned intensity probe: mint crosshair + circle, label offset to the right
 * (parity with live `.pixel-probe-pin` / `.pixel-probe-cross` / `.pixel-probe-pin-label`).
 */
function drawPinnedProbe(
  ctx: CanvasRenderingContext2D,
  probe: CapturePinnedProbe,
  width: number,
  height: number,
  scale: number,
) {
  const cx = probe.x * width
  const cy = probe.y * height
  const arm = Math.max(7, 9 * scale)
  const ringR = Math.max(5, 6 * scale)
  const stroke = Math.max(1, 1 * scale)

  ctx.save()
  ctx.strokeStyle = PROBE_STROKE
  ctx.fillStyle = PROBE_STROKE
  ctx.lineWidth = stroke
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = 1 * scale

  // Crosshair arms
  ctx.beginPath()
  ctx.moveTo(cx, cy - arm)
  ctx.lineTo(cx, cy + arm)
  ctx.moveTo(cx - arm, cy)
  ctx.lineTo(cx + arm, cy)
  ctx.stroke()

  // Center ring
  ctx.beginPath()
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
  ctx.stroke()
  ctx.shadowBlur = 0

  // Label box (to the right / slightly above, like live pin)
  const intensityFont = Math.max(8, Math.round(9 * scale))
  const coordsFont = Math.max(7, Math.round(8 * scale))
  const padX = Math.max(4, 6 * scale)
  const padY = Math.max(3, 4 * scale)
  const gap = Math.max(1, 1 * scale)

  ctx.font = `${intensityFont}px "DM Mono", ui-monospace, monospace`
  const intensityW = ctx.measureText(probe.intensityLabel).width
  ctx.font = `${coordsFont}px "DM Mono", ui-monospace, monospace`
  const coordsW = ctx.measureText(probe.coordsLabel).width
  const boxW = Math.max(intensityW, coordsW) + padX * 2
  const boxH = intensityFont + coordsFont + gap + padY * 2
  let boxX = cx + Math.max(8, 10 * scale)
  let boxY = cy - Math.max(3, 4 * scale)
  // Keep label on-canvas
  if (boxX + boxW > width - 2) boxX = Math.max(2, cx - boxW - Math.max(8, 10 * scale))
  if (boxY + boxH > height - 2) boxY = Math.max(2, height - boxH - 2)
  if (boxY < 2) boxY = 2

  ctx.fillStyle = PROBE_LABEL_BG
  ctx.strokeStyle = PROBE_LABEL_BORDER
  ctx.lineWidth = Math.max(1, 0.75 * scale)
  roundRect(ctx, boxX, boxY, boxW, boxH, Math.max(2, 4 * scale))
  ctx.fill()
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = PROBE_LABEL_TEXT
  ctx.font = `${intensityFont}px "DM Mono", ui-monospace, monospace`
  ctx.fillText(probe.intensityLabel, boxX + padX, boxY + padY)
  ctx.fillStyle = PROBE_COORDS_TEXT
  ctx.font = `${coordsFont}px "DM Mono", ui-monospace, monospace`
  ctx.fillText(probe.coordsLabel, boxX + padX, boxY + padY + intensityFont + gap)
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
 * Draw intensity + measurements, pins, orientation markers, and metadata strip
 * onto a new canvas. Returns null when the source is empty or 2d context fails.
 * Pins are never on the bare source canvas — only this composite path.
 */
export function renderAnnotatedSliceCanvas(
  input: AnnotatedSliceCaptureInput,
): HTMLCanvasElement | null {
  const { source } = input
  const width = source.width
  const height = source.height
  if (!width || !height) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

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

  for (const probe of input.pinnedProbes ?? []) {
    drawPinnedProbe(ctx, probe, width, height, scale)
  }

  const markerSize = Math.max(16, Math.round(20 * scale))
  const edgePad = Math.max(10, Math.round(14 * scale))
  drawOrientationMarker(ctx, input.labels.top, width / 2, edgePad + markerSize / 2 + Math.round(36 * scale), markerSize)
  drawOrientationMarker(ctx, input.labels.bottom, width / 2, height - edgePad - markerSize / 2, markerSize)
  drawOrientationMarker(ctx, input.labels.left, edgePad + markerSize / 2, height / 2, markerSize)
  drawOrientationMarker(ctx, input.labels.right, width - edgePad - markerSize / 2, height / 2, markerSize)

  drawMetadataStrip(ctx, input, scale)

  return canvas
}

/**
 * Composite the intensity canvas with measurement overlays, pinned probes,
 * orientation markers, and a thin metadata strip into a PNG data URL.
 */
export function compositeAnnotatedSlicePng(input: AnnotatedSliceCaptureInput): string {
  const canvas = renderAnnotatedSliceCanvas(input)
  if (!canvas) return input.source.toDataURL('image/png')
  return canvas.toDataURL('image/png')
}

export interface CompareSliceCaptureInput {
  left: HTMLCanvasElement
  right: HTMLCanvasElement
  /** Dark strip between panes. Default 8. */
  gutter?: number
  leftLabel?: string
  rightLabel?: string
}

function drawPaneBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
) {
  const fontSize = Math.max(11, Math.round(13 * scale))
  const padX = Math.max(6, Math.round(8 * scale))
  const padY = Math.max(3, Math.round(4 * scale))
  ctx.save()
  ctx.font = `600 ${fontSize}px "DM Mono", ui-monospace, monospace`
  const metrics = ctx.measureText(text)
  const boxW = metrics.width + padX * 2
  const boxH = fontSize + padY * 2
  ctx.fillStyle = 'rgba(3, 12, 17, 0.88)'
  ctx.strokeStyle = 'rgba(82, 207, 229, 0.55)'
  ctx.lineWidth = Math.max(1, 1 * scale)
  roundRect(ctx, x, y, boxW, boxH, Math.max(3, 4 * scale))
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#7ee8f5'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + padX, y + boxH / 2 + 0.5)
  ctx.restore()
}

/**
 * Stitch two already-annotated pane canvases into one PNG (A | gutter | B).
 * Scales both panes to a shared height (taller wins); letterboxes with black if
 * widths would otherwise mismatch after scale. Falls back to left-only if right
 * has no size.
 */
export function compositeCompareSlicePng(input: CompareSliceCaptureInput): string {
  const { left, right } = input
  const gutter = Math.max(0, Math.round(input.gutter ?? 8))
  const leftLabel = input.leftLabel ?? 'A'
  const rightLabel = input.rightLabel ?? 'B'

  if (!left.width || !left.height) {
    return left.toDataURL('image/png')
  }
  if (!right.width || !right.height) {
    return left.toDataURL('image/png')
  }

  const targetH = Math.max(left.height, right.height)
  const leftScale = targetH / left.height
  const rightScale = targetH / right.height
  const leftW = Math.max(1, Math.round(left.width * leftScale))
  const rightW = Math.max(1, Math.round(right.width * rightScale))

  const canvas = document.createElement('canvas')
  canvas.width = leftW + gutter + rightW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) return left.toDataURL('image/png')

  ctx.fillStyle = '#02080b'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.drawImage(left, 0, 0, leftW, targetH)
  if (gutter > 0) {
    ctx.fillStyle = '#0a1418'
    ctx.fillRect(leftW, 0, gutter, targetH)
    // Thin accent line in the gutter
    ctx.fillStyle = 'rgba(82, 207, 229, 0.28)'
    const mid = leftW + gutter / 2
    ctx.fillRect(mid - 0.5, 0, 1, targetH)
  }
  ctx.drawImage(right, leftW + gutter, 0, rightW, targetH)

  const badgeScale = Math.max(0.75, targetH / 360)
  const badgePad = Math.max(8, Math.round(10 * badgeScale))
  drawPaneBadge(ctx, leftLabel, badgePad, badgePad, badgeScale)
  drawPaneBadge(ctx, rightLabel, leftW + gutter + badgePad, badgePad, badgeScale)

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
