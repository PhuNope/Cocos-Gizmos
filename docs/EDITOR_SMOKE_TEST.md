# Scene View Smoke Test (Cocos Creator 3.8.8)

This test validates the Editor integration that cannot be fully exercised by
the automated TypeScript and Node.js regression suite.

## Prepare

1. Import the extension ZIP and enable **Cocos-Gizmos**. Verify that
   **Assets > cocos-gizmos** does **not** contain an auto-mounted Examples folder.
2. Choose **Gizmos > Install Example** from the top-level Editor menu.
   The extension copies editable sample Components into **Assets > Example**
   (`db://assets/Example`) in the open project. It also installs the local
   `RegisterGizmos.ts` dependency and stable `.meta` files.
3. Once AssetDB finishes importing, open **Gizmos Settings > Check example assets**.
   The 2D, 3D, Smoke and Decorator components should be **imported** and
   **registered**. The installer never overwrites `assets/Example` if that
   folder already exists, so manually rename/remove your own copies if you
   intentionally want a fresh installation.
4. Select a test Node and drag a demo Component from **Assets > Example**
   into the Inspector. Test both 2D and 3D Scenes, then save.
5. Edit a demo file, click **Gizmos > Install Example** again, and confirm
   that the local modification is retained. The extension does not remove
   project examples when disabled or updated.

The installer leaves an existing Example folder untouched, including its
UUID metadata. If AssetDB refresh fails, the copied files remain in
`assets/Example`; reopen/refresh the Assets panel to trigger import.

For diagnostics, `database-not-ready`, `missing`, `query-failed`,
`uuid-mismatch` or `wrong-importer` indicate incomplete project assets
or an import problem. `not-registered` or `not-component` indicate a
Scene class problem; `scene-unavailable` means the Scene class query
could not be completed.

Use disposable Scenes and Prefabs for tests. Do not ship demo components
in production unless they are intentionally part of the game.


## Read-only diagnostics

The Settings panel reports the Scene updater, selection API, camera methods,
the built-in component Gizmo controller bridge and active handles.

For a more detailed report in Editor Developer Tools:

```js
Editor.Message.request('scene', 'execute-scene-script', {
    name: 'cocos-gizmos',
    method: 'gizmosSmokeReport',
    args: [],
}).then(console.log);
```

An active Scene should report `scene.updaterStarted: true`. An installed
Scene controller bridge should report `bridge.colliderControllerAvailable:
true`. Selecting the test Node should increase `handles.active`,
`handles.positionHandles` and `handles.hudControls` if registration succeeds.

**A positive diagnostic report is not proof of mouse picking or Undo/Redo.**
The Cocos component Gizmo pool is a private Editor API and may differ between
Creator versions. If the controller bridge is missing, visual drawing
callbacks may still work, but interactive handles cannot be assumed to work.

## Manual checks

- **2D drag:** Select the Node. Drag `point` around all four XY quadrants,
  including positions more than 100 units from its origin. Check the five-unit
  snap increment in Inspector.
- **Vec3 array:** Move both checkpoints. Check each `checkpoints[i]` value.
- **HUD:** Click Show Range toggle, Show Grid checkbox and Reset Radius button.
  Drag the Radius slider repeatedly. Inspector should show the live values.
  Check a custom `width: 220`, `size: 'large'` slider: click the middle
  of the visible track (no move), drag from that position, then press Escape.
  The mouse must hit the painted track and rollback must restore the value.
- **Multiple components on one Node:** Attach both 2D and 3D API test
  components to the same test Node (or create two lightweight components with
  duplicate label and control IDs). Their HUD lines should appear in separate
  groups with a blank row between them. Click a control in the second group:
  only the second component's property should change. Turn off the first
  component's HUD and confirm that the second group shifts upward without
  leaving invisible picking markers.
- **Rotation gizmos (2D + 3D):** Select a `CocosGizmos2DDemo` or
  `CocosGizmos3DDemo` Node, look for a blue Z ring (2D) or red X, green
  Y and blue Z rings (3D) centered on the Node. Try clicking an empty
  center (should not grab), dragging Z through 360 degrees, X/Y while
  the camera looks edge-on, and hovering then zooming. Confirm the
  `rotationEuler` property updates, a single Undo restores the value,
  Escape cancels in-progress rotation, and deselection/reselection restores
  the rings. Repeat after Scene switches or rotating/scaling a Parent.
