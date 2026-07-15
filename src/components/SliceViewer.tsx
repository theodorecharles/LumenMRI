import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Crop,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Ruler,
  SquareDashed,
  Trash2,
} from 'lucide-react'
import type { CropBounds, VolumeData, VolumeSettings } from '../types'

export interface SliceViewerHandle {
  capture: () => void
}

const CINE_FPS_OPTIONS = [5, 10, 15] as const
type CineFps = (typeof CINE_FPS_OPTIONS)[number]

interface SliceViewerProps {
  volume: VolumeData
  sliceIndex: number
  onSliceChange: (index: number) => void
  volumeSettings: VolumeSettings
  cropBounds: CropBounds
  onCropChange: (bounds: CropBounds) => void
  cropEditing: boolean
  onCropEditingChange: (editing: boolean) => void
  /** Used to pause cine when the viewer layout changes. */
  viewerLayout?: string
}

interface CanvasRect {
  left: number
  top: number
  width: number
  height: number
}

type CropInteraction =
  | { type: 'draw'; startX: number; startY: number }
  | { type: 'move'; startX: number; startY: number; bounds: CropBounds }
  | { type: 'resize'; corner: 'nw' | 'ne' | 'sw' | 'se'; bounds: CropBounds }

type MeasurementTool = 'distance' | 'roi'

interface MeasurementPoint {
  x: number
  y: number
}

interface Measurement {
  id: number
  tool: MeasurementTool
  slice: number
  start: MeasurementPoint
  end: MeasurementPoint
}

type PointerInteraction = CropInteraction | {
  type: 'measurement'
  tool: MeasurementTool
  slice: number
  start: MeasurementPoint
}

function orientationLabels(orientation: string) {
  const name = orientation.toLowerCase()
  if (name.includes('sag')) return { top: 'S', right: 'P', bottom: 'I', left: 'A' }
  if (name.includes('cor')) return { top: 'S', right: 'L', bottom: 'I', left: 'R' }
  return { top: 'A', right: 'L', bottom: 'P', left: 'R' }
}

