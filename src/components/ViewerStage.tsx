import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
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
  cropEditing: boolean
  onCropChange: (bounds: CropBounds) => void
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
  cropOutline: THREE.LineSegments | null
  cropFaces: THREE.Mesh[]
  volumeSize: [number, number, number]
  cropBounds: CropBounds
  selectedSliceFraction: number
  sliceHighlightRequested: boolean
  currentSeriesId: string | null
  needsRender: boolean
  frame: number
  resizeObserver: ResizeObserver
}

type CropAxis = 'x' | 'y' | 'z'
type CropBound = keyof CropBounds

interface CropHandleDefinition {
  id: string
  axis: CropAxis
  bound: CropBound
  label: string
  shortLabel: string
}

interface FaceCropDrag {
  mode: 'face'
  pointerId: number
  axis: CropAxis
  bound: CropBound
  startX: number
  startY: number
  screenAxisX: number
  screenAxisY: number
  pixelsPerFraction: number
  bounds: CropBounds
}

interface MoveCropDrag {
  mode: 'move'
  pointerId: number
  plane: THREE.Plane
  startWorld: THREE.Vector3
  bounds: CropBounds
}

type CropDrag = FaceCropDrag | MoveCropDrag

const CROP_HANDLES: CropHandleDefinition[] = [
  { id: 'min-x', axis: 'x', bound: 'minX', label: 'Drag left crop face', shortLabel: 'X−' },
  { id: 'max-x', axis: 'x', bound: 'maxX', label: 'Drag right crop face', shortLabel: 'X+' },
  { id: 'min-y', axis: 'y', bound: 'minY', label: 'Drag top crop face', shortLabel: 'Y−' },
  { id: 'max-y', axis: 'y', bound: 'maxY', label: 'Drag bottom crop face', shortLabel: 'Y+' },
  { id: 'min-z', axis: 'z', bound: 'minZ', label: 'Drag near depth crop face', shortLabel: 'Z−' },
  { id: 'max-z', axis: 'z', bound: 'maxZ', label: 'Drag far depth crop face', shortLabel: 'Z+' },
]

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

function isCropped(bounds: CropBounds) {
  return bounds.minX > 0.001 || bounds.maxX < 0.999 ||
    bounds.minY > 0.001 || bounds.maxY < 0.999 ||
    bounds.minZ > 0.001 || bounds.maxZ < 0.999
}

function cropBoxTransform(runtime: Runtime) {
  const [sizeX, sizeY, sizeZ] = runtime.volumeSize
  const bounds = runtime.cropBounds
  const scale = new THREE.Vector3(
    (bounds.maxX - bounds.minX) * sizeX,
    (bounds.maxY - bounds.minY) * sizeY,
    (bounds.maxZ - bounds.minZ) * sizeZ,
  )
  const center = new THREE.Vector3(
    ((bounds.minX + bounds.maxX) * 0.5 - 0.5) * sizeX,
    (0.5 - (bounds.minY + bounds.maxY) * 0.5) * sizeY,
    ((bounds.minZ + bounds.maxZ) * 0.5 - 0.5) * sizeZ,
  )
  return { center, scale }
}

function cropHandleLocalPosition(runtime: Runtime, handle: CropHandleDefinition) {
  const { center } = cropBoxTransform(runtime)
  const [sizeX, sizeY, sizeZ] = runtime.volumeSize
  const bounds = runtime.cropBounds
  if (handle.bound === 'minX') center.x = (bounds.minX - 0.5) * sizeX
  else if (handle.bound === 'maxX') center.x = (bounds.maxX - 0.5) * sizeX
  else if (handle.bound === 'minY') center.y = (0.5 - bounds.minY) * sizeY
  else if (handle.bound === 'maxY') center.y = (0.5 - bounds.maxY) * sizeY
  else if (handle.bound === 'minZ') center.z = (bounds.minZ - 0.5) * sizeZ
  else center.z = (bounds.maxZ - 0.5) * sizeZ
  return center
}

function cropBoundCoordinate(bounds: CropBounds, bound: CropBound) {
  if (bound === 'minX') return bounds.minX
  if (bound === 'maxX') return bounds.maxX
  if (bound === 'minY') return 1 - bounds.minY
  if (bound === 'maxY') return 1 - bounds.maxY
  if (bound === 'minZ') return bounds.minZ
  return bounds.maxZ
}

