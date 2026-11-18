# Changelog

All notable changes to Cocos-Gizmos are documented here.

## [Unreleased]

## [3.0.2] - 2026-11-18

### Added
- `GizmoHUD.createHud()` fluent builder for nested row/column layouts, theme, placement, styling and size, with buttons, sliders, toggles and checkboxes.
- Reusable HUD command registry and persistent HUD lifecycle (`mount`, `update`, `show`, `hide`, `destroy`), alongside property-bound and callback-backed controls.
- Refreshed 2D, 3D, Decorator and Smoke Demo components using the new HUD API.

### Fixed
- Reworked Scene HUD input handling, including 3D hit-testing and interaction through the Editor Scene Operation when the embedded WebView does not receive pointer events.
- Prevented HUD pointer gestures from interfering with Scene node selection; improved button, checkbox, toggle and multi-frame slider drag handling, cancellation and rollback.
- Fixed stale 2D Move/Rotate hover highlights, canvas-offset/DPI pointer alignment and edits interrupted by transient Gizmo lifecycle or Inspector hook failures.
- Development ZIP extraction now produces a single versioned extension folder with no nested ZIP.

## [3.0.1] - 2026-11-15

### Added
- `Gizmos2D.rotate()` provides a Z rotation ring for Euler Vec3 degrees with smooth drag, optional angular snap and Undo/Redo.
- `Gizmos3D.rotate()` provides X/Y/Z rotation rings with local/world quaternion composition and a screen-space fallback for edge-on rings.
- Native annulus picking, on-hover coloring, Escape cancellation and persistent component examples for 2D and 3D.
- Open Document includes separate 2D and 3D rotation API examples.

## [3.0.0] - 2026-11-14

### Added
- Global `Gizmos2D.move()` handles with X/Y axes, XY plane dragging, undo/redo, precision movement and editable callbacks.
- `@registerGizmos(CustomDrawer)` for Editor-only Component gizmos in a separate class implementing `IDrawGizmos`.
- Configurable and interactive Scene HUD with buttons, toggles, checkboxes, sliders, click-to-set, `order`, `fontSize`, `size`, and control `width`.
- **Gizmos → Open Document** API panel and full-size standalone Open Document / Settings windows.
- Editor-only demonstrations packaged inside the extension.

### Improved
- Constant-pixel Move geometry at close/far zoom; softened 2D/3D arrow and plane borders and synchronized viewport camera changes.
- Drag/wheel repaints coalesced to prevent Editor stalls and delayed arrows.
- Safer 3D GeometryRenderer triangle budgeting, camera rebinds, arrow winding and preservation of user depth-test state.
- Extended Editor diagnostics, docs and automated regression suites.

### Migration
- Development branch renamed from `v2` to `v3` (maintainer updates the GitHub default branch in repository settings).
- Extension version is now `3.0.0`; Cocos Creator's manifest `package_version: 2` remains unchanged because it describes the manifest schema.
- Development ZIPs are uploaded to GitHub Actions under `Cocos-Gizmos-v3-<commit>`; no GitHub Release or version tag is created by a branch push.

## [2.0.3] - 2026-10-23

### Fixed
- `Gizmos3D.drawMesh()` now decodes RGB16F vertex POSITION values from half-float bits and accepts RGB32F, RGB16I and RGB16UI position formats using the Mesh attribute format.
- Resolve POSITION attributes through each primitive's `vertexBundelIndices` instead of assuming submesh index equals vertex-bundle index.
- Give actionable warnings naming the affected submesh and unsupported format, and invalidate cached positions when `Mesh.data` is replaced.
- Add regression tests for half floats, indices, submesh mapping, other position formats and cache invalidation.

### Compatibility and Notes
- Confirmed working by the project maintainer on Cocos Creator **3.8.8**. Editor-only runtime behavior is unchanged.
- When using `Gizmos3D.beginLocalPosition(node)`, pass `Vec3.ONE` for the mesh's additional local scale unless extra scaling is intended; `node.worldMatrix` already includes Node scale. Passing `node.worldScale` multiplies scale a second time.
- Wireframe rendering remains the default; pass `wireFrame: false` for solid triangles.

**Full Changelog:** https://github.com/PhuNope/Cocos-Gizmos/compare/v2.0.2...v2.0.3

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
