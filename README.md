# Lumen MRI Volume Studio

Lumen is a client-only MRI viewer with a scan-library homepage, transparent WebGL volume rendering, a standard 2D slice viewer, and a linked split workspace. It has no backend, authentication, analytics, or scan upload: locally opened DICOM bytes stay in the browser.

The app includes 21 de-identified, preprocessed sequences from two complete studies:

- 15 brain MRI sequences
- 6 left-shoulder MRI sequences
- 743 image layers in total

Hover a library card to preview its layers, then open it in 3D, 2D, or split view. The selected 2D layer can be displayed as a highlighted plane inside the 3D reconstruction.

## Run locally

```bash
npm install
npm run dev
```

The homepage opens to the included scan library. Choose **Open scan** to inspect another local DICOM folder. Chrome and Edge use the native directory picker; other browsers receive a directory-enabled file input fallback.

## Features

- Continuous Three.js ray-marched volumes with physical voxel spacing and dynamic camera fitting
- Shape-aware, bidirectionally registered synthetic slices generated in a background worker for seamless through-plane reconstruction with preserved acquired images and sharpened anatomical boundaries
- Diagnostic-style 2D slice canvas with orientation markers, layer position, window/level, slider, buttons, and scroll navigation
- Physical distance rulers in millimeters plus rectangular ROI measurements with area and mean signal, stored independently on each slice
- Linked 2D/3D split view with an optional highlighted slice plane
- Instant Enhanced/Acquired 3D comparison, true orthographic isometric projection, and a clickable A/P/L/R/S/I anatomical view cube
- Shared six-face crop volume with live cross-section textures, projected face handles, whole-box translation, two-sided depth cropping, a synchronized 2D ROI, and automatic recentering
- 90° dataset rotations and axial, side, top, and perspective camera presets
- Transfer-function presets, threshold, opacity, window, level, ray detail, live 3D sharpening, thermal and custom three-stop color maps, and depth-range controls
- Controllable directional volume lighting with intensity, azimuth, elevation, and Front/Side/Rim presets
- Browser Back navigation and Lumen-brand navigation to the library
- Fullscreen, auto-orbit, reset, and PNG capture
- Responsive desktop and mobile layouts
- Web Worker DICOM indexing and decoding

The voxel/point-cloud renderer has been removed.

## Supported DICOM pixel data

- Implicit VR Little Endian (`1.2.840.10008.1.2`)
- Explicit VR Little Endian (`1.2.840.10008.1.2.1`)
- Explicit VR Big Endian (`1.2.840.10008.1.2.2`)
- JPEG Lossless Process 14 (`1.2.840.10008.1.2.4.57` and `.70`)
- JPEG 2000 Lossless/Lossy (`1.2.840.10008.1.2.4.90` and `.91`)

Unsupported transfer syntaxes are marked unavailable instead of being decoded incorrectly.

## Keyboard shortcuts

Press `?` in the viewer (or the Help control in the stage toolbar) for the full in-app sheet, including 2D pan/zoom, window/level, and mouse modifiers.

- `1`: 3D volume
- `2`: 2D slice
- `3`: linked split view
- `↑` / `,`: previous slice
- `↓` / `.`: next slice
- `Home` / `End`: first / last slice (pauses cine)
- `Space`: toggle cine play (2D and split layouts)
- `R`: reset 3D view
- `F`: fullscreen workspace
- `S`: save the active rendering
- `L`: scan library
- `?`: open / close shortcut sheet

## Build and verify

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev
```

End-to-end QA opens both included studies and captures the library, 2D, split, shoulder, and mobile views under the ignored `artifacts/` directory.

To rebuild the included normalized assets from the original studies:

```bash
BRAIN_SCAN_SOURCE=/path/to/brain \
SHOULDER_SCAN_SOURCE=/path/to/shoulder \
npm run build:examples
```

Only normalized 8-bit intensity data, dimensions, spacing, orientation, and non-identifying descriptions are bundled. Original DICOM headers, patient identifiers, UIDs, and dates are not included.

## Deployment

Pushes to `main` build and deploy the static app through GitHub Pages. The workflow configures the Vite base path for `https://theodorecharles.github.io/LumenMRI/`.

Lumen is a visualization workspace, not a certified medical device, and must not be used for diagnosis or treatment decisions.
