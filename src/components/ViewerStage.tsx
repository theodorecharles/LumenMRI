import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CropBounds, ReconstructedVolume, VolumeData, VolumeSettings } from '../types'
import { normalizePhysicalSize, PALETTES } from '../lib/volume'
import { volumeFragmentShader, volumeVertexShader } from '../rendering/shaders'

export type CameraView = 'perspective' | 'slices' | 'back' | 'side' | 'left' | 'top' | 'bottom'
export type CameraProjection = 'perspective' | 'isometric'
export type RotationAxis = 'x' | 'y' | 'z'

export interface ViewerStageHandle {
  resetView: () => void
  capture: () => void
  toggleFullscreen: () => void
  setView: (view: CameraView) => void
  rotateVolume: (axis: RotationAxis) => void
}

interface ViewerStageProps {
  volume: VolumeData
  reconstruction: ReconstructedVolume | null
  projection: CameraProjection
  volumeSettings: VolumeSettings
  autoRotate: boolean
  sliceIndex: number
  showSliceHighlight: boolean
  cropBounds: CropBounds
}

interface Runtime {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  projection: CameraProjection
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  volumeRoot: THREE.Group | null
  volumeMesh: THREE.Mesh | null
  volumeMaterial: THREE.ShaderMaterial | null
  volumeTexture: THREE.Data3DTexture | null
  sliceHighlight: THREE.Group | null
  sliceMaterial: THREE.ShaderMaterial | null
  sliceTexture: THREE.DataTexture | null
  volumeSize: [number, number, number]
  cropBounds: CropBounds
  visibleDepth: number
  selectedSliceFraction: number
  sliceHighlightRequested: boolean
  currentSeriesId: string | null
  needsRender: boolean
  frame: number
  resizeObserver: ResizeObserver
}

function paletteColors(settings: VolumeSettings) {
  const colors = settings.palette === 'custom'
    ? settings.customPalette
    : PALETTES[settings.palette]
  return colors.map((color) => new THREE.Color(color)) as [
    THREE.Color,
    THREE.Color,
    THREE.Color,
  ]
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose()
      const material = child.material
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
      else material.dispose()
    }
  })
}

function visibleRadius(runtime: Runtime) {
  const [sizeX, sizeY, sizeZ] = runtime.volumeSize
  const cropWidth = (runtime.cropBounds.maxX - runtime.cropBounds.minX) * sizeX
  const cropHeight = (runtime.cropBounds.maxY - runtime.cropBounds.minY) * sizeY
  const cropDepth = runtime.visibleDepth * sizeZ
  return Math.max(0.05, Math.hypot(cropWidth, cropHeight, cropDepth) * 0.5)
}

function fittingDistance(runtime: Runtime) {
  if (!(runtime.camera instanceof THREE.PerspectiveCamera)) return 4
  const verticalHalfFov = THREE.MathUtils.degToRad(runtime.camera.fov * 0.5)
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * runtime.camera.aspect)
  const radius = visibleRadius(runtime)
  const limitingHalfFov = Math.max(0.1, Math.min(verticalHalfFov, horizontalHalfFov))
  return radius / Math.sin(limitingHalfFov) * 1.08
}

function configureControls(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  element: HTMLElement,
) {
  const controls = new OrbitControls(camera, element)
  controls.enableDamping = true
  controls.dampingFactor = 0.065
  controls.minDistance = 0.65
  controls.maxDistance = 8
  controls.minZoom = 0.45
  controls.maxZoom = 8
  controls.rotateSpeed = 0.65
  controls.zoomSpeed = 0.8
  controls.screenSpacePanning = true
  return controls
}

function updateOrthographicFrustum(runtime: Runtime) {
  if (!(runtime.camera instanceof THREE.OrthographicCamera)) return
  const container = runtime.renderer.domElement.parentElement
  const aspect = (container?.clientWidth || 1) / Math.max(container?.clientHeight || 1, 1)
  const halfExtent = visibleRadius(runtime) * 1.08
  const halfWidth = aspect >= 1 ? halfExtent * aspect : halfExtent
  const halfHeight = aspect >= 1 ? halfExtent : halfExtent / aspect
  runtime.camera.left = -halfWidth
  runtime.camera.right = halfWidth
  runtime.camera.top = halfHeight
  runtime.camera.bottom = -halfHeight
  runtime.camera.updateProjectionMatrix()
}

