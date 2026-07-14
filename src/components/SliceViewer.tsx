import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { ChevronDown, ChevronUp, MousePointer2 } from 'lucide-react'
import type { VolumeData, VolumeSettings } from '../types'

export interface SliceViewerHandle {
  capture: () => void
}

interface SliceViewerProps {
  volume: VolumeData
  sliceIndex: number
  onSliceChange: (index: number) => void
  volumeSettings: VolumeSettings
}

function orientationLabels(orientation: string) {
  const name = orientation.toLowerCase()
  if (name.includes('sag')) return { top: 'S', right: 'P', bottom: 'I', left: 'A' }
  if (name.includes('cor')) return { top: 'S', right: 'L', bottom: 'I', left: 'R' }
  return { top: 'A', right: 'L', bottom: 'P', left: 'R' }
}

export const SliceViewer = forwardRef<SliceViewerHandle, SliceViewerProps>(
  function SliceViewer({ volume, sliceIndex, onSliceChange, volumeSettings }, forwardedRef) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
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

    const stepSlice = (amount: number) => {
      onSliceChange(Math.max(0, Math.min(depth - 1, safeIndex + amount)))
    }

    return (
      <section
        className="slice-viewer"
        aria-label="2D DICOM slice viewer"
        onWheel={(event) => {
          event.preventDefault()
          stepSlice(event.deltaY > 0 ? 1 : -1)
        }}
      >
        <div className="slice-viewport">
          <canvas ref={canvasRef} data-testid="slice-canvas" aria-label={`Slice ${safeIndex + 1} of ${depth}`} />
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
          <div>
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
          <output>{safeIndex + 1}<small> / {depth}</small></output>
        </div>
      </section>
    )
  },
)
