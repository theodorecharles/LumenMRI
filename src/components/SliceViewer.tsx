import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Crop,
  Crosshair,
  Maximize2,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Ruler,
  SquareDashed,
  Trash2,
} from 'lucide-react'
import { formatProbeScalar, samplePixelAt, type PixelProbeSample } from '../lib/pixelProbe'
import { compositeAnnotatedSlicePng } from '../lib/sliceCapture'
import type { CropBounds, VolumeData, VolumeSettings } from '../types'

const MIN_VIEW_SCALE = 1
const MAX_VIEW_SCALE = 8
const ZOOM_STEP = 1.12

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
  onVolumeSettingsChange: (patch: Partial<VolumeSettings>) => void
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

interface ViewTransform {
  scale: number
  x: number
  y: number
}

const FIT_VIEW: ViewTransform = { scale: 1, x: 0, y: 0 }

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

interface PinnedProbe {
  id: number
  slice: number
  x: number
  y: number
  sample: PixelProbeSample
}

type WindowLevelInteraction = {
  type: 'window-level'
  originX: number
  originY: number
  startWindow: number
  startLevel: number
}

type PointerInteraction = CropInteraction | WindowLevelInteraction | {
  type: 'measurement'
  tool: MeasurementTool
  slice: number
  start: MeasurementPoint
} | {
  type: 'pan'
  startClientX: number
  startClientY: number
  originX: number
  originY: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function zoomAboutPoint(
  view: ViewTransform,
  nextScale: number,
  cursorX: number,
  cursorY: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewTransform {
  const scale = clamp(nextScale, MIN_VIEW_SCALE, MAX_VIEW_SCALE)
  if (scale === view.scale) return view
  if (scale <= MIN_VIEW_SCALE) return FIT_VIEW

  const centerX = viewportWidth * 0.5
  const centerY = viewportHeight * 0.5
  const contentX = (cursorX - centerX - view.x) / view.scale
  const contentY = (cursorY - centerY - view.y) / view.scale
  return {
    scale,
    x: cursorX - centerX - contentX * scale,
    y: cursorY - centerY - contentY * scale,
  }
}

function clamp01(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function orientationLabels(orientation: string) {
  const name = orientation.toLowerCase()
  if (name.includes('sag')) return { top: 'S', right: 'P', bottom: 'I', left: 'A' }
  if (name.includes('cor')) return { top: 'S', right: 'L', bottom: 'I', left: 'R' }
  return { top: 'A', right: 'L', bottom: 'P', left: 'R' }
}

function measurementSummary(
  measurement: Measurement,
  volume: VolumeData,
  width: number,
  height: number,
) {
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

export const SliceViewer = forwardRef<SliceViewerHandle, SliceViewerProps>(
  function SliceViewer({
    volume,
    sliceIndex,
    onSliceChange,
    volumeSettings,
    onVolumeSettingsChange,
    cropBounds,
    onCropChange,
    cropEditing,
    onCropEditingChange,
    viewerLayout,
  }, forwardedRef) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const viewportRef = useRef<HTMLDivElement>(null)
    const stageRef = useRef<HTMLDivElement>(null)
    const interactionRef = useRef<PointerInteraction | null>(null)
    const measurementIdRef = useRef(0)
    const probeIdRef = useRef(0)
    const sliceIndexRef = useRef(sliceIndex)
    const viewRef = useRef<ViewTransform>(FIT_VIEW)
    const [canvasRect, setCanvasRect] = useState<CanvasRect | null>(null)
    const [view, setView] = useState<ViewTransform>(FIT_VIEW)
    const [panning, setPanning] = useState(false)
    const [measurementTool, setMeasurementTool] = useState<MeasurementTool | null>(null)
    const [probeTool, setProbeTool] = useState(false)
    const [measurements, setMeasurements] = useState<Measurement[]>([])
    const [measurementDraft, setMeasurementDraft] = useState<Measurement | null>(null)
    const [probeHover, setProbeHover] = useState<{
      x: number
      y: number
      sample: PixelProbeSample
    } | null>(null)
    const [pinnedProbes, setPinnedProbes] = useState<PinnedProbe[]>([])
    const [windowLevelDrag, setWindowLevelDrag] = useState<{ window: number; level: number } | null>(null)
    const [cinePlaying, setCinePlaying] = useState(false)
    const [cineFps, setCineFps] = useState<CineFps>(10)
    const [width, height, depth] = volume.dimensions
    const safeIndex = Math.max(0, Math.min(depth - 1, sliceIndex))
    const labels = orientationLabels(volume.orientation)
    sliceIndexRef.current = safeIndex
    const viewTransformed = view.scale > MIN_VIEW_SCALE + 0.001 || Math.abs(view.x) > 0.5 || Math.abs(view.y) > 0.5
    viewRef.current = view

    useImperativeHandle(
      forwardedRef,
      () => ({
        capture: () => {
          const canvas = canvasRef.current
          if (!canvas) return
          const current = measurements.filter((measurement) => measurement.slice === safeIndex)
          const visible = measurementDraft?.slice === safeIndex
            ? [...current, measurementDraft]
            : current
          const link = document.createElement('a')
          link.download = `lumen-${volume.description.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-slice-${safeIndex + 1}.png`
          link.href = compositeAnnotatedSlicePng({
            source: canvas,
            seriesName: volume.description,
            sliceIndex: safeIndex,
            sliceCount: depth,
            window: volumeSettings.window,
            level: volumeSettings.level,
            labels,
            measurements: visible.map((measurement) => ({
              id: measurement.id,
              tool: measurement.tool,
              start: measurement.start,
              end: measurement.end,
              label: measurementSummary(measurement, volume, width, height),
            })),
          })
          link.click()
        },
      }),
      [
        depth,
        height,
        labels,
        measurementDraft,
        measurements,
        safeIndex,
        volume,
        volumeSettings.level,
        volumeSettings.window,
        width,
      ],
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
      const stage = stageRef.current
      if (!canvas || !stage) return
      const updateRect = () => {
        // Layout offsets (pre-transform) so the overlay rides with CSS pan/zoom.
        setCanvasRect({
          left: canvas.offsetLeft,
          top: canvas.offsetTop,
          width: canvas.offsetWidth,
          height: canvas.offsetHeight,
        })
      }
      const observer = new ResizeObserver(updateRect)
      observer.observe(canvas)
      observer.observe(stage)
      updateRect()
      return () => observer.disconnect()
    }, [height, width])

    useEffect(() => {
      setMeasurements([])
      setMeasurementDraft(null)
      setMeasurementTool(null)
      setProbeTool(false)
      setProbeHover(null)
      setPinnedProbes([])
      interactionRef.current = null
      setCinePlaying(false)
      setView(FIT_VIEW)
      setPanning(false)
    }, [volume.seriesId])

    useEffect(() => {
      setCinePlaying(false)
    }, [viewerLayout])

    useEffect(() => {
      if (depth <= 1) setCinePlaying(false)
    }, [depth])

    useEffect(() => {
      setMeasurementDraft(null)
      setProbeHover(null)
      if (interactionRef.current?.type === 'measurement') interactionRef.current = null
    }, [safeIndex])

    // Keep live probe display gray in sync when W/L sliders change under a parked cursor.
    useEffect(() => {
      setProbeHover((current) => {
        if (!current) return null
        const sample = samplePixelAt(
          volume,
          safeIndex,
          current.x,
          current.y,
          volumeSettings.window,
          volumeSettings.level,
        )
        if (!sample) return null
        return { x: current.x, y: current.y, sample }
      })
    }, [safeIndex, volume, volumeSettings.level, volumeSettings.window])

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

    const resetView = () => {
      setView(FIT_VIEW)
      setPanning(false)
      if (interactionRef.current?.type === 'pan') interactionRef.current = null
    }

    const cropPoint = (event: React.PointerEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      // Post-transform screen rect keeps measure/crop coords correct under pan/zoom.
      const bounds = canvas.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 }
      return {
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      }
    }

    const beginWindowLevel = (event: React.PointerEvent<HTMLDivElement>) => {
      interactionRef.current = {
        type: 'window-level',
        originX: event.clientX,
        originY: event.clientY,
        startWindow: volumeSettings.window,
        startLevel: volumeSettings.level,
      }
      setWindowLevelDrag({ window: volumeSettings.window, level: volumeSettings.level })
      setProbeHover(null)
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    }

    const pinProbeAt = (point: MeasurementPoint): PixelProbeSample | null => {
      const sample = samplePixelAt(
        volume,
        safeIndex,
        point.x,
        point.y,
        volumeSettings.window,
        volumeSettings.level,
      )
      if (!sample) return null
      probeIdRef.current += 1
      setPinnedProbes((current) => [
        ...current,
        {
          id: probeIdRef.current,
          slice: safeIndex,
          x: point.x,
          y: point.y,
          sample,
        },
      ])
      return sample
    }

    const updateProbeHover = (event: React.PointerEvent<HTMLDivElement>) => {
      // Hide while panning, measuring, cropping drag, or window/level drag.
      if (interactionRef.current || measurementDraft || windowLevelDrag || panning) {
        setProbeHover(null)
        return
      }
      const point = cropPoint(event)
      const sample = samplePixelAt(
        volume,
        safeIndex,
        point.x,
        point.y,
        volumeSettings.window,
        volumeSettings.level,
      )
      if (!sample) {
        setProbeHover(null)
        return
      }
      setProbeHover({ x: point.x, y: point.y, sample })
    }

    const beginInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
      const wantsWindowLevel = event.button === 2 || (event.button === 0 && event.shiftKey)
      if (wantsWindowLevel) {
        beginWindowLevel(event)
        return
      }
      if (event.button !== 0) return

      const point = cropPoint(event)
      if (probeTool) {
        const sample = pinProbeAt(point)
        if (sample) setProbeHover({ x: point.x, y: point.y, sample })
        event.preventDefault()
        return
      }
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
        setProbeHover(null)
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      if (cropEditing) {
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
        return
      }
      if (viewRef.current.scale > MIN_VIEW_SCALE) {
        interactionRef.current = {
          type: 'pan',
          startClientX: event.clientX,
          startClientY: event.clientY,
          originX: viewRef.current.x,
          originY: viewRef.current.y,
        }
        setPanning(true)
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    }

    const updateInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current
      if (!interaction) {
        updateProbeHover(event)
        return
      }
      if (probeHover) setProbeHover(null)
      if (interaction.type === 'window-level') {
        const scaleX = Math.max(120, canvasRect?.width ?? 240)
        const scaleY = Math.max(120, canvasRect?.height ?? 240)
        const nextWindow = clamp01(
          interaction.startWindow + ((event.clientX - interaction.originX) / scaleX) * 1.15,
          0.1,
          1,
        )
        const nextLevel = clamp01(
          interaction.startLevel - ((event.clientY - interaction.originY) / scaleY) * 1.15,
        )
        setWindowLevelDrag({ window: nextWindow, level: nextLevel })
        onVolumeSettingsChange({ window: nextWindow, level: nextLevel })
        return
      }
      if (interaction.type === 'pan') {
        setView({
          scale: viewRef.current.scale,
          x: interaction.originX + (event.clientX - interaction.startClientX),
          y: interaction.originY + (event.clientY - interaction.startClientY),
        })
        return
      }
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
        const boxWidth = interaction.bounds.maxX - interaction.bounds.minX
        const boxHeight = interaction.bounds.maxY - interaction.bounds.minY
        const minX = Math.max(0, Math.min(1 - boxWidth, interaction.bounds.minX + point.x - interaction.startX))
        const minY = Math.max(0, Math.min(1 - boxHeight, interaction.bounds.minY + point.y - interaction.startY))
        onCropChange({ ...cropBounds, minX, maxX: minX + boxWidth, minY, maxY: minY + boxHeight })
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
      if (interaction?.type === 'window-level') {
        setWindowLevelDrag(null)
        interactionRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        return
      }
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
      if (interaction?.type === 'pan') setPanning(false)
      interactionRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }

    const cancelInteraction = () => {
      if (interactionRef.current?.type === 'pan') setPanning(false)
      interactionRef.current = null
      setMeasurementDraft(null)
      setWindowLevelDrag(null)
      setProbeHover(null)
    }

    const clearProbeHover = () => {
      setProbeHover(null)
    }

    const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const viewport = viewportRef.current
        if (!viewport) return
        const bounds = viewport.getBoundingClientRect()
        const factor = event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
        setView((current) => zoomAboutPoint(
          current,
          current.scale * factor,
          event.clientX - bounds.left,
          event.clientY - bounds.top,
          bounds.width,
          bounds.height,
        ))
        return
      }
      stepSlice(event.deltaY > 0 ? 1 : -1)
    }

    const selectMeasurementTool = (tool: MeasurementTool) => {
      const next = measurementTool === tool ? null : tool
      setMeasurementTool(next)
      setMeasurementDraft(null)
      setProbeTool(false)
      interactionRef.current = null
      if (next) onCropEditingChange(false)
    }

    const toggleProbeTool = () => {
      const next = !probeTool
      setProbeTool(next)
      setMeasurementTool(null)
      setMeasurementDraft(null)
      interactionRef.current = null
      if (next) onCropEditingChange(false)
    }

    const currentMeasurements = measurements.filter((measurement) => measurement.slice === safeIndex)
    const visibleMeasurements = measurementDraft?.slice === safeIndex
      ? [...currentMeasurements, measurementDraft]
      : currentMeasurements
    const currentPinnedProbes = pinnedProbes.filter((probe) => probe.slice === safeIndex)
    const hasSliceAnnotations = currentMeasurements.length > 0 || currentPinnedProbes.length > 0

    const clearSliceAnnotations = () => {
      setMeasurements((current) => current.filter((measurement) => measurement.slice !== safeIndex))
      setPinnedProbes((current) => current.filter((probe) => probe.slice !== safeIndex))
    }

    const cropped = cropBounds.minX > 0.001 || cropBounds.maxX < 0.999 ||
      cropBounds.minY > 0.001 || cropBounds.maxY < 0.999 ||
      cropBounds.minZ > 0.001 || cropBounds.maxZ < 0.999

    const canPan = view.scale > MIN_VIEW_SCALE && !cropEditing && !measurementTool && !probeTool
    const probeBlocked = Boolean(
      windowLevelDrag || panning || measurementDraft || interactionRef.current,
    )
    const liveProbe = !probeBlocked ? probeHover : null
    const showScalar = Math.abs(volume.scalarRange[1] - volume.scalarRange[0] - 255) > 1
      || Math.abs(volume.scalarRange[0]) > 0.5

    return (
      <section
        className="slice-viewer"
        aria-label="2D DICOM slice viewer"
        onWheel={handleWheel}
      >
        <div className="slice-viewport" ref={viewportRef}>
          <div
            className={`slice-stage${canPan ? ' pannable' : ''}${panning ? ' panning' : ''}${windowLevelDrag ? ' window-leveling' : ''}${probeTool ? ' probing' : ''}`}
            ref={stageRef}
            data-testid="slice-stage"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              ...(windowLevelDrag ? { cursor: 'ns-resize' } : null),
              ...(probeTool && !windowLevelDrag ? { cursor: 'crosshair' } : null),
            }}
            onPointerDown={beginInteraction}
            onPointerMove={updateInteraction}
            onPointerUp={finishInteraction}
            onPointerCancel={cancelInteraction}
            onPointerLeave={clearProbeHover}
            onContextMenu={(event) => event.preventDefault()}
          >
            <canvas ref={canvasRef} data-testid="slice-canvas" aria-label={`Slice ${safeIndex + 1} of ${depth}`} />
            {canvasRect ? (
              <div
                className={`crop-overlay${cropEditing ? ' editing' : ''}${measurementTool ? ' measuring' : ''}${probeTool ? ' probing' : ''}${windowLevelDrag ? ' window-leveling' : ''}${canPan ? ' panning-ready' : ''}`}
                data-testid="crop-overlay"
                style={canvasRect}
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
                          {measurementSummary(measurement, volume, width, height)}
                        </span>
                      )
                    })}
                  </>
                ) : null}
                {windowLevelDrag ? (
                  <div className="window-level-readout" data-testid="window-level-readout" role="status" aria-live="polite">
                    <span>W {Math.round(windowLevelDrag.window * 255)}</span>
                    <span>L {Math.round(windowLevelDrag.level * 255)}</span>
                  </div>
                ) : null}
                {currentPinnedProbes.map((probe) => (
                  <div
                    key={probe.id}
                    className="pixel-probe-pin"
                    data-testid="pixel-probe-pin"
                    style={{
                      left: `${probe.x * 100}%`,
                      top: `${probe.y * 100}%`,
                    }}
                  >
                    <i className="pixel-probe-cross" aria-hidden="true" />
                    <span className="pixel-probe-pin-label">
                      I {probe.sample.intensity}
                      {showScalar ? ` · ${formatProbeScalar(probe.sample.scalar)}` : ''}
                      <small>
                        c {probe.sample.col} · r {probe.sample.row}
                      </small>
                    </span>
                  </div>
                ))}
                {liveProbe ? (
                  <div
                    className="pixel-probe-readout"
                    data-testid="pixel-probe-readout"
                    role="status"
                    aria-live="polite"
                    style={{
                      left: `${Math.min(0.72, Math.max(0.02, liveProbe.x + 0.03)) * 100}%`,
                      top: `${Math.min(0.78, Math.max(0.02, liveProbe.y + 0.03)) * 100}%`,
                    }}
                  >
                    <span>
                      I {liveProbe.sample.intensity}
                      <em>D {liveProbe.sample.display}</em>
                    </span>
                    {showScalar ? (
                      <span className="pixel-probe-scalar">
                        {formatProbeScalar(liveProbe.sample.scalar)}
                      </span>
                    ) : null}
                    <span className="pixel-probe-coords">
                      c {liveProbe.sample.col} · r {liveProbe.sample.row}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
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
              className={probeTool ? 'active' : ''}
              aria-label="Pixel intensity probe"
              aria-pressed={probeTool}
              title="Probe pixel intensity (hover live; click to pin)"
              data-testid="probe-tool"
              onClick={toggleProbeTool}
            >
              <Crosshair size={14} /><span>Probe</span>
            </button>
            <button
              type="button"
              aria-label="Clear measurements on slice"
              title="Clear measurements and pins on this slice"
              disabled={!hasSliceAnnotations}
              onClick={clearSliceAnnotations}
            >
              <Trash2 size={13} />
            </button>
            {viewTransformed ? (
              <button
                type="button"
                aria-label="Reset pan and zoom"
                title="Reset pan and zoom (fit to view)"
                data-testid="reset-view"
                onClick={resetView}
              >
                <Maximize2 size={13} /><span>Fit</span>
              </button>
            ) : null}
          </div>
          {viewTransformed ? (
            <div className="slice-view-badge" data-testid="view-zoom-badge" aria-live="polite">
              {Math.round(view.scale * 100)}%
            </div>
          ) : null}
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
                : 'Scroll slices · Ctrl/⌘+scroll zoom · drag to pan'}
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
                setProbeTool(false)
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