function projectToCanvas(runtime: Runtime, world: THREE.Vector3) {
  const projected = world.project(runtime.camera)
  const canvas = runtime.renderer.domElement
  return {
    x: (projected.x * 0.5 + 0.5) * canvas.clientWidth,
    y: (-projected.y * 0.5 + 0.5) * canvas.clientHeight,
    visible: projected.z >= -1 && projected.z <= 1,
  }
}

function updateCropOutline(runtime: Runtime, editing: boolean) {
  if (!runtime.cropOutline) return
  const { center, scale } = cropBoxTransform(runtime)
  runtime.cropOutline.position.copy(center)
  runtime.cropOutline.scale.copy(scale)
  runtime.cropOutline.visible = editing || isCropped(runtime.cropBounds)
}

function updateCropFaces(runtime: Runtime, editing: boolean) {
  const { center, scale } = cropBoxTransform(runtime)
  const boundsMin = new THREE.Vector3(
    runtime.cropBounds.minX,
    1 - runtime.cropBounds.maxY,
    runtime.cropBounds.minZ,
  )
  const boundsMax = new THREE.Vector3(
    runtime.cropBounds.maxX,
    1 - runtime.cropBounds.minY,
    runtime.cropBounds.maxZ,
  )

  runtime.cropFaces.forEach((face, index) => {
    const handle = CROP_HANDLES[index]
    const material = face.material as THREE.ShaderMaterial
    material.uniforms.uBoundsMin.value.copy(boundsMin)
    material.uniforms.uBoundsMax.value.copy(boundsMax)
    material.uniforms.uCoordinate.value = cropBoundCoordinate(runtime.cropBounds, handle.bound)
    face.position.copy(center)
    if (handle.axis === 'x') {
      face.position.x = (cropBoundCoordinate(runtime.cropBounds, handle.bound) - 0.5) * runtime.volumeSize[0]
      face.scale.set(scale.z, scale.y, 1)
    } else if (handle.axis === 'y') {
      face.position.y = (cropBoundCoordinate(runtime.cropBounds, handle.bound) - 0.5) * runtime.volumeSize[1]
      face.scale.set(scale.x, scale.z, 1)
    } else {
      face.position.z = (cropBoundCoordinate(runtime.cropBounds, handle.bound) - 0.5) * runtime.volumeSize[2]
      face.scale.set(scale.x, scale.y, 1)
    }
    face.visible = editing
  })
}

function updateCropHandlePositions(
  runtime: Runtime,
  handles: Record<string, HTMLButtonElement | null>,
) {
  if (!runtime.volumeRoot) return
  runtime.volumeRoot.updateWorldMatrix(true, false)
  for (const handle of CROP_HANDLES) {
    const element = handles[handle.id]
    if (!element) continue
    const world = cropHandleLocalPosition(runtime, handle)
      .applyMatrix4(runtime.volumeRoot.matrixWorld)
    const screen = projectToCanvas(runtime, world)
    element.style.left = `${screen.x}px`
    element.style.top = `${screen.y}px`
    element.style.visibility = screen.visible ? 'visible' : 'hidden'
  }
  const moveHandle = handles.move
  if (moveHandle) {
    const world = cropBoxTransform(runtime).center
      .applyMatrix4(runtime.volumeRoot.matrixWorld)
    const screen = projectToCanvas(runtime, world)
    moveHandle.style.left = `${screen.x}px`
    moveHandle.style.top = `${screen.y}px`
    moveHandle.style.visibility = screen.visible ? 'visible' : 'hidden'
  }
  const container = runtime.renderer.domElement.parentElement
  const handlesReady = Boolean(moveHandle) && CROP_HANDLES.every((handle) => Boolean(handles[handle.id]))
  if (container && handlesReady) container.dataset.cropHandlesReady = 'true'
}