function recenterVisibleVolume(runtime: Runtime) {
  const [sizeX, sizeY, sizeZ] = runtime.volumeSize
  const localCenter = new THREE.Vector3(
    ((runtime.cropBounds.minX + runtime.cropBounds.maxX) * 0.5 - 0.5) * sizeX,
    (0.5 - (runtime.cropBounds.minY + runtime.cropBounds.maxY) * 0.5) * sizeY,
    (runtime.visibleDepth * 0.5 - 0.5) * sizeZ,
  )
  const worldCenter = localCenter.applyQuaternion(
    runtime.volumeRoot?.quaternion || new THREE.Quaternion(),
  )
  const targetDelta = worldCenter.sub(runtime.controls.target)
  runtime.controls.target.add(targetDelta)
  runtime.camera.position.add(targetDelta)
  ensureCameraFits(runtime)
  runtime.controls.update()
}

function updateSliceVisibility(runtime: Runtime) {
  if (!runtime.sliceHighlight) return
  runtime.sliceHighlight.visible =
    runtime.sliceHighlightRequested && runtime.selectedSliceFraction <= runtime.visibleDepth + 0.0001
}

function ensureCameraFits(runtime: Runtime) {
  if (runtime.camera instanceof THREE.OrthographicCamera) {
    updateOrthographicFrustum(runtime)
    return
  }
  const minimumDistance = fittingDistance(runtime)
  const offset = runtime.camera.position.clone().sub(runtime.controls.target)
  if (offset.length() >= minimumDistance) return
  if (offset.lengthSq() < 0.0001) offset.set(1, 0.7, 1)
  runtime.camera.position.copy(
    runtime.controls.target.clone().add(offset.normalize().multiplyScalar(minimumDistance)),
  )
  runtime.controls.update()
}

function positionCamera(runtime: Runtime, view: CameraView) {
  const direction = new THREE.Vector3(1.55, 1.05, 1.75).normalize()
  runtime.camera.up.set(0, 1, 0)
  if (view === 'slices') direction.set(0, 0, 1)
  else if (view === 'back') direction.set(0, 0, -1)
  else if (view === 'side') direction.set(1, 0, 0)
  else if (view === 'left') direction.set(-1, 0, 0)
  else if (view === 'top') {
    direction.set(0, 1, 0.001).normalize()
    runtime.camera.up.set(0, 0, -1)
  } else if (view === 'bottom') {
    direction.set(0, -1, 0.001).normalize()
    runtime.camera.up.set(0, 0, 1)
  }
  const distance = fittingDistance(runtime)
  runtime.camera.position.copy(runtime.controls.target).add(direction.multiplyScalar(distance))
  if (runtime.camera instanceof THREE.OrthographicCamera) {
    runtime.camera.zoom = 1
    updateOrthographicFrustum(runtime)
  }
  runtime.controls.maxDistance = Math.max(5, distance * 1.5)
  runtime.controls.update()
  runtime.needsRender = true
}

function setCameraProjection(runtime: Runtime, projection: CameraProjection) {
  if (runtime.projection === projection) return
  const target = runtime.controls.target.clone()
  const direction = runtime.camera.position.clone().sub(target).normalize()
  const up = runtime.camera.up.clone()
  const container = runtime.renderer.domElement.parentElement
  const aspect = (container?.clientWidth || 1) / Math.max(container?.clientHeight || 1, 1)
  const camera = projection === 'isometric'
    ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
    : new THREE.PerspectiveCamera(38, aspect, 0.01, 100)

  runtime.controls.dispose()
  runtime.camera = camera
  runtime.projection = projection
  runtime.controls = configureControls(camera, runtime.renderer.domElement)
  runtime.controls.target.copy(target)
  camera.up.copy(up)
  if (camera instanceof THREE.OrthographicCamera) {
    camera.position.copy(target).add(direction.multiplyScalar(4))
    updateOrthographicFrustum(runtime)
  } else {
    camera.position.copy(target).add(direction.multiplyScalar(fittingDistance(runtime)))
  }
  camera.lookAt(target)
  runtime.controls.update()
  runtime.needsRender = true
}

