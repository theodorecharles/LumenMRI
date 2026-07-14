import type { ReconstructedVolume, Vec3Tuple } from '../types'

export interface ReconstructionOptions {
  maxDimension: number
  maxVoxels: number
  maxSliceFactor?: number
}

export interface ReconstructionPlan {
  width: number
  height: number
  depth: number
  factor: number
  spacing: Vec3Tuple
}

interface FlowField {
  data: Float32Array
  gridWidth: number
  gridHeight: number
  step: number
}

const FLOW_STEP = 16
const FLOW_SEARCH_RADIUS = 4
const PATCH_OFFSETS = [
  [0, 0],
  [-2, 0],
  [2, 0],
  [0, -2],
  [0, 2],
  [-4, 0],
  [4, 0],
  [0, -4],
  [0, 4],
] as const

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

export function planVolumeReconstruction(
  dimensions: Vec3Tuple,
  spacing: Vec3Tuple,
  options: ReconstructionOptions,
): ReconstructionPlan {
  const [sourceWidth, sourceHeight, sourceDepth] = dimensions
  const scale = Math.min(1, options.maxDimension / sourceWidth, options.maxDimension / sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const renderSpacingX = spacing[0] * sourceWidth / width
  const renderSpacingY = spacing[1] * sourceHeight / height
  const desiredFactor = clamp(
    Math.round(spacing[2] / Math.max(renderSpacingX, renderSpacingY)),
    1,
    options.maxSliceFactor ?? 4,
  )
  const sliceSize = width * height
  const budgetFactor = sourceDepth > 1
    ? Math.max(1, Math.floor((options.maxVoxels / sliceSize - 1) / (sourceDepth - 1)))
    : 1
  const factor = Math.min(desiredFactor, budgetFactor)
  const depth = sourceDepth > 1 ? (sourceDepth - 1) * factor + 1 : 1

  return {
    width,
    height,
    depth,
    factor,
    spacing: [renderSpacingX, renderSpacingY, spacing[2] / factor],
  }
}

function sampleNearest(
  slice: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const safeX = clamp(Math.round(x), 0, width - 1)
  const safeY = clamp(Math.round(y), 0, height - 1)
  return slice[safeX + safeY * width]
}

function sampleBilinear(
  slice: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const safeX = clamp(x, 0, width - 1)
  const safeY = clamp(y, 0, height - 1)
  const x0 = Math.floor(safeX)
  const y0 = Math.floor(safeY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = safeX - x0
  const ty = safeY - y0
  const top = slice[x0 + y0 * width] * (1 - tx) + slice[x1 + y0 * width] * tx
  const bottom = slice[x0 + y1 * width] * (1 - tx) + slice[x1 + y1 * width] * tx
  return top * (1 - ty) + bottom * ty
}

function downsampleVolume(
  source: Uint8Array,
  dimensions: Vec3Tuple,
  width: number,
  height: number,
) {
  const [sourceWidth, sourceHeight, depth] = dimensions
  if (sourceWidth === width && sourceHeight === height) return source
  const sourceSliceSize = sourceWidth * sourceHeight
  const targetSliceSize = width * height
  const output = new Uint8Array(targetSliceSize * depth)
  const scaleX = sourceWidth / width
  const scaleY = sourceHeight / height

  for (let z = 0; z < depth; z += 1) {
    const sourceSlice = source.subarray(z * sourceSliceSize, (z + 1) * sourceSliceSize)
    const targetOffset = z * targetSliceSize
    for (let y = 0; y < height; y += 1) {
      const sourceY = (y + 0.5) * scaleY - 0.5
      for (let x = 0; x < width; x += 1) {
        const sourceX = (x + 0.5) * scaleX - 0.5
        output[targetOffset + x + y * width] = Math.round(
          sampleBilinear(sourceSlice, sourceWidth, sourceHeight, sourceX, sourceY),
        )
      }
    }
  }
  return output
}

function estimateFlow(
  from: Uint8Array,
  to: Uint8Array,
  width: number,
  height: number,
): FlowField {
  const gridWidth = Math.ceil((width - 1) / FLOW_STEP) + 1
  const gridHeight = Math.ceil((height - 1) / FLOW_STEP) + 1
  let flow = new Float32Array(gridWidth * gridHeight * 2)
  let confidence = new Float32Array(gridWidth * gridHeight)

  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    const y = Math.min(height - 1, gridY * FLOW_STEP)
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const x = Math.min(width - 1, gridX * FLOW_STEP)
      let localMinimum = 255
      let localMaximum = 0
      for (const [patchX, patchY] of PATCH_OFFSETS) {
        const value = sampleNearest(from, width, height, x + patchX, y + patchY)
        localMinimum = Math.min(localMinimum, value)
        localMaximum = Math.max(localMaximum, value)
      }
      if (localMaximum - localMinimum < 7) continue

      let bestCost = Number.POSITIVE_INFINITY
      let bestX = 0
      let bestY = 0
      for (let offsetY = -FLOW_SEARCH_RADIUS; offsetY <= FLOW_SEARCH_RADIUS; offsetY += 1) {
        for (let offsetX = -FLOW_SEARCH_RADIUS; offsetX <= FLOW_SEARCH_RADIUS; offsetX += 1) {
          let cost = (offsetX * offsetX + offsetY * offsetY) * 0.28
          for (const [patchX, patchY] of PATCH_OFFSETS) {
            const sourceValue = sampleNearest(from, width, height, x + patchX, y + patchY)
            const targetValue = sampleNearest(
              to,
              width,
              height,
              x + patchX + offsetX,
              y + patchY + offsetY,
            )
            cost += Math.abs(sourceValue - targetValue)
          }
          if (cost < bestCost) {
            bestCost = cost
            bestX = offsetX
            bestY = offsetY
          }
        }
      }
      const index = (gridX + gridY * gridWidth) * 2
      flow[index] = bestX
      flow[index + 1] = bestY
      confidence[gridX + gridY * gridWidth] = 1
    }
  }

  for (let pass = 0; pass < 2; pass += 1) {
    const smoothed = new Float32Array(flow.length)
    const smoothedConfidence = new Float32Array(confidence.length)
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        let weight = 0
        let sumX = 0
        let sumY = 0
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = clamp(x + offsetX, 0, gridWidth - 1)
            const sampleY = clamp(y + offsetY, 0, gridHeight - 1)
            const sampleIndex = (sampleX + sampleY * gridWidth) * 2
            const sampleConfidence = confidence[sampleX + sampleY * gridWidth]
            const sampleWeight = (offsetX === 0 && offsetY === 0 ? 4 : 1) * sampleConfidence
            sumX += flow[sampleIndex] * sampleWeight
            sumY += flow[sampleIndex + 1] * sampleWeight
            weight += sampleWeight
          }
        }
        const targetIndex = (x + y * gridWidth) * 2
        if (weight > 0) {
          smoothed[targetIndex] = sumX / weight
          smoothed[targetIndex + 1] = sumY / weight
          smoothedConfidence[x + y * gridWidth] = 1
        }
      }
    }
    flow = smoothed
    confidence = smoothedConfidence
  }

  return { data: flow, gridWidth, gridHeight, step: FLOW_STEP }
}