const cropFaceVertexShader = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const cropFaceFragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler3D uData;
  uniform int uAxis;
  uniform float uCoordinate;
  uniform vec3 uBoundsMin;
  uniform vec3 uBoundsMax;
  uniform float uWindow;
  uniform float uLevel;

  void main() {
    vec3 uvw;
    if (uAxis == 0) {
      uvw = vec3(
        uCoordinate,
        mix(uBoundsMin.y, uBoundsMax.y, vUv.y),
        mix(uBoundsMin.z, uBoundsMax.z, vUv.x)
      );
    } else if (uAxis == 1) {
      uvw = vec3(
        mix(uBoundsMin.x, uBoundsMax.x, vUv.x),
        uCoordinate,
        mix(uBoundsMin.z, uBoundsMax.z, vUv.y)
      );
    } else {
      uvw = vec3(
        mix(uBoundsMin.x, uBoundsMax.x, vUv.x),
        mix(uBoundsMin.y, uBoundsMax.y, vUv.y),
        uCoordinate
      );
    }
    float raw = texture(uData, vec3(uvw.x, 1.0 - uvw.y, uvw.z)).r;
    float low = uLevel - uWindow * 0.5;
    float value = clamp((raw - low) / max(0.015, uWindow), 0.0, 1.0);
    float edge = clamp((abs(dFdx(value)) + abs(dFdy(value))) * 1.35, 0.0, 0.22);
    vec3 gray = vec3(clamp(value + edge, 0.0, 1.0));
    vec3 color = mix(gray, vec3(0.22, 0.86, 1.0), 0.12);
    float alpha = 0.1 + smoothstep(0.02, 0.32, value) * 0.76;
    outColor = vec4(color, alpha);
  }
