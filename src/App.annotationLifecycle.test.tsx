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
