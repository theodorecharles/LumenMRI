/**
 * Session stash for 2D annotations keyed by seriesId.
 * Survives active-series hops within a study; cleared only on library home / new scan.
 */

export type StashedMeasurementTool = 'distance' | 'roi' | 'angle'

export interface StashedPoint {
  x: number
  y: number
}

export interface StashedMeasurement {
  id: number
  tool: StashedMeasurementTool
  slice: number
  start: StashedPoint
  end: StashedPoint
  /** Shared vertex for angle (start—vertex—end). */
  vertex?: StashedPoint
}

export interface StashedProbeSample {
  col: number
  row: number
  intensity: number
  display: number
  scalar: number
}

export interface StashedPinnedProbe {
  id: number
  slice: number
  x: number
  y: number
  sample: StashedProbeSample
}

export interface SeriesAnnotationSnapshot {
  measurements: StashedMeasurement[]
  pinnedProbes: StashedPinnedProbe[]
}

export type AnnotationStash = Map<string, SeriesAnnotationSnapshot>

const stashGenerations = new WeakMap<AnnotationStash, number>()

export function createAnnotationStash(): AnnotationStash {
  const stash: AnnotationStash = new Map()
  stashGenerations.set(stash, 0)
  return stash
}

/** Session generation used to reject writes from viewers mounted before a clear. */
export function annotationStashGeneration(stash: AnnotationStash): number {
  return stashGenerations.get(stash) ?? 0
}

export function emptyAnnotationSnapshot(): SeriesAnnotationSnapshot {
  return { measurements: [], pinnedProbes: [] }
}

function clonePoint(point: StashedPoint): StashedPoint {
  return { x: point.x, y: point.y }
}

function cloneMeasurement(measurement: StashedMeasurement): StashedMeasurement {
  return {
    id: measurement.id,
    tool: measurement.tool,
    slice: measurement.slice,
    start: clonePoint(measurement.start),
    end: clonePoint(measurement.end),
    ...(measurement.vertex ? { vertex: clonePoint(measurement.vertex) } : null),
  }
}

function clonePinnedProbe(probe: StashedPinnedProbe): StashedPinnedProbe {
  return {
    id: probe.id,
    slice: probe.slice,
    x: probe.x,
    y: probe.y,
    sample: {
      col: probe.sample.col,
      row: probe.sample.row,
      intensity: probe.sample.intensity,
      display: probe.sample.display,
      scalar: probe.sample.scalar,
    },
  }
}

/** Deep-clone a snapshot so later edits do not mutate stash entries. */
export function cloneAnnotationSnapshot(
  snapshot: SeriesAnnotationSnapshot,
): SeriesAnnotationSnapshot {
  return {
    measurements: snapshot.measurements.map(cloneMeasurement),
    pinnedProbes: snapshot.pinnedProbes.map(clonePinnedProbe),
  }
}

/** Persist annotations for a series (overwrites any prior entry for that seriesId). */
export function stashSeriesAnnotations(
  stash: AnnotationStash,
  seriesId: string,
  snapshot: SeriesAnnotationSnapshot,
): void {
  stash.set(seriesId, cloneAnnotationSnapshot(snapshot))
}

/** Restore annotations for a series, or empty when none were stashed. */
export function restoreSeriesAnnotations(
  stash: AnnotationStash,
  seriesId: string,
): SeriesAnnotationSnapshot {
  const found = stash.get(seriesId)
  return found ? cloneAnnotationSnapshot(found) : emptyAnnotationSnapshot()
}

/**
 * Series-card click or Compare B hop: stash the outgoing series (when known) and
 * restore the incoming one. Never clears the Map — peer series stay put.
 *
 * `previousSeriesId === null` means mount / remount (no live outgoing marks to
 * write); still rehydrates `nextSeriesId` from the stash so layout switches keep
 * annotations. A stale `previousGeneration` means the prior viewer belongs to a
 * cleared session, so its outgoing marks must not repopulate the Map.
 */
export function hopSeriesAnnotations(
  stash: AnnotationStash,
  previousSeriesId: string | null,
  nextSeriesId: string,
  outgoing: SeriesAnnotationSnapshot,
  previousGeneration = annotationStashGeneration(stash),
): SeriesAnnotationSnapshot {
  const currentGeneration = annotationStashGeneration(stash)
  if (previousGeneration !== currentGeneration) {
    return restoreSeriesAnnotations(stash, nextSeriesId)
  }
  if (
    previousSeriesId !== null
    && previousSeriesId !== nextSeriesId
  ) {
    stashSeriesAnnotations(stash, previousSeriesId, outgoing)
  }
  if (previousSeriesId === null || previousSeriesId !== nextSeriesId) {
    return restoreSeriesAnnotations(stash, nextSeriesId)
  }
  return cloneAnnotationSnapshot(outgoing)
}

/**
 * Drop the entire session stash.
 * Call only on full library home or a new local open (AC-4) — never on series-card
 * clicks or Compare B series hops (AC-3).
 */
export function clearAnnotationStash(stash: AnnotationStash): void {
  stash.clear()
  stashGenerations.set(stash, annotationStashGeneration(stash) + 1)
}

/** Highest measurement/probe id in a snapshot (for id counter re-seed). */
export function maxAnnotationId(snapshot: SeriesAnnotationSnapshot): number {
  let max = 0
  for (const measurement of snapshot.measurements) {
    if (measurement.id > max) max = measurement.id
  }
  for (const probe of snapshot.pinnedProbes) {
    if (probe.id > max) max = probe.id
  }
  return max
}
