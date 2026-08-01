import type { VolumeData } from '../types'

/** Non-pinned entries retained after the active primary/compare pins. */
export const DEFAULT_LRU_CAPACITY = 3

/**
 * Bounded cache of full VolumeData stacks.
 *
 * Active primary and compare seriesIds stay pinned. All other entries share a
 * short LRU; inserts past that cap drop the oldest non-pinned entry so its
 * Uint8Array buffers can be garbage-collected.
 */
export class VolumeCache {
  private readonly entries = new Map<string, VolumeData>()
  /** Non-pinned keys only; oldest at the front, most recent at the end. */
  private readonly lruOrder: string[] = []
  private primarySeriesId: string | null = null
  private compareSeriesId: string | null = null
  private readonly lruCapacity: number

  constructor(lruCapacity = DEFAULT_LRU_CAPACITY) {
    this.lruCapacity = Math.max(0, lruCapacity)
  }

  get size(): number {
    return this.entries.size
  }

  get primaryId(): string | null {
    return this.primarySeriesId
  }

  get compareId(): string | null {
    return this.compareSeriesId
  }

  /** Snapshot of retained seriesIds (order is Map insertion order). */
  keys(): string[] {
    return [...this.entries.keys()]
  }

  get(seriesId: string): VolumeData | undefined {
    return this.entries.get(seriesId)
  }

  has(seriesId: string): boolean {
    return this.entries.has(seriesId)
  }

  /**
   * Update which seriesIds are pinned as primary / compare.
   * Unpinned keys become LRU-eligible; newly pinned keys leave the LRU list.
   * Evicts immediately if non-pinned count exceeds capacity.
   */
  setPins(primarySeriesId: string | null, compareSeriesId: string | null): void {
    this.primarySeriesId = primarySeriesId
    this.compareSeriesId = compareSeriesId
    this.reclassify()
    this.evict()
  }

  /**
   * Store (or replace) a volume. Non-pinned keys are marked most-recent in the
   * LRU; excess oldest non-pinned entries are dropped.
   */
  set(volume: VolumeData): void {
    const id = volume.seriesId
    this.entries.set(id, volume)
    if (this.isPinned(id)) {
      this.removeFromLru(id)
    } else {
      this.touchLru(id)
    }
    this.evict()
  }

  private isPinned(id: string): boolean {
    return id === this.primarySeriesId || id === this.compareSeriesId
  }

  private touchLru(id: string): void {
    this.removeFromLru(id)
    this.lruOrder.push(id)
  }

  private removeFromLru(id: string): void {
    const idx = this.lruOrder.indexOf(id)
    if (idx >= 0) this.lruOrder.splice(idx, 1)
  }

  /** Align LRU membership with current pins after pin changes. */
  private reclassify(): void {
    for (const id of this.entries.keys()) {
      if (this.isPinned(id)) {
        this.removeFromLru(id)
      } else if (!this.lruOrder.includes(id)) {
        this.touchLru(id)
      }
    }
  }

  private evict(): void {
    // Drop stale LRU ids (pinned or already missing).
    for (let i = this.lruOrder.length - 1; i >= 0; i--) {
      const id = this.lruOrder[i]!
      if (this.isPinned(id) || !this.entries.has(id)) {
        this.lruOrder.splice(i, 1)
      }
    }

    while (this.lruOrder.length > this.lruCapacity) {
      const dropId = this.lruOrder.shift()!
      this.entries.delete(dropId)
    }
  }
}
