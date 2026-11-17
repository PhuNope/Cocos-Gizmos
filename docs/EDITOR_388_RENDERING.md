# Editor 3.8.8: rendering, picking and HUD architecture

This is a **design review**, not a claim that the experimental controller
replacement has already shipped. No API compatibility with pre-v3 is required.

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

## Target architecture (Command Pattern, ports/adapters)

```text
Component declarations / Gizmos2D / Gizmos3D / Builder
                        |
              Gizmo presentation plan
          /             |              \
 GeometryRenderer3D  Graphics2D    SceneHudElement
          \             |              /
          Camera projection / handle geometry
                        |
           Screen/mesh picking service
                        |
      Editor GizmoOperation / controller adapter
                        |
          MoveCommand / RotateCommand
                        |
          Property port + EditSession
```

1. **Render port:** 3D lines, solids, depth state go to
   `GeometryRenderer`. 2D Canvas drawings go to `Graphics`. HUD widgets
   and *optional* pixel-aligned annotations go to Scene WebView DOM. Avoid
   HTML for world-space, depth-tested 3D primitives.
2. **Input port:** own native Editor `SelectGizmo` and its controllers;
   register narrow, custom mesh hit proxies against `GizmoOperation`.
   Only use native `ControllerBase`/`QuadController` where the active
   Editor runtime actually exposes them. Never instantiate a physics
   `BoxCollider`; remove the private `_cubeNode`,
   `_editHandlesShape`, `_wireFrameBoxNode` and +Y-face assumptions.
3. **Domain/application:** keep `MoveHitGeometry`,
   `PositionDragSolver`, `RotationDragSolver`,
   `GizmoMoveCommand`, `GizmoRotateCommand` and `GizmoEditSession`
   Editor-independent. The Editor adapter owns selection, mouse capture,
   native undo, scene lifecycle and inspector refresh.
4. **Lifecycle:** associate pick proxies with the target's selection;
   re-create them when the Scene camera or active Scene changes; release
   all proxy meshes and handlers on hide/dispose/reset; never leave
   invisible pickable objects.
5. **HUD:** `GizmoHudOverlay.diagnosticState.renderMode` reports `dom`,
   `texture` or `none`. Seeing a bottom bar alone does **not** prove
   that DOM mounting worked, because the textured renderer is a fallback.

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

## Rollout

Do not replace `PositionHandles.ts`'s BoxCollider-based native bridge by
guessing constructor paths. It is a private Editor implementation and the
shipped `.ccc` code is not ordinary source JS. First implement the new
`SelectGizmo` + controller adapter behind an explicit opt-in; run the
Editor smoke matrix above; only then switch the default and remove
BoxController shims and their tests. Draw code and command APIs need not
carry compatibility wrappers on v3.

This document stays in `docs/` (repository-only); the README remains a
summary of capabilities and the CHANGELOG/release notes describe shipped
changes.
