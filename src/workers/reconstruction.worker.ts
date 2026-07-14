import { reconstructVolume, type ReconstructionOptions } from '../lib/reconstructVolume'
import type { Vec3Tuple } from '../types'

interface ReconstructionRequest {
  requestId: number
  seriesId: string
  data: Uint8Array
  dimensions: Vec3Tuple
  spacing: Vec3Tuple
  options: ReconstructionOptions
}

self.addEventListener('message', (event: MessageEvent<ReconstructionRequest>) => {
  const request = event.data
  reconstructVolume(
    request.seriesId,
    request.data,
    request.dimensions,
    request.spacing,
    request.options,
    (progress) => self.postMessage({ type: 'progress', requestId: request.requestId, progress }),
  )
    .then((volume) => {
      self.postMessage(
        { type: 'complete', requestId: request.requestId, volume },
        { transfer: [volume.data.buffer] },
      )
    })
    .catch((error: unknown) => {
      self.postMessage({
        type: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : '3D reconstruction failed.',
      })
    })
})

export {}