`

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

function lightDirection(settings: VolumeSettings) {
  const azimuth = THREE.MathUtils.degToRad(settings.lightAzimuth)
  const elevation = THREE.MathUtils.degToRad(settings.lightElevation)
  const horizontal = Math.cos(elevation)
  return new THREE.Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
    Math.cos(azimuth) * horizontal,
  ).normalize()
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
  const cropDepth = (runtime.cropBounds.maxZ - runtime.cropBounds.minZ) * sizeZ
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
    ((runtime.cropBounds.minZ + runtime.cropBounds.maxZ) * 0.5 - 0.5) * sizeZ,
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
    runtime.sliceHighlightRequested &&
    runtime.selectedSliceFraction >= runtime.cropBounds.minZ - 0.0001 &&
    runtime.selectedSliceFraction <= runtime.cropBounds.maxZ + 0.0001
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
      cropEditing,
      onCropChange,
    },
    forwardedRef,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const runtimeRef = useRef<Runtime | null>(null)
    const autoRotateRef = useRef(autoRotate)
    const cropHandleRefs = useRef<Record<string, HTMLButtonElement | null>>({})
    const cropDragRef = useRef<CropDrag | null>(null)
    const [renderError, setRenderError] = useState<string | null>(null)

    useEffect(() => {
      autoRotateRef.current = autoRotate
    }, [autoRotate])

    useEffect(() => {
      if (containerRef.current) containerRef.current.dataset.cropHandlesReady = 'false'
      if (cropEditing) return
      cropDragRef.current = null
      if (runtimeRef.current) runtimeRef.current.controls.enabled = true
    }, [cropEditing])

    const beginCropDrag = (
      event: ReactPointerEvent<HTMLButtonElement>,
      handle: CropHandleDefinition,
    ) => {
      const runtime = runtimeRef.current
      if (!runtime?.volumeRoot) return
      runtime.volumeRoot.updateWorldMatrix(true, false)
      const localStart = cropHandleLocalPosition(runtime, handle)
      const localAxis = handle.axis === 'x'
        ? new THREE.Vector3(1, 0, 0)
        : handle.axis === 'y'
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(0, 0, 1)
      const axisSize = handle.axis === 'x'
        ? runtime.volumeSize[0]
        : handle.axis === 'y'
          ? runtime.volumeSize[1]
          : runtime.volumeSize[2]
      const probeFraction = 0.2
      const worldStart = localStart.clone().applyMatrix4(runtime.volumeRoot.matrixWorld)
      const worldEnd = localStart.clone()
        .add(localAxis.multiplyScalar(axisSize * probeFraction))
        .applyMatrix4(runtime.volumeRoot.matrixWorld)
      const screenStart = projectToCanvas(runtime, worldStart)
      const screenEnd = projectToCanvas(runtime, worldEnd)
      let screenX = screenEnd.x - screenStart.x
      let screenY = screenEnd.y - screenStart.y
      let projectedLength = Math.hypot(screenX, screenY)
      let pixelsPerFraction = projectedLength / probeFraction

      if (pixelsPerFraction < 32) {
        const fallback = Math.max(140, Math.min(
          runtime.renderer.domElement.clientWidth,
          runtime.renderer.domElement.clientHeight,
        ) * 0.52)
        screenX = handle.axis === 'x' ? fallback : 0
        screenY = handle.axis === 'x' ? 0 : -fallback
        projectedLength = fallback
        pixelsPerFraction = fallback
      }

      cropDragRef.current = {
        mode: 'face',
        pointerId: event.pointerId,
        axis: handle.axis,
        bound: handle.bound,
        startX: event.clientX,
        startY: event.clientY,
        screenAxisX: screenX / projectedLength,
        screenAxisY: screenY / projectedLength,
        pixelsPerFraction,
        bounds: { ...cropBounds },
      }
      runtime.controls.enabled = false
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    }

    const beginMoveCropDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
      const runtime = runtimeRef.current
      if (!runtime?.volumeRoot) return
      runtime.volumeRoot.updateWorldMatrix(true, false)
      const centerWorld = cropBoxTransform(runtime).center
        .applyMatrix4(runtime.volumeRoot.matrixWorld)
      const normal = new THREE.Vector3()
      runtime.camera.getWorldDirection(normal)
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, centerWorld)
      const canvasBounds = runtime.renderer.domElement.getBoundingClientRect()
      const pointer = new THREE.Vector2(
        ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1,
        -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(pointer, runtime.camera)
      const startWorld = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, startWorld)) return

      cropDragRef.current = {
        mode: 'move',
        pointerId: event.pointerId,
        plane,
        startWorld,
        bounds: { ...cropBounds },
      }
      if (containerRef.current) {
        containerRef.current.dataset.cropDragMode = 'move'
        containerRef.current.dataset.cropMoveDelta = '0.0000,0.0000,0.0000'
      }
      runtime.controls.enabled = false
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    }

    const updateCropDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = cropDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (drag.mode === 'move') {
        const runtime = runtimeRef.current
        if (!runtime?.volumeRoot) return
        const canvasBounds = runtime.renderer.domElement.getBoundingClientRect()
        const pointer = new THREE.Vector2(
          ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1,
          -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1,
        )
        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(pointer, runtime.camera)
        const currentWorld = new THREE.Vector3()
        if (!raycaster.ray.intersectPlane(drag.plane, currentWorld)) return
        runtime.volumeRoot.updateWorldMatrix(true, false)
        const inverseRoot = runtime.volumeRoot.matrixWorld.clone().invert()
        const startLocal = drag.startWorld.clone().applyMatrix4(inverseRoot)
        const currentLocal = currentWorld.applyMatrix4(inverseRoot)
        const localDelta = currentLocal.sub(startLocal)
        const requestedX = localDelta.x / runtime.volumeSize[0]
        const requestedY = -localDelta.y / runtime.volumeSize[1]
        const requestedZ = localDelta.z / runtime.volumeSize[2]
        const deltaX = clamp(requestedX, -drag.bounds.minX, 1 - drag.bounds.maxX)
        const deltaY = clamp(requestedY, -drag.bounds.minY, 1 - drag.bounds.maxY)
        const deltaZ = clamp(requestedZ, -drag.bounds.minZ, 1 - drag.bounds.maxZ)
        if (containerRef.current) {
          containerRef.current.dataset.cropMoveDelta = [deltaX, deltaY, deltaZ]
            .map((value) => value.toFixed(4)).join(',')
        }
        onCropChange({
          minX: drag.bounds.minX + deltaX,
          maxX: drag.bounds.maxX + deltaX,
          minY: drag.bounds.minY + deltaY,
          maxY: drag.bounds.maxY + deltaY,
          minZ: drag.bounds.minZ + deltaZ,
          maxZ: drag.bounds.maxZ + deltaZ,
        })
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const screenDelta =
        (event.clientX - drag.startX) * drag.screenAxisX +
        (event.clientY - drag.startY) * drag.screenAxisY
      let fractionDelta = screenDelta / drag.pixelsPerFraction
      if (drag.axis === 'y') fractionDelta *= -1
      const next = { ...drag.bounds }
      const minimum = 0.035

      if (drag.bound === 'minX') next.minX = clamp(drag.bounds.minX + fractionDelta, 0, drag.bounds.maxX - minimum)
      else if (drag.bound === 'maxX') next.maxX = clamp(drag.bounds.maxX + fractionDelta, drag.bounds.minX + minimum, 1)
      else if (drag.bound === 'minY') next.minY = clamp(drag.bounds.minY + fractionDelta, 0, drag.bounds.maxY - minimum)
      else if (drag.bound === 'maxY') next.maxY = clamp(drag.bounds.maxY + fractionDelta, drag.bounds.minY + minimum, 1)
      else if (drag.bound === 'minZ') next.minZ = clamp(drag.bounds.minZ + fractionDelta, 0, drag.bounds.maxZ - minimum)
      else next.maxZ = clamp(drag.bounds.maxZ + fractionDelta, drag.bounds.minZ + minimum, 1)

      onCropChange(next)
      event.preventDefault()
      event.stopPropagation()
    }

    const finishCropDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = cropDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      cropDragRef.current = null
      if (containerRef.current) containerRef.current.dataset.cropDragMode = 'idle'
      const runtime = runtimeRef.current
      if (runtime) {
        runtime.controls.enabled = true
        recenterVisibleVolume(runtime)
        runtime.needsRender = true
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      event.preventDefault()
      event.stopPropagation()
    }

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
        cropOutline: null,
        cropFaces: [],
        volumeSize: [1, 1, 1],
        cropBounds: {
          minX: 0,
          maxX: 1,
          minY: 0,
          maxY: 1,
          minZ: 0,
          maxZ: 1,
        },
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
        updateCropHandlePositions(runtime, cropHandleRefs.current)
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
      // Volume rays use texelFetch for hard in-plane edges, while the crop-face
      // cross-sections use filtered texture() sampling from this same texture.
      texture.minFilter = THREE.LinearFilter
      texture.magFilter = THREE.LinearFilter
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
          uLightDirection: { value: lightDirection(volumeSettings) },
          uSharpness: { value: volumeSettings.sharpness },
          uCropMin: { value: new THREE.Vector3(
            cropBounds.minX,
            1 - cropBounds.maxY,
            cropBounds.minZ,
          ) },
          uCropMax: { value: new THREE.Vector3(
            cropBounds.maxX,
            1 - cropBounds.minY,
            cropBounds.maxZ,
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
      const cropOutline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({
          color: 0x55e7f4,
          transparent: true,
          opacity: 0.88,
          depthTest: false,
          depthWrite: false,
        }),
      )
      cropOutline.renderOrder = 18
      root.add(cropOutline)
      const cropFaces = CROP_HANDLES.map((handle) => {
        const axis = handle.axis === 'x' ? 0 : handle.axis === 'y' ? 1 : 2
        const faceMaterial = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          vertexShader: cropFaceVertexShader,
          fragmentShader: cropFaceFragmentShader,
          uniforms: {
            uData: { value: texture },
            uAxis: { value: axis },
            uCoordinate: { value: cropBoundCoordinate(cropBounds, handle.bound) },
            uBoundsMin: { value: new THREE.Vector3(
              cropBounds.minX,
              1 - cropBounds.maxY,
              cropBounds.minZ,
            ) },
            uBoundsMax: { value: new THREE.Vector3(
              cropBounds.maxX,
              1 - cropBounds.minY,
              cropBounds.maxZ,
            ) },
            uWindow: { value: volumeSettings.window },
            uLevel: { value: volumeSettings.level },
          },
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
          depthTest: true,
        })
        const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faceMaterial)
        if (handle.axis === 'x') face.rotation.y = -Math.PI / 2
        else if (handle.axis === 'y') face.rotation.x = Math.PI / 2
        face.renderOrder = 16
        face.visible = false
        root.add(face)
        return face
      })

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
      sliceHighlight.visible = showSliceHighlight &&
        selectedSliceFraction >= cropBounds.minZ - 0.0001 &&
        selectedSliceFraction <= cropBounds.maxZ + 0.0001
      root.add(sliceHighlight)
      runtime.scene.add(root)
      runtime.volumeRoot = root
      runtime.volumeMesh = mesh
      runtime.volumeMaterial = material
      runtime.volumeTexture = texture
      runtime.sliceHighlight = sliceHighlight
      runtime.sliceMaterial = sliceMaterial
      runtime.sliceTexture = sliceTexture
      runtime.cropOutline = cropOutline
      runtime.cropFaces = cropFaces
      runtime.volumeSize = size
      runtime.cropBounds = cropBounds
      runtime.selectedSliceFraction = selectedSliceFraction
      runtime.sliceHighlightRequested = showSliceHighlight
      runtime.currentSeriesId = volume.seriesId
      updateCropOutline(runtime, cropEditing)
      updateCropFaces(runtime, cropEditing)
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
      material.uniforms.uLightDirection.value.copy(lightDirection(volumeSettings))
      material.uniforms.uSharpness.value = volumeSettings.sharpness
      const sliceMaterial = runtimeRef.current?.sliceMaterial
      if (sliceMaterial) {
        sliceMaterial.uniforms.uWindow.value = volumeSettings.window
        sliceMaterial.uniforms.uLevel.value = volumeSettings.level
      }
      const runtime = runtimeRef.current
      if (runtime) {
        runtime.cropFaces.forEach((face) => {
          const faceMaterial = face.material as THREE.ShaderMaterial
          faceMaterial.uniforms.uWindow.value = volumeSettings.window
          faceMaterial.uniforms.uLevel.value = volumeSettings.level
        })
        runtime.needsRender = true
      }
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
      const cropMin = runtime?.volumeMaterial?.uniforms.uCropMin.value as THREE.Vector3 | undefined
      cropMin?.set(
        cropBounds.minX,
        1 - cropBounds.maxY,
        cropBounds.minZ,
      )
      const cropMax = runtime?.volumeMaterial?.uniforms.uCropMax.value as THREE.Vector3 | undefined
      cropMax?.set(
        cropBounds.maxX,
        1 - cropBounds.minY,
        cropBounds.maxZ,
      )
      if (runtime?.sliceHighlight) {
        const width = cropBounds.maxX - cropBounds.minX
        const height = cropBounds.maxY - cropBounds.minY
        runtime.sliceHighlight.scale.set(width, height, 1)
        runtime.sliceHighlight.position.x =
          ((cropBounds.minX + cropBounds.maxX) * 0.5 - 0.5) * runtime.volumeSize[0]
        runtime.sliceHighlight.position.y =
          (0.5 - (cropBounds.minY + cropBounds.maxY) * 0.5) * runtime.volumeSize[1]
      }
      const sliceCrop = runtime?.sliceMaterial?.uniforms.uCrop.value as THREE.Vector4 | undefined
      sliceCrop?.set(cropBounds.minX, cropBounds.maxX, cropBounds.minY, cropBounds.maxY)
      if (runtime) {
        runtime.cropBounds = cropBounds
        runtime.renderer.domElement.parentElement?.setAttribute(
          'data-crop-bounds',
          [
            cropBounds.minX,
            cropBounds.maxX,
            cropBounds.minY,
            cropBounds.maxY,
            cropBounds.minZ,
            cropBounds.maxZ,
          ].map((value) => value.toFixed(4)).join(','),
        )
        updateCropOutline(runtime, cropEditing)
        updateCropFaces(runtime, cropEditing)
        updateSliceVisibility(runtime)
        if (!cropDragRef.current) recenterVisibleVolume(runtime)
        runtime.needsRender = true
      }
    }, [cropBounds, cropEditing])

    return (
      <div
        className="viewer-canvas"
        ref={containerRef}
        data-crop-cross-sections={cropEditing ? '6' : '0'}
      >
        {renderError ? (
          <div className="viewer-error" role="alert">
            <span>GPU unavailable</span>
            <p>{renderError}</p>
          </div>
        ) : null}
        {cropEditing ? (
          <div className="crop-3d-controls" role="group" aria-label="3D crop box handles">
            {CROP_HANDLES.map((handle) => (
              <button
                key={handle.id}
                ref={(element) => { cropHandleRefs.current[handle.id] = element }}
                className={`crop-face-handle crop-axis-${handle.axis}`}
                type="button"
                aria-label={handle.label}
                title={handle.label}
                onPointerDown={(event) => beginCropDrag(event, handle)}
                onPointerMove={updateCropDrag}
                onPointerUp={finishCropDrag}
                onPointerCancel={finishCropDrag}
              >
                {handle.shortLabel}
              </button>
            ))}
            <button
              ref={(element) => { cropHandleRefs.current.move = element }}
              className="crop-move-handle"
              type="button"
              aria-label="Move entire crop box"
              title="Move entire crop box"
              onPointerDown={beginMoveCropDrag}
              onPointerMove={updateCropDrag}
              onPointerUp={finishCropDrag}
              onPointerCancel={finishCropDrag}
            >
              <span aria-hidden="true">✥</span>
            </button>
            <div className="crop-3d-help">Drag faces to crop · Drag center to move · Orbit outside</div>
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
