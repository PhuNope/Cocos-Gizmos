# Editor 3.8.8: rendering, picking and HUD architecture

This records the Editor 3.8.8 API review and the **new v3 development
implementation**. It is built into development ZIPs, but has **not** yet been
validated through live Editor mouse interaction or approved for release.
No pre-v3 API compatibility is required.

## Findings from the supplied Creator 3.8.8 Editor build

The Editor's **Scene panel** Shadow DOM contains `engine-view.scene`.
The rendering document is a separate engine WebView, with
`#GameDiv > #Cocos3dGameContainer > canvas#GameCanvas` in the 3D template
and `div#GameCanvas` in the 2D template. Do not mount scene HUD widgets into
a user Canvas or the Editor's root panel. A `SceneHudElement` can mount
inside the engine WebView when its document is available.

Extracted Editor type declarations under
`builtin/scene/@types/cce/public/gizmos/` define:

- `components/base/gizmo-select.d.ts`: `GizmoBase` (exported as
  `SelectGizmo`), with target/show/hide lifecycle and
  `shouldRegisterGizmoOperationEvent`.
- `controller/base.d.ts`: `ControllerBase` offers `initHandle`,
  `removeHandle`, `registerEvents`, transforms and hover callbacks.
- `controller/quad.d.ts`, `controller/point.d.ts`,
  `node/position-controller.d.ts`: specialized native controllers.
- `gizmo-operation.d.ts`: pointer down/move/up are routed through
  native raycasting and Gizmo / non-Gizmo event dispatch.
- `components/box-collider/gizmo-select.d.ts`: a *BoxCollider editor
  Gizmo* extends `SelectGizmo<BoxCollider>` and creates a BoxController.

The plugin's `source/PositionHandles.ts` currently inherits from the
*Editor BoxColliderComponentGizmo*, **not** the engine's physics
`cc.BoxCollider` component. This allows reusing a private BoxController
and native +Y editable face as a picking proxy. Rendering is already
separate: `Gizmos3D.ts` uses the Scene camera `GeometryRenderer`, and
`Gizmos2D.ts` uses `Graphics`. The tight coupling is **interaction /
picking**, not the shape-drawing APIs.

## Implemented development architecture (Command Pattern, ports/adapters)

The active Scene runtime now uses `EditorHandleAdapterV3` instead of the
old BoxCollider-derived `PositionHandles`. It subclasses the Editor's
base `SelectGizmo` (resolved from a registered component Gizmo prototype,
without depending on a specific BoxCollider class) and uses both
`onGizmoMouse*` and `onNotGizmoMouse*` events from `GizmoOperation`.
It does **not** create ControllerBase, QuadController, physics colliders
or native mesh-picking proxies. The old module remains in source for test
comparison only and is omitted from the installer.

```text
Component descriptors / HUD callbacks
              |
       GizmoViewportGeometry
        /          \
GizmoHandleRenderer  GizmoHitTest
 |      |                |
Gizmos2D Gizmos3D       SelectGizmo event adapter
(Graphics)(Geometry)     |
             GizmoMoveCommand / GizmoRotateCommand
                         |
                 GizmoEditSession
```

`GizmoHandleRenderer` draws in the Scene camera's GeometryRenderer (3D)
or Gizmos2D Graphics (2D); HUD is a separate DOM surface when available
and textured fallback otherwise. Shared world/viewport geometry drives
the hit-test so visible shapes and picking use consistent coordinates.

**Trade-off:** switching to a controller-free SelectGizmo means an
existing native mesh handle is no longer a raycast target; the adapter
relies on Editor operation-level pointer callbacks even for a
non-Gizmo hit. This is intentionally simpler and removes private
BoxController state, but routing while other native gizmo tools are
active and real Electron pointer capture needs verification in Creator
3.8.8. If operation-level callbacks cannot reliably capture drags,
introduce a small dedicated Editor input port rather than re-inherit
BoxColliderComponentGizmo.

## What to verify in the real Editor before removing BoxController

- Scene 2D and 3D, perspective and orthographic cameras, and switching tabs.
- Selected / deselected / reselected same Node, Scene replacement, Reset.
- Move X/Y/Z, XY/XZ/YZ, rotate rings, point markers, hovering and overlapping picks.
- Left pointer drag versus middle-pan / right-orbit, Escape cancellation,
  no-op, undo/redo and Inspector updates.
- HUD button, slider, toggle, checkbox, layout after resize and zoom;
  mouse-up outside a captured control.
- No ghost picking or GPU meshes after releasing a Gizmo.
- Varying screen DPI and 2D Canvas transformations.
- Packaging in versioned `Cocos-Gizmos-v<version>/` ZIP root.

## Release policy

The controller-free architecture is enabled in v3 development builds.
Run the manual Editor smoke matrix above, fix confirmed behavior
regressions, and receive approval before creating a version tag or
GitHub Release.
