# Cocos-Gizmos v3 — kiến trúc Editor (nhánh phát triển)

## Các tầng đang sử dụng

```text
Component descriptors / Gizmos2D & Gizmos3D / HUD size+style
                             |
              GizmoPresentationService / GizmoHudLayout
                 |                  |                 |
     GizmoHandleRenderer      SceneHudElement      GizmoHudOverlay
          |                  (WebView DOM)         (texture fallback)
          +-------------+---------------------------+
                        |
           GizmoViewportGeometry (camera projection)
                        |
               GizmoHitTest (screen math)
                        |
      EditorHandleAdapterV3 (SelectGizmo events/selection)
                        |
          GizmoMoveCommand / GizmoRotateCommand
                        |
               GizmoEditSession / value port
```

- **Domain:** `GizmoHandlePresets`, `PlaneHandleGeometry`,
  `AxisHandleGeometry`, `MoveHitGeometry`,
  `RotationHandleGeometry`, `PositionDragSolver` and
  `RotationDragSolver` do not depend on the Editor or render layer.
- **Application:** `GizmoMoveCommand`/`GizmoRotateCommand` accept a
  value port and lifecycle hooks; `GizmoEditSession` owns begin/update,
  rollback and end.
- **Editor geometry adapter:** `GizmoViewportGeometry` resolves the Scene
  camera, transforms component values into world space and projects the
  same axis, plane, point, box and ring for presentation and picking.
- **Rendering:** `GizmoHandleRenderer` uses `Gizmos2D` (`Graphics`)
  on Canvas nodes, and `Gizmos3D` (`GeometryRenderer`) on 3D nodes.
  Rendering creates no `BoxCollider` or native Controller.
- **Picking:** `GizmoHitTest` tests screen-space shape descriptors, HUD
  rectangles and ring strokes without any mesh or Controller reference.
- **Editor input adapter:** `EditorHandleAdapterV3` creates a
  `SelectGizmo` subclass from the registered Editor prototype chain.
  It consumes `GizmoOperation` callbacks (`onGizmoMouse*`,
  `onNotGizmoMouse*`, `onKeyDown`), owns the single captured gesture,
  invokes commands, and forwards edits to the Inspector/Undo hooks.
  It does **not** inherit `BoxColliderComponentGizmo`, read its
  `_cubeNode` / `_editHandlesShape` internals, or spawn a physics
  collider.
- **HUD:** `SceneHudElement` mounts an optional non-intercepting DOM
  element into the engine WebView. `GizmoHudOverlay` retains a compact
  textured UI fallback if the DOM is inaccessible. Both renderers share
  the HUD grid and native pointer geometry.

## Public API

No new mandatory Component API. Existing declarations remain simple:

```ts
onGizmoHandles(): GizmoHandleList {
    return [
        ...Gizmos3D.move('position', { snap: .25, pickSize: 28 }),
        ...Gizmos3D.rotate('euler', { space: 'local' }),
    ];
}
onGizmoHudControls(): GizmoHudControlList {
    return [
        { id:'radius', type:'slider', text:'Radius',
          property:'radius', min:0, max:100,
          size:'small', style:{color:'#dce7ef'} },
    ];
}
```

The render and input infrastructure is Editor-only. Game builds continue
to remove Editor Gizmo drawing callbacks.

## Build and tests

`scene.js` loads `EditorHandleAdapterV3.js`.
`scripts/build.mjs` emits only the new geometry/render/picking adapters
into `editor-runtime/`; `scripts/pack.mjs` whitelists these files and
**excludes** the legacy `PositionHandles.js` from the installed ZIP.

Legacy `source/PositionHandles.ts` is still in the repository solely as
a regression reference until manual Editor validation completes. It is
not loaded or shipped in the development extension.

Tests include `tests/editor-handle-adapter-v3.mjs` for standalone
SelectGizmo and command lifecycle, `tests/command-architecture.mjs`,
`tests/hud-layout.mjs` and `tests/packaged-selection.mjs`.
The old PositionHandles tests remain to catch semantic regressions in
geometry and gesture behavior while the replacement is being tested.

**Validation needed on Creator 3.8.8:** Scene 2D/3D, perspective and
orthographic cameras, gizmo vs non-gizmo event routing, overlapping
handles, selection transitions, HUD slider dragging and button release,
middle pan/right orbit, Escape, Undo/Redo, prefab overrides and Scene
tab switching. The automated suite exercises simulated Editor events,
not real Electron mouse input. Do not tag or release until testing is
approved.
