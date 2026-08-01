import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelInFlight: vi.fn(),
  clearAnnotationStash: vi.fn(),
  loadSeries: vi.fn(),
  scanFiles: vi.fn(),
  setError: vi.fn(),
  setVolume: vi.fn(),
}))

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

vi.mock('./hooks/useDicomLoader', () => ({
  useDicomLoader: () => ({
    series: [],
    volume: null,
    setVolume: mocks.setVolume,
    progress: { phase: 'idle', progress: 0, label: 'Ready' },
    error: null,
    setError: mocks.setError,
    scanFiles: mocks.scanFiles,
    loadSeries: mocks.loadSeries,
    cancelInFlight: mocks.cancelInFlight,
  }),
}))

vi.mock('./hooks/useVolumeReconstruction', () => ({
  useVolumeReconstruction: () => ({
    status: 'idle',
    progress: 0,
    message: 'Waiting for volume',
    volume: null,
  }),
}))

import App from './App'

afterEach(() => {
  cleanup()
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
