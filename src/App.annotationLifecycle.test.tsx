import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SeriesSummary } from './types'

const mocks = vi.hoisted(() => {
  const seriesListeners = new Set<() => void>()
  let series: SeriesSummary[] = []
  return {
    cancelInFlight: vi.fn(),
    clearAnnotationStash: vi.fn(),
    loadSeries: vi.fn(),
    scanFiles: vi.fn(),
    setError: vi.fn(),
    setVolume: vi.fn(),
    getSeries: () => series,
    setSeries(next: SeriesSummary[]) {
      series = next
      for (const notify of seriesListeners) notify()
    },
    subscribeSeries(listener: () => void) {
      seriesListeners.add(listener)
      return () => {
        seriesListeners.delete(listener)
      }
    },
    resetSeries() {
      series = []
    },
  }
})

vi.mock('./lib/annotationStash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/annotationStash')>()
  return { ...actual, clearAnnotationStash: mocks.clearAnnotationStash }
})

vi.mock('./lib/bundledVolume', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/bundledVolume')>()
  return {
    ...actual,
    loadBundledCatalog: vi.fn(() => new Promise(() => undefined)),
  }
})

vi.mock('./hooks/useDicomLoader', async () => {
  const React = await import('react')
  return {
    useDicomLoader: () => {
      const [, bump] = React.useState(0)
      React.useEffect(() => mocks.subscribeSeries(() => bump((n) => n + 1)), [])
      return {
        series: mocks.getSeries(),
        volume: null,
        setVolume: mocks.setVolume,
        progress: { phase: 'idle', progress: 0, label: 'Ready' },
        error: null,
        setError: mocks.setError,
        scanFiles: mocks.scanFiles,
        loadSeries: mocks.loadSeries,
        cancelInFlight: mocks.cancelInFlight,
      }
    },
  }
})

vi.mock('./hooks/useVolumeReconstruction', () => ({
  useVolumeReconstruction: () => ({
    status: 'idle',
    progress: 0,
    message: 'Waiting for volume',
    volume: null,
  }),
}))

import App from './App'
import './styles.css'

const sampleSeries: SeriesSummary = {
  id: 'series-1',
  description: 'T1',
  protocol: 't1',
  modality: 'MR',
  sliceCount: 10,
  rows: 256,
  columns: 256,
  spacing: [1, 1, 1],
  physicalSize: [256, 256, 10],
  orientation: 'axial',
  transferSyntax: '1.2.840.10008.1.2',
  supported: true,
  estimatedMegabytes: 1,
  score: 1,
}

afterEach(() => {
  cleanup()
  mocks.resetSeries()
  vi.clearAllMocks()
})

