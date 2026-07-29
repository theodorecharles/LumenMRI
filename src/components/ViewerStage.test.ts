import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { releaseRuntimeGpu, type ReleasableRuntime } from './ViewerStage'

function stubRenderer() {
  const order: string[] = []
  return {
    order,
    dispose: vi.fn(() => order.push('dispose')),
    forceContextLoss: vi.fn(() => order.push('forceContextLoss')),
  }
}

function makeRuntime() {
  const scene = new THREE.Scene()
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.ShaderMaterial()
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geometry, material))
  scene.add(group)

  const volumeTexture = new THREE.Data3DTexture(new Uint8Array(8), 2, 2, 2)
  const sliceTexture = new THREE.DataTexture(new Uint8Array(4), 2, 2)
  const renderer = stubRenderer()

  const runtime: ReleasableRuntime = {
    scene,
    renderer,
    volumeTexture,
    sliceTexture,
  }
  return { runtime, renderer, geometry, material, volumeTexture, sliceTexture }
}

describe('releaseRuntimeGpu', () => {
  it('disposes both volume textures on teardown', () => {
    const { runtime, volumeTexture, sliceTexture } = makeRuntime()
    const volumeDispose = vi.spyOn(volumeTexture, 'dispose')
    const sliceDispose = vi.spyOn(sliceTexture, 'dispose')

    releaseRuntimeGpu(runtime)

    expect(volumeDispose).toHaveBeenCalledTimes(1)
    expect(sliceDispose).toHaveBeenCalledTimes(1)
    expect(runtime.volumeTexture).toBeNull()
    expect(runtime.sliceTexture).toBeNull()
  })

  it('disposes scene geometry and materials', () => {
    const { runtime, geometry, material } = makeRuntime()
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')

    releaseRuntimeGpu(runtime)

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
  })

  it('releases the WebGL context after disposing the renderer', () => {
    const { runtime, renderer } = makeRuntime()

    releaseRuntimeGpu(runtime)

    expect(renderer.dispose).toHaveBeenCalledTimes(1)
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1)
    expect(renderer.order).toEqual(['dispose', 'forceContextLoss'])
  })

  it('disposes textures before the renderer clears its property cache', () => {
    const { runtime, renderer, volumeTexture, sliceTexture } = makeRuntime()
    const seen: string[] = []
    vi.spyOn(volumeTexture, 'dispose').mockImplementation(() => seen.push('volumeTexture'))
    vi.spyOn(sliceTexture, 'dispose').mockImplementation(() => seen.push('sliceTexture'))
    renderer.dispose.mockImplementation(() => seen.push('dispose'))

    releaseRuntimeGpu(runtime)

    expect(seen).toEqual(['volumeTexture', 'sliceTexture', 'dispose'])
  })

  it('tolerates a runtime with no volume loaded yet', () => {
    const { runtime, renderer } = makeRuntime()
    runtime.volumeTexture = null
    runtime.sliceTexture = null

    expect(() => releaseRuntimeGpu(runtime)).not.toThrow()
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1)
  })
})