export const ViewerStage = forwardRef<ViewerStageHandle, ViewerStageProps>(
  function ViewerStage(
    {
      volume,
      reconstruction,
      projection,
      volumeSettings,
      autoRotate,
      sliceIndex,
      showSliceHighlight,
      cropBounds,
    },
    forwardedRef,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const runtimeRef = useRef<Runtime | null>(null)
    const autoRotateRef = useRef(autoRotate)
    const [renderError, setRenderError] = useState<string | null>(null)

    useEffect(() => {
      autoRotateRef.current = autoRotate
    }, [autoRotate])

    useImperativeHandle(
      forwardedRef,
      () => ({
        resetView: () => {
          const runtime = runtimeRef.current
          if (!runtime) return
          runtime.volumeRoot?.rotation.set(0, 0, 0)
          recenterVisibleVolume(runtime)
          positionCamera(runtime, 'perspective')
          runtime.needsRender = true
        },
        setView: (view) => {
          const runtime = runtimeRef.current
          if (runtime) {
            positionCamera(runtime, view)
            runtime.needsRender = true
          }
        },
        rotateVolume: (axis) => {
          const root = runtimeRef.current?.volumeRoot
          if (!root) return
          const direction = axis === 'x'
            ? new THREE.Vector3(1, 0, 0)
            : axis === 'y'
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(0, 0, 1)
          const rotation = new THREE.Quaternion().setFromAxisAngle(direction, Math.PI / 2)
          root.quaternion.premultiply(rotation).normalize()
          const runtime = runtimeRef.current
          if (runtime) {
            recenterVisibleVolume(runtime)
            runtime.needsRender = true
          }
        },
        capture: () => {
          const runtime = runtimeRef.current
          if (!runtime) return
          runtime.renderer.render(runtime.scene, runtime.camera)
          const link = document.createElement('a')
          link.download = `lumen-${volume.description.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`
          link.href = runtime.renderer.domElement.toDataURL('image/png')
          link.click()
        },
        toggleFullscreen: () => {
          const element = containerRef.current
          if (!element) return
          if (document.fullscreenElement) void document.exitFullscreen()
          else void element.requestFullscreen()
        },
      }),
      [volume.description],
    )

    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      let renderer: THREE.WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true,
        })
      } catch {
        setRenderError('WebGL could not be initialized on this device.')
        return
      }

      if (!renderer.capabilities.isWebGL2) {
        renderer.dispose()
        setRenderError('This viewer requires WebGL 2. Try a current Chrome, Edge, Firefox, or Safari.')
        return
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(container.clientWidth, container.clientHeight)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.08
      renderer.setClearColor(0x05080d, 1)
      container.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      scene.fog = new THREE.FogExp2(0x05080d, 0.14)
      const camera = new THREE.PerspectiveCamera(
        38,
        container.clientWidth / Math.max(container.clientHeight, 1),
        0.01,
        100,
      )

      const controls = configureControls(camera, renderer.domElement)

      const resizeObserver = new ResizeObserver(() => {
        const width = container.clientWidth
        const height = container.clientHeight
        if (!width || !height) return
        if (runtime.camera instanceof THREE.PerspectiveCamera) {
          runtime.camera.aspect = width / height
          runtime.camera.updateProjectionMatrix()
        }
        renderer.setSize(width, height)
        ensureCameraFits(runtime)
        runtime.needsRender = true
      })
      resizeObserver.observe(container)

      const runtime: Runtime = {
        scene,
        camera,
        projection: 'perspective',
        renderer,
        controls,
        volumeRoot: null,
        volumeMesh: null,
        volumeMaterial: null,
        volumeTexture: null,
        sliceHighlight: null,
        sliceMaterial: null,
        sliceTexture: null,
        volumeSize: [1, 1, 1],
        cropBounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
        visibleDepth: 1,
        selectedSliceFraction: 0,
        sliceHighlightRequested: false,
        currentSeriesId: null,
        needsRender: true,
        frame: 0,
        resizeObserver,
      }
      runtimeRef.current = runtime
      positionCamera(runtime, 'perspective')

      const animate = () => {
        runtime.frame = requestAnimationFrame(animate)
        runtime.controls.autoRotate = autoRotateRef.current
        runtime.controls.autoRotateSpeed = 0.55
        const controlsChanged = runtime.controls.update()
        container.dataset.cameraDistance = runtime.camera.position
          .distanceTo(runtime.controls.target)
          .toFixed(5)
        if (controlsChanged || autoRotateRef.current || runtime.needsRender) {
          renderer.render(scene, runtime.camera)
          runtime.needsRender = false
        }
      }
      animate()

      const onContextLost = (event: Event) => {
        event.preventDefault()
        setRenderError('The GPU context was lost. Reload the page to restore the viewer.')
      }
      renderer.domElement.addEventListener('webglcontextlost', onContextLost)

      return () => {
        cancelAnimationFrame(runtime.frame)
        resizeObserver.disconnect()
        runtime.controls.dispose()
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
        scene.children.forEach(disposeObject)
        renderer.dispose()
        renderer.domElement.remove()
        runtimeRef.current = null
      }
    }, [])

    useEffect(() => {
      const runtime = runtimeRef.current
      if (runtime) setCameraProjection(runtime, projection)
    }, [projection])

    useEffect(() => {
      const runtime = runtimeRef.current
      if (!runtime) return

      const sameSeries = runtime.currentSeriesId === volume.seriesId
      const retainedQuaternion = sameSeries ? runtime.volumeRoot?.quaternion.clone() : null
      if (runtime.volumeRoot) {
        runtime.scene.remove(runtime.volumeRoot)
        disposeObject(runtime.volumeRoot)
        runtime.volumeTexture?.dispose()
        runtime.sliceTexture?.dispose()
      }

      const [sourceWidth, sourceHeight, sourceDepth] = volume.dimensions
      const reconstructed = reconstruction?.seriesId === volume.seriesId ? reconstruction : null
      const renderData = reconstructed?.data || volume.data
      const [width, height, depth] = reconstructed?.dimensions || volume.dimensions
      const size = normalizePhysicalSize(volume.physicalSize)
      const texture = new THREE.Data3DTexture(renderData, width, height, depth)
      texture.format = THREE.RedFormat
      texture.type = THREE.UnsignedByteType
      texture.minFilter = THREE.NearestFilter
      texture.magFilter = THREE.NearestFilter
      texture.unpackAlignment = 1
      texture.needsUpdate = true

      const [low, mid, high] = paletteColors(volumeSettings)
      const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: volumeVertexShader,
        fragmentShader: volumeFragmentShader,
        uniforms: {
          uData: { value: texture },
          uDimensions: { value: new THREE.Vector3(width, height, depth) },
          uReconstructed: { value: reconstructed ? 1 : 0 },
          uSize: { value: new THREE.Vector3(...size) },
          uColorLow: { value: low },
          uColorMid: { value: mid },
          uColorHigh: { value: high },
          uThreshold: { value: volumeSettings.threshold },
          uOpacity: { value: volumeSettings.opacity },
          uWindow: { value: volumeSettings.window },
          uLevel: { value: volumeSettings.level },
          uSteps: { value: Math.round(112 + volumeSettings.detail * 320) },
          uShading: { value: volumeSettings.shading },
          uClip: { value: volumeSettings.clip },
          uCrop: { value: new THREE.Vector4(
            cropBounds.minX,
            cropBounds.maxX,
            1 - cropBounds.maxY,
            1 - cropBounds.minY,
          ) },
        },
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      })
      const root = new THREE.Group()
      if (retainedQuaternion) root.quaternion.copy(retainedQuaternion)
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material)
      root.add(mesh)

      const safeIndex = Math.max(0, Math.min(sourceDepth - 1, sliceIndex))
      const sourceSliceSize = sourceWidth * sourceHeight
      const initialSlice = volume.data.subarray(
        safeIndex * sourceSliceSize,
        (safeIndex + 1) * sourceSliceSize,
      )
      const sliceTexture = new THREE.DataTexture(
        initialSlice,
        sourceWidth,
        sourceHeight,
        THREE.RedFormat,
        THREE.UnsignedByteType,
      )
      sliceTexture.minFilter = THREE.LinearFilter
      sliceTexture.magFilter = THREE.LinearFilter
      sliceTexture.unpackAlignment = 1
      sliceTexture.needsUpdate = true
      const sliceMaterial = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: /* glsl */ `
          out vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          in vec2 vUv;
          out vec4 outColor;
          uniform sampler2D uSlice;
          uniform float uWindow;
          uniform float uLevel;
          uniform vec4 uCrop;
          void main() {
            vec2 croppedUv = vec2(
              mix(uCrop.x, uCrop.y, vUv.x),
              mix(uCrop.w, uCrop.z, vUv.y)
            );
            float raw = texture(uSlice, croppedUv).r;
            float low = uLevel - uWindow * 0.5;
            float value = clamp((raw - low) / max(0.015, uWindow), 0.0, 1.0);
            vec3 gray = vec3(value);
            vec3 tint = mix(gray, vec3(0.18, 0.9, 1.0), 0.28);
            outColor = vec4(tint, 0.16 + value * 0.52);
          }
        `,
        uniforms: {
          uSlice: { value: sliceTexture },
          uWindow: { value: volumeSettings.window },
          uLevel: { value: volumeSettings.level },
          uCrop: { value: new THREE.Vector4(
            cropBounds.minX,
            cropBounds.maxX,
            cropBounds.minY,
            cropBounds.maxY,
          ) },
        },
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
      const sliceHighlight = new THREE.Group()
      const slicePlane = new THREE.Mesh(
        new THREE.PlaneGeometry(size[0], size[1]),
        sliceMaterial,
      )
      slicePlane.renderOrder = 10
      const sliceBorder = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(size[0], size[1])),
        new THREE.LineBasicMaterial({ color: 0x43dcf3, transparent: true, opacity: 0.92, depthTest: false }),
      )
      sliceBorder.renderOrder = 11
      sliceHighlight.add(slicePlane, sliceBorder)
      const cropWidth = cropBounds.maxX - cropBounds.minX
      const cropHeight = cropBounds.maxY - cropBounds.minY
      const selectedSliceFraction = sourceDepth > 1 ? safeIndex / (sourceDepth - 1) : 0
      sliceHighlight.scale.set(cropWidth, cropHeight, 1)
      sliceHighlight.position.set(
        ((cropBounds.minX + cropBounds.maxX) * 0.5 - 0.5) * size[0],
        (0.5 - (cropBounds.minY + cropBounds.maxY) * 0.5) * size[1],
        (selectedSliceFraction - 0.5) * size[2],
      )
      sliceHighlight.visible = showSliceHighlight && selectedSliceFraction <= volumeSettings.clip + 0.0001
      root.add(sliceHighlight)
      runtime.scene.add(root)
      runtime.volumeRoot = root
      runtime.volumeMesh = mesh
      runtime.volumeMaterial = material
      runtime.volumeTexture = texture
      runtime.sliceHighlight = sliceHighlight
      runtime.sliceMaterial = sliceMaterial
      runtime.sliceTexture = sliceTexture
      runtime.volumeSize = size
      runtime.cropBounds = cropBounds
      runtime.visibleDepth = volumeSettings.clip
      runtime.selectedSliceFraction = selectedSliceFraction
      runtime.sliceHighlightRequested = showSliceHighlight
      runtime.currentSeriesId = volume.seriesId
      recenterVisibleVolume(runtime)
      if (!sameSeries) positionCamera(runtime, 'perspective')
      runtime.needsRender = true
    }, [reconstruction, volume])

    useEffect(() => {
      const material = runtimeRef.current?.volumeMaterial
      if (!material) return
      const [low, mid, high] = paletteColors(volumeSettings)
      material.uniforms.uColorLow.value.copy(low)
      material.uniforms.uColorMid.value.copy(mid)
      material.uniforms.uColorHigh.value.copy(high)
      material.uniforms.uThreshold.value = volumeSettings.threshold
      material.uniforms.uOpacity.value = volumeSettings.opacity
      material.uniforms.uWindow.value = volumeSettings.window
      material.uniforms.uLevel.value = volumeSettings.level
      material.uniforms.uSteps.value = Math.round(112 + volumeSettings.detail * 320)
      material.uniforms.uShading.value = volumeSettings.shading
      material.uniforms.uClip.value = volumeSettings.clip
      const sliceMaterial = runtimeRef.current?.sliceMaterial
      if (sliceMaterial) {
        sliceMaterial.uniforms.uWindow.value = volumeSettings.window
        sliceMaterial.uniforms.uLevel.value = volumeSettings.level
      }
      const runtime = runtimeRef.current
      if (runtime) runtime.needsRender = true
    }, [volumeSettings])

    useEffect(() => {
      const runtime = runtimeRef.current
      if (!runtime?.sliceHighlight || !runtime.sliceTexture) return
      const [width, height, depth] = volume.dimensions
      const safeIndex = Math.max(0, Math.min(depth - 1, sliceIndex))
      const start = safeIndex * width * height
      runtime.sliceTexture.image.data = volume.data.subarray(start, start + width * height)
      runtime.sliceTexture.needsUpdate = true
      runtime.selectedSliceFraction = depth > 1 ? safeIndex / (depth - 1) : 0
      runtime.sliceHighlightRequested = showSliceHighlight
      runtime.sliceHighlight.position.z =
        (runtime.selectedSliceFraction - 0.5) * runtime.volumeSize[2]
      updateSliceVisibility(runtime)
      runtime.needsRender = true
    }, [showSliceHighlight, sliceIndex, volume])

    useEffect(() => {
      const runtime = runtimeRef.current
      const crop = runtime?.volumeMaterial?.uniforms.uCrop.value as THREE.Vector4 | undefined
      if (crop) {
        crop.set(
          cropBounds.minX,
          cropBounds.maxX,
          1 - cropBounds.maxY,
          1 - cropBounds.minY,
        )
      }
      if (runtime?.sliceHighlight) {
        const width = cropBounds.maxX - cropBounds.minX
        const height = cropBounds.maxY - cropBounds.minY
        runtime.sliceHighlight.scale.set(width, height, 1)
        runtime.sliceHighlight.position.x = ((cropBounds.minX + cropBounds.maxX) * 0.5 - 0.5) * runtime.volumeSize[0]
        runtime.sliceHighlight.position.y = (0.5 - (cropBounds.minY + cropBounds.maxY) * 0.5) * runtime.volumeSize[1]
      }
      const sliceCrop = runtime?.sliceMaterial?.uniforms.uCrop.value as THREE.Vector4 | undefined
      sliceCrop?.set(cropBounds.minX, cropBounds.maxX, cropBounds.minY, cropBounds.maxY)
      if (runtime) {
        runtime.cropBounds = cropBounds
        runtime.visibleDepth = volumeSettings.clip
        updateSliceVisibility(runtime)
        recenterVisibleVolume(runtime)
        runtime.needsRender = true
      }
    }, [cropBounds, volumeSettings.clip])

    return (
      <div className="viewer-canvas" ref={containerRef}>
        {renderError ? (
          <div className="viewer-error" role="alert">
            <span>GPU unavailable</span>
            <p>{renderError}</p>
          </div>
        ) : null}
        <div className="view-cube" role="group" aria-label="Anatomical view cube">
          <div className="view-cube-model">
            <button type="button" className="cube-face cube-superior" aria-label="Superior view" onClick={() => {
              const runtime = runtimeRef.current
              if (runtime) positionCamera(runtime, 'top')
            }}>S</button>
            <button type="button" className="cube-face cube-anterior" aria-label="Anterior view" onClick={() => {
              const runtime = runtimeRef.current
              if (runtime) positionCamera(runtime, 'slices')
            }}>A</button>
            <button type="button" className="cube-face cube-right" aria-label="Right view" onClick={() => {
              const runtime = runtimeRef.current
              if (runtime) positionCamera(runtime, 'side')
            }}>R</button>
          </div>
          <div className="view-cube-opposites">
            <button type="button" aria-label="Inferior view" onClick={() => {
              const runtime = runtimeRef.current
              if (runtime) positionCamera(runtime, 'bottom')
            }}>I</button>
            <button type="button" aria-label="Posterior view" onClick={() => {
              const runtime = runtimeRef.current
              if (runtime) positionCamera(runtime, 'back')
            }}>P</button>
            <button type="button" aria-label="Left view" onClick={() => {
              const runtime = runtimeRef.current
              if (runtime) positionCamera(runtime, 'left')
            }}>L</button>
          </div>
          <button type="button" className="view-cube-home" aria-label="Three-dimensional view" onClick={() => {
            const runtime = runtimeRef.current
            if (runtime) positionCamera(runtime, 'perspective')
          }}>3D</button>
        </div>
      </div>
    )
  },
)