- **Undo / Redo:** Perform one continuous nontrivial drag, release the pointer,
  press Ctrl+Z once, then Ctrl+Shift+Z. Compare the Scene position and
  Inspector value with the original and final values. Test Button, Toggle,
  Checkbox and Slider separately; **do not assume** all four operations have
  native Undo until personally verified.
- **Cancel:** Start dragging a point or slider and press Escape. Confirm that
  its value returns to the original value, with no unexpected Undo entry.
- **Lifecycle:** Begin dragging, change the selection to another Node, close
  and reopen the Scene. Confirm the old marker is hidden and no gesture is
  accidentally committed.
- **Prefab instance:** Repeat the Position, Toggle and Slider checks on a
  Prefab instance. Ensure that the Inspector's Prefab override indicator and
  Undo/Redo history agree with the changed serialized values.
- **Camera:** Pan, zoom and switch between orthographic 2D and perspective 3D.
  HUD text and picking markers should remain aligned. If the Scene camera is
  temporarily unavailable, HUD picking markers should disappear and then
  reappear automatically when the camera returns, without duplicated listeners.

## Cocos Creator 3.8.8 controller compatibility

The standalone Gizmo marker is expected to respond to pointer up even when
the mouse is released outside the marker. Check Position Handles, HUD sliders,
and Button/Toggle/Checkbox clicks, including releases outside their hit area.
An outside release of a HUD button does not activate the button.

Selecting a Node must not log either of these errors:

- `onNotGizmoMouseUp is not a function`
- `Cannot read properties of undefined (reading 'topNode')`

The extension uses standalone cube picking markers. It does **not** initialize
BoxController editable face handles or call `BoxController.updateSize()`,
which relies on private editable handle state in Creator 3.8.8.

After replacing a development build, close and reopen the Editor project to
ensure that old Gizmo instances and operation listeners are no longer active.
If the errors remain, copy the full Scene Console stack trace and the results
from **Extensions → Gizmos Settings → Check Scene integration**.

## Re-selecting a 2D Node and bounded Label sizes

1. Select the Node with `CocosGizmos2DDemo`, confirm three visible
   22px draggable markers, then select another Node and immediately select
   the original Node again. Repeat rapidly and after leaving it unselected
   for at least 250ms. Its points and picking listeners must return each time.
2. With each demo selected, zoom close and far. HUD text should stay in
   the default 12–24px height range. The 2D and 3D example labels use
   optional explicit min/max values in `drawLabel()`.
3. Check both kinds of HUD: one component nested beneath **Canvas** and
   another in a 3D Scene. The Canvas HUD now uses the existing 2D
   `RenderRoot2D`, not an extra 3D UI root.
4. If labels are still invisible, click **Check Scene integration**.
   Inspect `scene.hudDrawn`, `hud.lastPath`, `hud.drawn2D`,
   `hud.drawn3D`, `hud.cameraMissing` and `hud.projectionFailed`.
   A nonzero `hud.drawn2D` or `hud.drawn3D` means the label was
   submitted to the renderer, not necessarily visible in the actual Scene
   camera. `hud.projectionFailed` indicates invalid camera/ray geometry.
   Capture the report and Console errors if a HUD remains invisible.

## Zoom, UI layers, drag-point and Sprite sizing regression

- **HUD and Labels:** With the demo Node selected, zoom extremely close and
  zoom far away in both Scene 2D and 3D. Text should remain legible and must
  not disappear after one engine frame. UI overlay nodes render on the
  camera-visible `UI_3D | GIZMOS` mask. Recheck **Check Scene integration**
  and note `scene.hudDrawn` if informational HUD lines are still absent.
- **Position points in 2D:** Each cube picking marker should occupy roughly
  **22 screen pixels** regardless of zoom or Node scale. Drag each
  `point`/`waypoints` marker, release and verify that the cube stays aligned
  with its Inspector value. The 2D example intentionally constrains each
  editable point to x = -600…600 and y = -450…450 in local coordinates.
  If a previous test left a point off-screen, reset its Inspector value to
  (0, 0, 0) or reset the demo component before retrying.
