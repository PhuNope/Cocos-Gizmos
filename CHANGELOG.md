# Changelog

All notable changes to Cocos-Gizmos are documented here.

## [Unreleased]

### Fixed
- `Gizmos3D.drawMesh()` now decodes RGB16F vertex POSITION values from half-float bits and accepts RGB32F, RGB16I and RGB16UI position formats using the Mesh attribute format.
- Resolve POSITION attributes through each primitive's `vertexBundelIndices` instead of assuming submesh index equals vertex-bundle index.
- Give actionable warnings naming the affected submesh and unsupported format, and invalidate cached positions when `Mesh.data` is replaced.
- Add regression tests for half floats, indices, submesh mapping, other position formats and cache invalidation.

## [2.0.2] - 2026-10-23

### Added
- `Gizmos3D.drawMesh(node, mesh, position?, rotation?, scale?, wireFrame?)` for drawing imported `cc.Mesh` assets or custom `{ vertices: Vec3[], indices?: number[] }` triangle data in the Scene Editor.
- Wireframe rendering by default, optional filled triangles (`wireFrame: false`), translation, Euler rotation, scale, Gizmos color, depth testing and local-space positioning.
- `assets/GizmosDrawMeshTest.ts` sample Component and TypeScript tests for the new API.
- `gizmosStatus` / `gizmosTick` diagnostics to inspect the Editor Scene updater and drawing callbacks.

### Fixed
- Gizmos callbacks not updating after installing the extension in a new project or reloading a Scene, despite successful global initialization.
- Removed the stale `sessionStorage` guard: the updater is started on extension load and cleaned up on unload.
- The updater now resolves the current Scene, detects Components defining either Gizmos callback and only calls `onDrawGizmosSelected()` for selected Nodes.
- Added a 120 ms fallback when the engine Director is idle, plus safe delayed initialization of the 3D GeometryRenderer until a camera is available.
- Build verification now requires `Define.js` imports only in modules that actually import `Define`.

### Compatibility and Notes
- Confirmed working by the project maintainer in Cocos Creator **3.8.8**; automated build, TypeScript and extension packaging checks pass.
- Imported `Mesh` assets must expose readable Float32 XYZ position data; compressed or non-readable meshes may not render.
- **Editor Only**: Gizmos modules remain outside the game runtime; the build hook strips `onDrawGizmos()` and `onDrawGizmosSelected()` from generated game scripts, but does not remove unrelated helper methods.
- Experimental Scene button / HTML overlay features are **not** included.

**Full Changelog:** https://github.com/PhuNope/Cocos-Gizmos/compare/v2.0.1...v2.0.2

## [2.0.1] - 2026-10-21

- Editor-only Scene runtime and global `Gizmos2D` / `Gizmos3D` APIs.
- Extension ZIP, global TypeScript declarations and a build-time callback-strip mechanism for game builds.

**Full Changelog:** https://github.com/PhuNope/Cocos-Gizmos/compare/v2.0.0...v2.0.1