export const SliceViewer = forwardRef<SliceViewerHandle, SliceViewerProps>(
  function SliceViewer({
    volume,
    sliceIndex,
    onSliceChange,
    volumeSettings,
    cropBounds,
    onCropChange,
    cropEditing,
    onCropEditingChange,
    viewerLayout,
  }, forwardedRef) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const viewportRef = useRef<HTMLDivElement>(null)
    const interactionRef = useRef<PointerInteraction | null>(null)
    const measurementIdRef = useRef(0)
    const sliceIndexRef = useRef(sliceIndex)
    const [canvasRect, setCanvasRect] = useState<CanvasRect | null>(null)
    const [measurementTool, setMeasurementTool] = useState<MeasurementTool | null>(null)
    const [measurements, setMeasurements] = useState<Measurement[]>([])
    const [measurementDraft, setMeasurementDraft] = useState<Measurement | null>(null)
    const [cinePlaying, setCinePlaying] = useState(false)
    const [cineFps, setCineFps] = useState<CineFps>(10)
    const [width, height, depth] = volume.dimensions
    const safeIndex = Math.max(0, Math.min(depth - 1, sliceIndex))
    const labels = orientationLabels(volume.orientation)
    sliceIndexRef.current = safeIndex

    useImperativeHandle(
      forwardedRef,
      () => ({
        capture: () => {
          const canvas = canvasRef.current
          if (!canvas) return
          const link = document.createElement('a')
          link.download = `lumen-${volume.description.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-slice-${safeIndex + 1}.png`
          link.href = canvas.toDataURL('image/png')
          link.click()
        },
      }),
      [safeIndex, volume.description],
    )

    useEffect(() => {
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d', { alpha: false })
      if (!canvas || !context) return

      canvas.width = width
      canvas.height = height
      const image = context.createImageData(width, height)
      const sliceOffset = safeIndex * width * height
      const windowLow = (volumeSettings.level - volumeSettings.window * 0.5) * 255
      const windowWidth = Math.max(4, volumeSettings.window * 255)

      for (let pixel = 0; pixel < width * height; pixel += 1) {
        const value = Math.max(
          0,
          Math.min(255, ((volume.data[sliceOffset + pixel] - windowLow) / windowWidth) * 255),
        )
        const target = pixel * 4
        image.data[target] = value
        image.data[target + 1] = value
        image.data[target + 2] = value
        image.data[target + 3] = 255
      }
      context.putImageData(image, 0, 0)
    }, [height, safeIndex, volume.data, volumeSettings.level, volumeSettings.window, width])

    useEffect(() => {
      const canvas = canvasRef.current
      const viewport = viewportRef.current
      if (!canvas || !viewport) return
      const updateRect = () => {
        const canvasBounds = canvas.getBoundingClientRect()
        const viewportBounds = viewport.getBoundingClientRect()
        setCanvasRect({
          left: canvasBounds.left - viewportBounds.left,
          top: canvasBounds.top - viewportBounds.top,
          width: canvasBounds.width,
          height: canvasBounds.height,
        })
      }
      const observer = new ResizeObserver(updateRect)
      observer.observe(canvas)
      observer.observe(viewport)
      updateRect()
      return () => observer.disconnect()
    }, [height, width])

    useEffect(() => {
      setMeasurements([])
      setMeasurementDraft(null)
      setMeasurementTool(null)
      interactionRef.current = null
      setCinePlaying(false)
    }, [volume.seriesId])

    useEffect(() => {
      setCinePlaying(false)
    }, [viewerLayout])

    useEffect(() => {
      if (depth <= 1) setCinePlaying(false)
    }, [depth])

    useEffect(() => {
      setMeasurementDraft(null)
      if (interactionRef.current?.type === 'measurement') interactionRef.current = null
    }, [safeIndex])

    useEffect(() => {
      if (!cinePlaying || depth <= 1) return
      const intervalMs = 1000 / cineFps
      const timer = window.setInterval(() => {
        const current = sliceIndexRef.current
        onSliceChange(current >= depth - 1 ? 0 : current + 1)
      }, intervalMs)
      return () => window.clearInterval(timer)
    }, [cinePlaying, cineFps, depth, onSliceChange])

    /** User-driven slice change — pauses cine playback. */
    const setSliceFromUser = (index: number) => {
      setCinePlaying(false)
      onSliceChange(Math.max(0, Math.min(depth - 1, index)))
    }

    const stepSlice = (amount: number) => {
      setSliceFromUser(safeIndex + amount)
    }

    const toggleCine = () => {
      if (depth <= 1) return
      setCinePlaying((playing) => !playing)
    }

    const cropPoint = (event: React.PointerEvent) => {
      if (!canvasRect) return { x: 0, y: 0 }
      const viewportBounds = viewportRef.current?.getBoundingClientRect()
      return {
        x: Math.max(0, Math.min(1, (event.clientX - (viewportBounds?.left || 0) - canvasRect.left) / canvasRect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - (viewportBounds?.top || 0) - canvasRect.top) / canvasRect.height)),
      }
    }

    const beginInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
      const point = cropPoint(event)
      if (measurementTool) {
        const draft: Measurement = {
          id: -1,
          tool: measurementTool,
          slice: safeIndex,
          start: point,
          end: point,
        }
        interactionRef.current = {
          type: 'measurement',
          tool: measurementTool,
          slice: safeIndex,
          start: point,
        }
        setMeasurementDraft(draft)
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      if (!cropEditing) return
      const tolerance = 0.055
      const corners = [
        ['nw', cropBounds.minX, cropBounds.minY],
        ['ne', cropBounds.maxX, cropBounds.minY],
        ['sw', cropBounds.minX, cropBounds.maxY],
        ['se', cropBounds.maxX, cropBounds.maxY],
      ] as const
      const corner = corners.find(([, x, y]) => Math.abs(point.x - x) < tolerance && Math.abs(point.y - y) < tolerance)
      if (corner) interactionRef.current = { type: 'resize', corner: corner[0], bounds: cropBounds }
      else if (
        point.x >= cropBounds.minX && point.x <= cropBounds.maxX &&
        point.y >= cropBounds.minY && point.y <= cropBounds.maxY &&
        cropBounds.maxX - cropBounds.minX < 0.995
      ) interactionRef.current = { type: 'move', startX: point.x, startY: point.y, bounds: cropBounds }
      else interactionRef.current = { type: 'draw', startX: point.x, startY: point.y }
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const updateInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current
      if (!interaction) return
      const point = cropPoint(event)
      if (interaction.type === 'measurement') {
        setMeasurementDraft({
          id: -1,
          tool: interaction.tool,
          slice: interaction.slice,
          start: interaction.start,
          end: point,
        })
        return
      }
      if (!cropEditing) return
      const minimum = 0.035
      if (interaction.type === 'draw') {
        const minX = Math.min(interaction.startX, point.x)
        const maxX = Math.max(interaction.startX, point.x)
        const minY = Math.min(interaction.startY, point.y)
        const maxY = Math.max(interaction.startY, point.y)
        if (maxX - minX >= minimum && maxY - minY >= minimum) {
          onCropChange({ ...cropBounds, minX, maxX, minY, maxY })
        }
      } else if (interaction.type === 'move') {
        const width = interaction.bounds.maxX - interaction.bounds.minX
        const height = interaction.bounds.maxY - interaction.bounds.minY
        const minX = Math.max(0, Math.min(1 - width, interaction.bounds.minX + point.x - interaction.startX))
        const minY = Math.max(0, Math.min(1 - height, interaction.bounds.minY + point.y - interaction.startY))
        onCropChange({ ...cropBounds, minX, maxX: minX + width, minY, maxY: minY + height })
      } else {
        const next = { ...interaction.bounds }
        if (interaction.corner.includes('w')) next.minX = Math.min(point.x, next.maxX - minimum)
        if (interaction.corner.includes('e')) next.maxX = Math.max(point.x, next.minX + minimum)
        if (interaction.corner.includes('n')) next.minY = Math.min(point.y, next.maxY - minimum)
        if (interaction.corner.includes('s')) next.maxY = Math.max(point.y, next.minY + minimum)
        onCropChange(next)
      }
    }

    const finishInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current
      if (interaction?.type === 'measurement' && measurementDraft) {
        const pixelWidth = Math.abs(measurementDraft.end.x - measurementDraft.start.x) * width
        const pixelHeight = Math.abs(measurementDraft.end.y - measurementDraft.start.y) * height
        const largeEnough = measurementDraft.tool === 'distance'
          ? Math.hypot(pixelWidth, pixelHeight) >= 3
          : pixelWidth >= 3 && pixelHeight >= 3
        if (largeEnough) {
          measurementIdRef.current += 1
          setMeasurements((current) => [...current, {
            ...measurementDraft,
            id: measurementIdRef.current,
          }])
        }
        setMeasurementDraft(null)
      }
      interactionRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }

    const cancelInteraction = () => {
      interactionRef.current = null
      setMeasurementDraft(null)
    }

    const selectMeasurementTool = (tool: MeasurementTool) => {
      const next = measurementTool === tool ? null : tool
      setMeasurementTool(next)
      setMeasurementDraft(null)
      interactionRef.current = null
      if (next) onCropEditingChange(false)
    }

    const measurementSummary = (measurement: Measurement) => {
      const deltaX = (measurement.end.x - measurement.start.x) * Math.max(1, width - 1)
      const deltaY = (measurement.end.y - measurement.start.y) * Math.max(1, height - 1)
      if (measurement.tool === 'distance') {
        const millimeters = Math.hypot(deltaX * volume.spacing[0], deltaY * volume.spacing[1])
        return `${millimeters < 10 ? millimeters.toFixed(1) : millimeters.toFixed(0)} mm`
      }

      const minPixelX = Math.max(0, Math.min(width - 1, Math.floor(Math.min(measurement.start.x, measurement.end.x) * width)))
      const maxPixelX = Math.max(minPixelX, Math.min(width - 1, Math.ceil(Math.max(measurement.start.x, measurement.end.x) * width) - 1))
      const minPixelY = Math.max(0, Math.min(height - 1, Math.floor(Math.min(measurement.start.y, measurement.end.y) * height)))
      const maxPixelY = Math.max(minPixelY, Math.min(height - 1, Math.ceil(Math.max(measurement.start.y, measurement.end.y) * height) - 1))
      let signal = 0
      let count = 0
      const sliceOffset = measurement.slice * width * height
      for (let y = minPixelY; y <= maxPixelY; y += 1) {
        for (let x = minPixelX; x <= maxPixelX; x += 1) {
          signal += volume.data[sliceOffset + y * width + x]
          count += 1
        }
      }
      const area = count * volume.spacing[0] * volume.spacing[1]
      const mean = count ? signal / count : 0
      return `${area < 100 ? area.toFixed(1) : area.toFixed(0)} mm² · μ ${mean.toFixed(0)}`
    }

    const currentMeasurements = measurements.filter((measurement) => measurement.slice === safeIndex)
    const visibleMeasurements = measurementDraft?.slice === safeIndex
      ? [...currentMeasurements, measurementDraft]
      : currentMeasurements

    const cropped = cropBounds.minX > 0.001 || cropBounds.maxX < 0.999 ||
      cropBounds.minY > 0.001 || cropBounds.maxY < 0.999 ||
      cropBounds.minZ > 0.001 || cropBounds.maxZ < 0.999

    return (
      <section
        className="slice-viewer"
        aria-label="2D DICOM slice viewer"
        onWheel={(event) => {
          event.preventDefault()
          stepSlice(event.deltaY > 0 ? 1 : -1)
        }}
      >
        <div className="slice-viewport" ref={viewportRef}>
          <canvas ref={canvasRef} data-testid="slice-canvas" aria-label={`Slice ${safeIndex + 1} of ${depth}`} />
          {canvasRect ? (
            <div
              className={`crop-overlay${cropEditing ? ' editing' : ''}${measurementTool ? ' measuring' : ''}`}
              data-testid="crop-overlay"
              style={canvasRect}
              onPointerDown={beginInteraction}
              onPointerMove={updateInteraction}
              onPointerUp={finishInteraction}
              onPointerCancel={cancelInteraction}
            >
              {cropped || cropEditing ? (
                <div
                  className="crop-selection"
                  style={{
                    left: `${cropBounds.minX * 100}%`,
                    top: `${cropBounds.minY * 100}%`,
                    width: `${(cropBounds.maxX - cropBounds.minX) * 100}%`,
                    height: `${(cropBounds.maxY - cropBounds.minY) * 100}%`,
                  }}
                >
                  <i className="crop-handle handle-nw" /><i className="crop-handle handle-ne" />
                  <i className="crop-handle handle-sw" /><i className="crop-handle handle-se" />
                  <span>CROP VOLUME</span>
                </div>
              ) : null}
              {visibleMeasurements.length ? (
                <>
                  <svg
                    className="measurement-overlay"
                    viewBox={`0 0 ${width} ${height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {visibleMeasurements.map((measurement) => {
                      const x1 = measurement.start.x * width
                      const y1 = measurement.start.y * height
                      const x2 = measurement.end.x * width
                      const y2 = measurement.end.y * height
                      return measurement.tool === 'distance' ? (
                        <g key={measurement.id} className="distance-measurement">
                          <line x1={x1} y1={y1} x2={x2} y2={y2} />
                          <circle cx={x1} cy={y1} r="3.5" />
                          <circle cx={x2} cy={y2} r="3.5" />
                        </g>
                      ) : (
                        <rect
                          key={measurement.id}
                          className="roi-measurement"
                          x={Math.min(x1, x2)}
                          y={Math.min(y1, y2)}
                          width={Math.abs(x2 - x1)}
                          height={Math.abs(y2 - y1)}
                        />
                      )
                    })}
                  </svg>
                  {visibleMeasurements.map((measurement) => {
                    const labelX = measurement.tool === 'distance'
                      ? (measurement.start.x + measurement.end.x) * 0.5
                      : Math.max(measurement.start.x, measurement.end.x)
                    const labelY = measurement.tool === 'distance'
                      ? (measurement.start.y + measurement.end.y) * 0.5
                      : Math.min(measurement.start.y, measurement.end.y)
                    return (
                      <span
                        key={`label-${measurement.id}`}
                        className={`measurement-label ${measurement.tool}`}
                        style={{
                          left: `${Math.max(0.05, Math.min(0.95, labelX)) * 100}%`,
                          top: `${Math.max(0.05, Math.min(0.95, labelY)) * 100}%`,
                        }}
                      >
                        {measurementSummary(measurement)}
                      </span>
                    )
                  })}
                </>
              ) : null}
            </div>
          ) : null}
          <div className="measurement-toolbar" role="toolbar" aria-label="Slice measurement tools">
            <button
              type="button"
              className={measurementTool === 'distance' ? 'active' : ''}
              aria-label="Distance measurement"
              aria-pressed={measurementTool === 'distance'}
              title="Measure distance in millimeters"
              onClick={() => selectMeasurementTool('distance')}
            >
              <Ruler size={14} /><span>Distance</span>
            </button>
            <button
              type="button"
              className={measurementTool === 'roi' ? 'active' : ''}
              aria-label="ROI area measurement"
              aria-pressed={measurementTool === 'roi'}
              title="Measure ROI area and mean signal"
              onClick={() => selectMeasurementTool('roi')}
            >
              <SquareDashed size={14} /><span>ROI</span>
            </button>
            <button
              type="button"
              aria-label="Clear measurements on slice"
              title="Clear measurements on this slice"
              disabled={!currentMeasurements.length}
              onClick={() => setMeasurements((current) => current.filter((measurement) => measurement.slice !== safeIndex))}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <span className="orientation-marker marker-top">{labels.top}</span>
          <span className="orientation-marker marker-right">{labels.right}</span>
          <span className="orientation-marker marker-bottom">{labels.bottom}</span>
          <span className="orientation-marker marker-left">{labels.left}</span>
          <div className="slice-metadata slice-meta-left">
            <span>{volume.description}</span>
            <b>{volume.orientation.toUpperCase()}</b>
            <small>{width} × {height}</small>
          </div>
          <div className="slice-metadata slice-meta-right">
            <span>SL {String(safeIndex + 1).padStart(3, '0')} / {String(depth).padStart(3, '0')}</span>
            <b>{(safeIndex * volume.spacing[2]).toFixed(1)} mm</b>
            <small>W {Math.round(volumeSettings.window * 255)} · L {Math.round(volumeSettings.level * 255)}</small>
          </div>
        </div>

        <div className="slice-controls">
          <button type="button" aria-label="Previous slice" onClick={() => stepSlice(-1)}>
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className={cinePlaying ? 'active' : ''}
            aria-label={cinePlaying ? 'Pause cine' : 'Play cine'}
            aria-pressed={cinePlaying}
            title={cinePlaying ? 'Pause stack play' : 'Play through stack'}
            disabled={depth <= 1}
            onClick={toggleCine}
          >
            {cinePlaying ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <div className="slice-slider">
            <span>
              <MousePointer2 size={12} />
              {cinePlaying
                ? `Cine · ${cineFps} fps · loops at ends`
                : 'Scroll or drag the slider through slices'}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, depth - 1)}
              step={1}
              value={safeIndex}
              aria-label="Displayed slice"
              style={{ '--slice-progress': `${depth > 1 ? (safeIndex / (depth - 1)) * 100 : 0}%` } as React.CSSProperties}
              onChange={(event) => setSliceFromUser(Number(event.target.value))}
            />
          </div>
          <button type="button" aria-label="Next slice" onClick={() => stepSlice(1)}>
            <ChevronUp size={15} />
          </button>
          <label className="cine-fps">
            <span className="visually-hidden">Cine frames per second</span>
            <select
              aria-label="Cine frames per second"
              value={cineFps}
              disabled={depth <= 1}
              onChange={(event) => setCineFps(Number(event.target.value) as CineFps)}
            >
              {CINE_FPS_OPTIONS.map((fps) => (
                <option key={fps} value={fps}>{fps} fps</option>
              ))}
            </select>
          </label>
          <div className="slice-crop-actions">
            <button
              className={cropEditing ? 'active' : ''}
              type="button"
              aria-pressed={cropEditing}
              onClick={() => {
                setMeasurementTool(null)
                setMeasurementDraft(null)
                onCropEditingChange(!cropEditing)
              }}
            >
              <Crop size={14} /><span>Crop 3D</span>
            </button>
            {cropped ? (
              <button
                type="button"
                aria-label="Reset volume crop"
                title="Reset volume crop"
                onClick={() => onCropChange({
                  minX: 0,
                  maxX: 1,
                  minY: 0,
                  maxY: 1,
                  minZ: 0,
                  maxZ: 1,
                })}
              >
                <RotateCcw size={13} />
              </button>
            ) : null}
          </div>
          <output>{safeIndex + 1}<small> / {depth}</small></output>
        </div>
      </section>
    )
  },
)
