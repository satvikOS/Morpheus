# Neurovisualization Engine

## Current engine

The Morpheus 3D Neuro Space uses Three.js / React Three Fiber with a custom scientific volume path:

- `Data3DTexture` scalar volume storage
- GLSL3 fragment-shader ray marching
- configurable transfer threshold, density, brightness
- axial / coronal / sagittal multiplanar slice inspection
- NIfTI-1 / NIfTI-2 import through `nifti-reader-js`
- high-density point rendering
- connectome graph rendering
- interactive and UHD display modes

The synthetic 64³ brain phantom is an engineering fixture, not anatomy ground truth.

## Rendering roadmap

### Surface engine
- GIFTI / FreeSurfer cortical surfaces
- glTF/GLB meshes
- cortical overlays and parcellations
- tractography line sets

### Volume engine
- larger NIfTI volumes with worker-side preprocessing
- transfer-function presets
- overlays / label maps
- world-space orientation transforms
- affine registration display
- 4D time-series volumes

### Scientific viewport
- linked 3D + axial + coronal + sagittal views
- shared crosshair and world coordinates
- measurement tools
- ROI selection
- atlas labels
- reproducible camera/view state

### GPU evolution
The current production path is WebGL2-compatible GLSL volume rendering. WebGPU capability is detected but not falsely presented as the active renderer. A later WebGPU compute/render path can be introduced after feature parity and browser fallback are validated.