- **3D Sprite:** Assign a large SpriteFrame (e.g., 1024 × 1024). The demo now
  fits its longest image side to about **1.5 world units**, instead of
  multiplying a texture's native pixels by a hard-coded 0.4 scale.
- **Idle Editor Scene:** Leave the pointer idle while labels are visible for
  a few seconds. 2D and 3D Label/Sprite caches now tolerate up to 750ms
  without a drawing callback so Creator's 250ms watchdog does not cause
  flicker. Removing a label may take at most this grace period.

## Diagnose missing HUD and point handles (Creator 3.8.8)

The Scene Editor may expose `cce.Camera._camera.camera`, a
`renderer.scene.Camera` with **out-first** signatures:
`worldToScreen(out, world)` and `screenPointToRay(out, x, y)`. A game
`cc.Camera` Component uses `worldToScreen(world, out)` and
`screenPointToRay(x, y, out)`. Mixing these conventions can leave ordinary
Gizmos geometry visible while HUD labels and point picking fail.

The extension now resolves the correct convention automatically. In
**Extensions → Gizmos Settings → Check Scene integration**, confirm:
- `bridge.cameraConvention` is `render-camera` when the Scene View uses its
  internal renderer camera; `component-camera` is also supported.
- `bridge.cameraWorldToScreen` and `bridge.cameraScreenPointToRay` are true.
- Select a demo Node and inspect `scene.hudDrawn`: this cumulative value should
  increase during updates that submit HUD labels. If it stays at zero, check
  `scene.selectedNodeCount` and the component's HUD setting.
- `handles.positionHandles`, `handles.hudControls`, and `handles.active`
  help identify whether the controller bridge created any editable markers.

A nonzero `scene.hudDrawn` confirms that the extension submitted labels, not
that Cocos rendered them visibly. A registered controller is not proof that
the Editor routed mouse events to it. The exact remaining failure should be
diagnosed from the Scene report and Scene Console.

## Diagnose Scene mouse picking

1. Select a Node with Gizmo handles and open
   **Extensions → Gizmos Settings → Check Scene integration**.
2. Click a visible position handle, drag it a short distance, then release.
3. Run **Check Scene integration** again and compare the
   `handles.input` counters:
   - `controllerDown` / `controllerMove` indicate that the
     standalone marker controller received the pointer events.
   - `gizmoDown` / `gizmoMove` show calls delivered to the
     component Gizmo by Scene Operation. Some Editor builds use only one
     dispatch route, so it is not necessary for both to increase.
   - `outsideUp` shows the Scene released the pointer outside a Gizmo.
   - `missingPointer` shows a down event that could not be converted
     to Scene coordinates, which prevents starting a drag.
   - `ignoredUp` counts mouse-up callbacks from a controller other than the
     one that started the drag or click. Those callbacks must not end the gesture.
   - `committedClick` / `cancelledClick` count confirmed and cancelled HUD
     Button/Toggle/Checkbox clicks.
   - `recent` contains only event names (at most 16 entries); no
     pointer positions or project data are recorded.
4. If neither down counter increases, the Editor has not delivered the
   click to the custom Gizmo. If the counters increase but values do not
   change, report the event counts and the full Scene Console output.

For HUD picking, controls have 22-pixel row spacing and a roughly
14-pixel square marker. A control's marker must not cover neighboring rows.
Click a Toggle, move the mouse to another HUD control, and release: the first
control should not activate when released by a different controller. Sliders
should continue tracking while moving beyond their marker and should close
only on the owning controller or the Scene operation's drag release.

Showing/hiding a component repeatedly should not multiply registered
listeners. The adapter registers each controller once per visible lifecycle;
the next show registers it again after the corresponding unregister.
The test suite checks this behavior with an Editor controller stub.

## If a check fails

Capture the **Gizmos Settings → Check Scene integration** result, relevant
Creator Console error, Creator version (including patch), and the exact
operation that failed. The report is read-only and omits project paths.
The most useful details are the `bridge` fields, `handles.reason`, handle
counts and `scene.callbackErrors`.

Automated tests validate the gesture transaction hooks and in-memory rollback,
but the native Editor history and Prefab override behavior require these
manual checks.