function sampleFlow(field: FlowField, x: number, y: number) {
  const gridX = clamp(x / field.step, 0, field.gridWidth - 1)
  const gridY = clamp(y / field.step, 0, field.gridHeight - 1)
  const x0 = Math.floor(gridX)
  const y0 = Math.floor(gridY)
  const x1 = Math.min(field.gridWidth - 1, x0 + 1)
  const y1 = Math.min(field.gridHeight - 1, y0 + 1)
  const tx = gridX - x0
  const ty = gridY - y0
  const read = (sampleX: number, sampleY: number, component: number) =>
    field.data[(sampleX + sampleY * field.gridWidth) * 2 + component]
  const topX = read(x0, y0, 0) * (1 - tx) + read(x1, y0, 0) * tx
  const topY = read(x0, y0, 1) * (1 - tx) + read(x1, y0, 1) * tx
  const bottomX = read(x0, y1, 0) * (1 - tx) + read(x1, y1, 0) * tx
  const bottomY = read(x0, y1, 1) * (1 - tx) + read(x1, y1, 1) * tx
  return [topX * (1 - ty) + bottomX * ty, topY * (1 - ty) + bottomY * ty] as const
}

function sharpenSyntheticSlice(slice: Uint8Array, width: number, height: number, strength: number) {
  const sharpened = slice.slice()
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = x + y * width
      const center = slice[index]
      const north = slice[index - width]
      const south = slice[index + width]
      const west = slice[index - 1]
      const east = slice[index + 1]
      const average = (north + south + west + east) * 0.25
      const detail = center - average
      const edgeWeight = clamp(Math.abs(detail) / 18, 0, 1)
      const localMinimum = Math.min(center, north, south, west, east)
      const localMaximum = Math.max(center, north, south, west, east)
      sharpened[index] = Math.round(clamp(
        center + detail * strength * edgeWeight,
        localMinimum,
        localMaximum,
      ))
    }
  }
  return sharpened
}

