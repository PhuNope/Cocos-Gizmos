# Changelog

All notable changes to Cocos-Gizmos are documented here.

## [Unreleased] — v3 development (not published)

### Added — Fluent HUD Builder and Commands (development API)
- `GizmoHUD.createHud()`: declarative, immutable row/column flex-tree with `width`, `height`, `grow`, `gap`, `padding`, `align`, `justify`, `text`, `slider`, `checkbox`, `toggle`, and `button`.
- `GizmoHUD.bind(property)` creates property Command descriptors; `GizmoHUD.action(handler)` creates Button actions. Component callback `onGizmoHUD()` returns the finished definition without touching DOM or Editor-only APIs.
- `GizmoHudCommandController` uses the existing application EditSession for begin/update/commit/cancel with rollback, including isolated native Inspector hook failures.
- `GizmoHudDomRenderer` turns the tree into a compact CSS Flexbox floating Scene HUD with real HTML inputs and stable DOM throughout held Slider gestures. No new runtime npm dependencies; Flexily's compositional node model inspired the builder, not the renderer implementation.
- The old Scene HUD grid remains a headless/texture fallback (flattening builder controls); native Editor Ctrl+Z for new DOM-backed Command sessions still requires Creator-side verification.
- Added 3D Builder demo, editor API documentation, public TypeScript completion and standalone builder/DOM/selection regression tests.


### Particle-style floating DOM HUD and 2D hover (development build)
- HUD controls in the Scene WebView are now real pointer-interactive DOM rows with a separate Command input port. Non-control areas remain pointer-transparent; outside clicks and native Scene selection still pass through.
- DOM Slider/button pointer events are captured directly by the control and forwarded to the existing Gizmo EditSession/Command layer. While a pointer is held, the HUD preserves its DOM nodes across Scene redraws and updates the slider readout/fill in place; browser pointerup and cancel explicitly finish the gesture.
- When the Scene runtime cannot access the WebView DOM, the existing textured HUD and Scene Operation input remain as fallback. This design borrows ParticleSystem's separation of UI controls from gizmo rendering; it does not depend on invoking the Editor-only `EngineView.attachFloatWindow()` from a Scene Script.
- Fix the 2D Move/Rotate hover exit delay: invalidate stale color-keyed Graphics immediately on hover transitions instead of retaining the previous highlighted stroke for 750ms. Hover enter/leave also bypasses the 32ms redraw throttle.
- Add simulated DOM capture, stable-slider and 2D color-cache regression tests.


### Fixes for Creator 3.8.8 input alignment and selection
- Map Scene Operation `clientX/clientY` through the actual `GameCanvas.getBoundingClientRect()` into the camera viewport coordinate system shared by Gizmo render, ray casting and HUD picking; preserve raw Editor coordinates only when canvas mapping is unavailable.
- Remove the HUD selection guard that forcibly re-selected a previously active Node; real Editor selection events now decide what remains selected, including switching from a test Node to another Node.
- Treat private SelectGizmo Inspector/Undo hook exceptions as nonfatal so 3D `size` Slider and HUD Button actions can finish the edit rather than failing after a single `update`. Warn once per failed hook to aid diagnostics.
- Add regression tests for DPI/canvas offset/Y inversion, changing Node selection, 3D ShapeSize slider and HUD Button with failing Editor hooks.


### Fixed — Scene input dispatch
- Route HUD controls and 2D/3D Move/Rotate through Creator 3.8.8 `cce.Operation` at priority 100, ahead of Editor Gizmo=99 and Camera=98. Returning `false` for a true plugin hit prevents the Editor's Scene-selection handler from canceling the gesture.
- Keep DOM and Cocos engine input routes only as fallbacks, not simultaneous listeners, and clear all listeners on Scene teardown.
- Continue registering screen-space controls even when another extension or an old Gizmo already occupies the Component's private Gizmo-pool key.
- Add native-operation priority, multi-frame slider/handle, hover, Escape, passthrough-selection, and occupied-Gizmo-pool regression tests.


