# Scene View Smoke Test (Cocos Creator 3.8.8)

This test validates the Editor integration that cannot be fully exercised by
the automated TypeScript and Node.js regression suite.

## Prepare

1. Install the development extension ZIP and enable **Cocos-Gizmos**.
2. In **Extensions → Gizmos Settings**, press **Check Scene integration**.
3. Copy the extension ZIP's `examples/GizmoSmokeProbe.ts` into the Cocos
   project's `assets/` directory. This is an **optional test component**:
   the extension does not create files in the project's assets directory.
4. Let Creator import the script, create a test Node and attach the
   `GizmoSmokeProbe` component. Save the Scene.
5. Repeat the same steps with an instance of a test Prefab.

Do not edit project source or delete a Prefab override automatically as part
of this test. Use a disposable Scene/Prefab and commit or back up your project
before testing Undo/Redo.

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
  HUD text and picking markers should remain aligned.

## If a check fails

Capture the **Gizmos Settings → Check Scene integration** result, relevant
Creator Console error, Creator version (including patch), and the exact
operation that failed. The report is read-only and omits project paths.
The most useful details are the `bridge` fields, `handles.reason`, handle
counts and `scene.callbackErrors`.

Automated tests validate the gesture transaction hooks and in-memory rollback,
but the native Editor history and Prefab override behavior require these
manual checks.