export async function reconstructVolume(
  seriesId: string,
  source: Uint8Array,
  dimensions: Vec3Tuple,
  spacing: Vec3Tuple,
  options: ReconstructionOptions,
  onProgress?: (progress: number) => void,
): Promise<ReconstructedVolume> {
  const plan = planVolumeReconstruction(dimensions, spacing, options)
  const [, , sourceDepth] = dimensions
  const sliceSize = plan.width * plan.height
  const base = downsampleVolume(source, dimensions, plan.width, plan.height)
  const output = new Uint8Array(sliceSize * plan.depth)

  if (sourceDepth <= 1 || plan.factor === 1) {
    output.set(base)
    return {
      seriesId,
      data: output,
      dimensions: [plan.width, plan.height, plan.depth],
      spacing: plan.spacing,
      sourceDepth,
      factor: 1,
      syntheticSlices: 0,
    }
  }

  for (let pair = 0; pair < sourceDepth - 1; pair += 1) {
    const lower = base.subarray(pair * sliceSize, (pair + 1) * sliceSize)
    const upper = base.subarray((pair + 1) * sliceSize, (pair + 2) * sliceSize)
    output.set(lower, pair * plan.factor * sliceSize)
    const forwardFlow = estimateFlow(lower, upper, plan.width, plan.height)
    const backwardFlow = estimateFlow(upper, lower, plan.width, plan.height)

    for (let step = 1; step < plan.factor; step += 1) {
      const t = step / plan.factor
      const generated = new Uint8Array(sliceSize)
      for (let y = 0; y < plan.height; y += 1) {
        for (let x = 0; x < plan.width; x += 1) {
          const [forwardX, forwardY] = sampleFlow(forwardFlow, x, y)
          const [backwardX, backwardY] = sampleFlow(backwardFlow, x, y)
          const fromLower = sampleBilinear(
            lower,
            plan.width,
            plan.height,
            x - forwardX * t,
            y - forwardY * t,
          )
          const fromUpper = sampleBilinear(
            upper,
            plan.width,
            plan.height,
            x - backwardX * (1 - t),
            y - backwardY * (1 - t),
          )
          generated[x + y * plan.width] = Math.round(fromLower * (1 - t) + fromUpper * t)
        }
      }
      const edgeStrength = 0.62 * 4 * t * (1 - t)
      output.set(
        sharpenSyntheticSlice(generated, plan.width, plan.height, edgeStrength),
        (pair * plan.factor + step) * sliceSize,
      )
    }

    output.set(upper, (pair + 1) * plan.factor * sliceSize)
    onProgress?.((pair + 1) / (sourceDepth - 1))
    if (pair % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return {
    seriesId,
    data: output,
    dimensions: [plan.width, plan.height, plan.depth],
    spacing: plan.spacing,
    sourceDepth,
    factor: plan.factor,
    syntheticSlices: plan.depth - sourceDepth,
  }
}
