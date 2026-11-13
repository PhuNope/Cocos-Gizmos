# Scene View Smoke Test (Cocos Creator 3.8.8)

This test validates the Editor integration that cannot be fully exercised by
the automated TypeScript and Node.js regression suite.

## Prepare

1. Install the development extension ZIP and enable **Cocos-Gizmos**.
2. In **Extensions → Gizmos Settings**, press **Check Scene integration**.
3. Wait for the Asset Database to refresh. Expand
   **Assets → cocos-gizmos → Examples**. Three mounted scripts are available:
   `CocosGizmos2DDemo.ts`, `CocosGizmos3DDemo.ts`, and
   `CocosGizmosSmokeDemo.ts`.
4. Create a test Node in the Hierarchy, select it, and drag
   **CocosGizmosSmokeDemo.ts from Assets into the Inspector** to attach the
   component (or use **Add Component**). You can attach the other two demos to
   separate test Nodes for 2D and 3D rendering. Save the Scene.
5. Repeat on a Prefab instance. The mounted scripts are read-only; to edit
   their code, use the optional original sources in the ZIP's `examples/`
   directory and copy those files into your own project's `assets/`.
   The extension does not automatically copy any files to your project assets.

Do not edit project source or delete a Prefab override automatically as part
of this test. Use a disposable Scene/Prefab and commit or back up your project
before testing Undo/Redo.

Mounted demo classes have unique `CocosGizmos*` names and stable `.meta` UUIDs
so they do not collide with earlier manually copied sample scripts. Removing
or disabling the extension may leave a Missing Script reference on any
Scene/Prefab that uses a mounted demo. Remove demo components before shipping
production builds; mounted examples are regular game-visible script assets,
unlike the extension's Editor-only Scene runtime.

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
- **Multiple components on one Node:** Attach both 2D and 3D API test
  components to the same test Node (or create two lightweight components with
  duplicate label and control IDs). Their HUD lines should appear in separate
  groups with a blank row between them. Click a control in the second group:
  only the second component's property should change. Turn off the first
  component's HUD and confirm that the second group shifts upward without
  leaving invisible picking markers.
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