### Input bridge rework (testing)
- Added `SceneViewportInput` to intercept mouse/pointer events at the Scene engine WebView's window capture phase, project coordinates into the Scene camera, and drive both 2D/3D handle Commands and HUD controls directly; native Scene selection still receives clicks outside plugin shapes.
- Added `SceneEngineInput` using Cocos `input` as a fallback when Scene Script has no WebView DOM access.
- Standalone `SelectGizmo` instance fallback now activates when the Editor Gizmo factory does not expose a mounted instance on a Component.
- When the Editor's private component Gizmo pool is absent, a standalone gesture host still supports Move/Rotate/HUD interactions via the input ports; diagnostics explicitly report `ready-direct-input-no-native-undo` because native Undo hooks are unavailable.
- Diagnostics include `handles.viewportInput` and `handles.engineInput` with active status and input counters to distinguish dispatch failures from picking failures.
- Automated tests cover WebView pointer and mouse capture, fallback engine mouse, native selection passthrough, hover, drag and HUD clicks.


### Fixed
- Restore Move/Rotate hover highlight when Editor dispatches `onGizmoMouseMove` rather than `onNotGizmoMouseMove`, without stealing native transform-tool input.
- Prevent HUD Button, Checkbox and Slider pointer events from propagating to the Scene picker. If Creator still issues a delayed `selection:unselect`, a short-lived gesture-specific selection lease restores only the original Node.
- Do not call native property Undo hooks using synthetic HUD Button identifiers such as `hud:reset`; these are actions, not serialized Component properties.
- Keep pending HUD Button clicks valid across layout refresh and temporary selection loss, using the captured control rectangle.


- Keep Move/Rotate and HUD Slider sessions alive across transient `SelectGizmo.hide()/destroy()` calls triggered by Cocos Creator 3.8.8 during property/Inspector refresh. Only actual mouse-up, Escape, or explicit Scene teardown ends the gesture.
- Arm native pointer capture before `onControlBegin()` so a synchronous Editor visibility rebuild cannot drop the first drag frame.
- Commit pending HUD button/checkbox clicks by stable control ID even when the Editor regenerates HUD descriptor objects between mouse-down and mouse-up.
- Report suppressed transient Gizmo lifecycle changes in Scene diagnostics for follow-up Editor testing.


### Added
- The new Scene adapter constructs Move/Rotate edits through the fluent `GizmoCommands` Builder API.
- New `EditorHandleAdapterV3` based on the Editor's `SelectGizmo` base instead of `BoxColliderComponentGizmo`; it owns Scene pointer capture and command integration.
- Split `GizmoViewportGeometry`, `GizmoHandleRenderer`, and `GizmoHitTest` into dedicated Editor geometry, rendering and picking ports for 2D and 3D.
- Regression tests for command gestures, HUD interactions, selection lifecycle and package contents.
- Declarative `size` presets or `{ width, height }` and CSS-like `style` properties on Scene HUD labels, buttons, sliders, toggles and checkboxes.
- Shared validation and size-aware hit rectangles for native Scene interaction.

### Changed
- GitHub Actions development artifacts extract directly to `Cocos-Gizmos-v<version>/` with no nested plugin ZIP. The independent release ZIP is still generated only for explicit tagged releases.
- Native transform-tool raycast hits remain owned by the Editor; the new SelectGizmo adapter only starts custom pointer gestures from its own handles or non-Gizmo Scene events.
- Editor ZIP now uses the new screen-space picking adapter and omits the old `PositionHandles.js` module; the legacy implementation remains as a test-only source reference pending live Creator 3.8.8 validation.
- Compact slate/teal Scene HUD dock replaces the original full-width blue bar in both DOM and textured fallback.
- Reduced HUD demo labels and styled the 3D/2D examples for clearer Scene View editing.


### Verification
- Automated tests and ZIP packaging validate the v3 implementation.
- Input routing, native Undo/Redo and overlapping-handle behavior must be tested manually in Cocos Creator 3.8.8 before tagging.

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