describe('goHome cancels in-flight DICOM work', () => {
  it('calls cancelInFlight when brand home leaves the viewer (AC-1)', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('link', { name: 'Lumen scan library' }))

    expect(mocks.cancelInFlight).toHaveBeenCalledTimes(1)
  })

  it('calls cancelInFlight when Scan library leaves the viewer (AC-1)', () => {
    const { container } = render(<App />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    const files = [new File(['dicom'], 'slice.dcm', { type: 'application/dicom' })]
    expect(input).not.toBeNull()
    // Local open puts screen in viewer so the Scan library control is mounted.
    fireEvent.change(input!, { target: { files } })
    mocks.cancelInFlight.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /scan library/i }))

    expect(mocks.cancelInFlight).toHaveBeenCalledTimes(1)
  })

  it('calls cancelInFlight when L key leaves the viewer (AC-1)', () => {
    const { container } = render(<App />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    const files = [new File(['dicom'], 'slice.dcm', { type: 'application/dicom' })]
    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { files } })
    mocks.cancelInFlight.mockClear()

    fireEvent.keyDown(window, { key: 'l' })

    expect(mocks.cancelInFlight).toHaveBeenCalledTimes(1)
  })

  it('calls cancelInFlight when Browser Back returns to the library history entry (AC-1, AC-2)', () => {
    const { container } = render(<App />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    const files = [new File(['dicom'], 'slice.dcm', { type: 'application/dicom' })]
    expect(input).not.toBeNull()
    // Local open: #local + in-flight scan/load (cancelInFlight is the stop/setVolume guard).
    fireEvent.change(input!, { target: { files } })
    mocks.cancelInFlight.mockClear()
    mocks.setVolume.mockClear()

    act(() => {
      // Empty hash / no #series — same branch as Browser Back to the library entry.
      window.history.replaceState(
        { screen: 'library' },
        '',
        `${window.location.pathname}${window.location.search}`,
      )
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(mocks.cancelInFlight).toHaveBeenCalledTimes(1)
    // cancelInFlight is what drops worker volume-ready; with the mock, no late setVolume.
    expect(mocks.setVolume).not.toHaveBeenCalled()
    // AC-3: sticky scanning/loading clear lives inside cancelInFlight (see useDicomLoader.test.ts).
  })
})

describe('PWA app-shell structure', () => {
  it('keeps primary navigation outside the designated content scroller (PWA AC-1, AC-2)', () => {
    const { container } = render(<App />)
    const shell = container.querySelector<HTMLElement>('.app-shell')
    const appMain = container.querySelector<HTMLElement>('[data-scroll-container="main-content"]')
    const bottomNav = screen.getByRole('navigation', { name: 'Primary navigation' })

    expect(shell).not.toBeNull()
    expect(appMain).not.toBeNull()
    expect(appMain?.parentElement).toBe(shell)
    expect(bottomNav.parentElement).toBe(shell)
    expect(appMain?.contains(bottomNav)).toBe(false)
    expect(appMain?.nextElementSibling).toBe(bottomNav)
  })

  it('locks the document and leaves the bottom nav in normal flow (PWA AC-1, AC-2)', () => {
    const { container } = render(<App />)
    container.id = 'root'
    const appMain = container.querySelector<HTMLElement>('[data-scroll-container="main-content"]')!
    const bottomNav = screen.getByRole('navigation', { name: 'Primary navigation' })

    expect(getComputedStyle(document.documentElement).overflow).toBe('hidden')
    expect(getComputedStyle(document.body).overflow).toBe('hidden')
    expect(getComputedStyle(container).overflow).toBe('hidden')
    expect(getComputedStyle(appMain).overflowY).toBe('auto')
    expect(getComputedStyle(bottomNav).position).toBe('relative')
    expect(getComputedStyle(bottomNav).transform).toBe('none')
    expect(getComputedStyle(bottomNav).filter).toBe('none')
    expect(getComputedStyle(bottomNav).contain).toBe('none')
  })
})

describe('auto-recommend does not load on library (AC-3)', () => {
  it('does not call loadSeries when series fills while screen is library', () => {
    const { container } = render(<App />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    const files = [new File(['dicom'], 'slice.dcm', { type: 'application/dicom' })]
    expect(input).not.toBeNull()
    // Local open: viewer, activeSeriesId null (scan path).
    fireEvent.change(input!, { target: { files } })
    fireEvent.keyDown(window, { key: 'l' })
    mocks.loadSeries.mockClear()

    act(() => {
      mocks.setSeries([sampleSeries])
    })

    expect(mocks.loadSeries).not.toHaveBeenCalled()
  })

  it('calls loadSeries when series fills on the viewer with no active id', () => {
    const { container } = render(<App />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    const files = [new File(['dicom'], 'slice.dcm', { type: 'application/dicom' })]
    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { files } })
    mocks.loadSeries.mockClear()

    act(() => {
      mocks.setSeries([sampleSeries])
    })

    expect(mocks.loadSeries).toHaveBeenCalledWith('series-1')
  })
})

describe('AC-4 annotation session boundaries', () => {
  it('drops the stash when navigating to the full scan library', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('link', { name: 'Lumen scan library' }))

    expect(mocks.clearAnnotationStash).toHaveBeenCalledTimes(1)
  })

  it('drops the stash before scanning a new non-empty local selection', () => {
    const { container } = render(<App />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    const files = [new File(['dicom'], 'slice.dcm', { type: 'application/dicom' })]

    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { files } })

    expect(mocks.clearAnnotationStash).toHaveBeenCalledTimes(1)
    expect(mocks.scanFiles).toHaveBeenCalledWith(files)
  })
})
