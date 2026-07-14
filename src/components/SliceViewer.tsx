import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Crop, MousePointer2, RotateCcw } from 'lucide-react'
import type { CropBounds, VolumeData, VolumeSettings } from '../types'

export interface SliceViewerHandle {
  capture: () => void
}

interface SliceViewerProps {
  volume: VolumeData
  sliceIndex: number
  onSliceChange: (index: number) => void
  volumeSettings: VolumeSettings
  cropBounds: CropBounds
  onCropChange: (bounds: CropBounds) => void
  cropEditing: boolean
  onCropEditingChange: (editing: boolean) => void
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
  }, forwardedRef) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const viewportRef = useRef<HTMLDivElement>(null)
    const interactionRef = useRef<CropInteraction | null>(null)
    const [canvasRect, setCanvasRect] = useState<CanvasRect | null>(null)
    const [width, height, depth] = volume.dimensions
    const safeIndex = Math.max(0, Math.min(depth - 1, sliceIndex))
    const labels = orientationLabels(volume.orientation)

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

    const stepSlice = (amount: number) => {
      onSliceChange(Math.max(0, Math.min(depth - 1, safeIndex + amount)))
    }

    const cropPoint = (event: React.PointerEvent) => {
      if (!canvasRect) return { x: 0, y: 0 }
      const viewportBounds = viewportRef.current?.getBoundingClientRect()
      return {
        x: Math.max(0, Math.min(1, (event.clientX - (viewportBounds?.left || 0) - canvasRect.left) / canvasRect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - (viewportBounds?.top || 0) - canvasRect.top) / canvasRect.height)),
      }
    }

    const beginCrop = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!cropEditing) return
      const point = cropPoint(event)
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

    const updateCrop = (event: React.PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current
      if (!cropEditing || !interaction) return
      const point = cropPoint(event)
      const minimum = 0.035
      if (interaction.type === 'draw') {
        const minX = Math.min(interaction.startX, point.x)
        const maxX = Math.max(interaction.startX, point.x)
        const minY = Math.min(interaction.startY, point.y)
        const maxY = Math.max(interaction.startY, point.y)
        if (maxX - minX >= minimum && maxY - minY >= minimum) onCropChange({ minX, maxX, minY, maxY })
      } else if (interaction.type === 'move') {
        const width = interaction.bounds.maxX - interaction.bounds.minX
        const height = interaction.bounds.maxY - interaction.bounds.minY
        const minX = Math.max(0, Math.min(1 - width, interaction.bounds.minX + point.x - interaction.startX))
        const minY = Math.max(0, Math.min(1 - height, interaction.bounds.minY + point.y - interaction.startY))
        onCropChange({ minX, maxX: minX + width, minY, maxY: minY + height })
      } else {
        const next = { ...interaction.bounds }
        if (interaction.corner.includes('w')) next.minX = Math.min(point.x, next.maxX - minimum)
        if (interaction.corner.includes('e')) next.maxX = Math.max(point.x, next.minX + minimum)
        if (interaction.corner.includes('n')) next.minY = Math.min(point.y, next.maxY - minimum)
        if (interaction.corner.includes('s')) next.maxY = Math.max(point.y, next.minY + minimum)
        onCropChange(next)
      }
    }

    const cropped = cropBounds.minX > 0.001 || cropBounds.maxX < 0.999 || cropBounds.minY > 0.001 || cropBounds.maxY < 0.999

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
              className={cropEditing ? 'crop-overlay editing' : 'crop-overlay'}
              data-testid="crop-overlay"
              style={canvasRect}
              onPointerDown={beginCrop}
              onPointerMove={updateCrop}
              onPointerUp={(event) => {
                interactionRef.current = null
                event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={() => { interactionRef.current = null }}
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
          <div className="slice-slider">
            <span><MousePointer2 size={12} /> Scroll or drag the slider through slices</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, depth - 1)}
              step={1}
              value={safeIndex}
              aria-label="Displayed slice"
              style={{ '--slice-progress': `${depth > 1 ? (safeIndex / (depth - 1)) * 100 : 0}%` } as React.CSSProperties}
              onChange={(event) => onSliceChange(Number(event.target.value))}
            />
          </div>
          <button type="button" aria-label="Next slice" onClick={() => stepSlice(1)}>
            <ChevronUp size={15} />
          </button>
          <div className="slice-crop-actions">
            <button
              className={cropEditing ? 'active' : ''}
              type="button"
              aria-pressed={cropEditing}
              onClick={() => onCropEditingChange(!cropEditing)}
            >
              <Crop size={14} /><span>Crop 3D</span>
            </button>
            {cropped ? (
              <button
                type="button"
                aria-label="Reset volume crop"
                title="Reset volume crop"
                onClick={() => onCropChange({ minX: 0, maxX: 1, minY: 0, maxY: 1 })}
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
