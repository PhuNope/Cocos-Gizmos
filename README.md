# Cocos-Gizmos

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

A Cocos Creator **3.8.2+ extension** providing two public classes: `Gizmos2D` and `Gizmos3D`.

## Optional Gizmos callbacks (no registration decorator)

Components can implement `onDrawGizmos()` and `onDrawGizmosSelected()` directly.
Neither callback needs `@registerGizmos` or an import of the extension runtime.

```ts
import { _decorator, Color, Component, Vec2 } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('RangeGizmo')
export class RangeGizmo extends Component {
    @property
    radius = 100;

    onDrawGizmos(): void {
        Gizmos2D.beginColor(this.node, Color.GREEN);
        Gizmos2D.drawCircle(this.node, Vec2.ZERO, this.radius);
    }

    onDrawGizmosSelected(): void {
        Gizmos2D.drawLine(this.node, Vec2.ZERO, new Vec2(this.radius, 0));
    }
}
```

When the extension is enabled, the Scene View finds these methods automatically.
`onDrawGizmos()` draws for enabled components, and
`onDrawGizmosSelected()` draws only while the node is selected.

### Using only TypeScript definitions

The `Gizmos.d.ts` declarations provide global API types but do not install
JavaScript globals. A game project that has only the type definitions can still
compile and load components written as shown above: the Gizmos functions are
used only inside the optional Scene View callbacks, which are not invoked by
the game lifecycle.

Keep `Gizmos2D` and `Gizmos3D` calls inside those two callbacks. If game
lifecycle methods need to use them, first check that the Editor runtime exists:

```ts
if (typeof Gizmos2D !== 'undefined') {
    Gizmos2D.drawCircle(this.node, Vec2.ZERO, 100);
}
```

When building a game without the extension, there is no Gizmos build hook.
The unused callback methods may remain in the compiled JavaScript, but the
game does not call them automatically. Calls made explicitly from gameplay
code still require a runtime guard. The type-only package does not provide
`@registerGizmos`; avoid using that decorator.

## Install the extension

1. Download `Cocos-Gizmos-v2.0.3.zip` from GitHub Releases (or the CI artifact).
2. In Cocos Creator, open **Extensions → Extension Manager**, choose **Project** (or **Global**), click **Import Extension (+)** and select the ZIP.
3. Enable `cocos-gizmos`. The Scene Script handles Editor drawing, and the read-only `cocos-gizmos` asset package supplies global TypeScript declarations.

**Important:** The ZIP contains `package.json` **at its root**, plus `README.md` and `dist/`. Do not extract and import the two generated files separately. Do not add another enclosing directory inside the ZIP.

```text
Cocos-Gizmos-v2.0.3.zip
├── package.json
├── README.md
├── main.js       # Editor extension lifecycle
├── scene.js      # Editor-only scene loader
├── editor-assets/
│   └── GizmosGlobal.ts  # Type-only global definitions
├── editor-runtime/ # CommonJS runtime, never added to game asset-db
├── builder.js
├── build/         # Build-time callback stripper
└── dist/
    ├── package.json    # type: module — runtime files are ESM
    ├── Gizmos.js       # type/public API reference entry; not game-mounted
    ├── Gizmos.d.ts     # declarations for type-only consumers
    ├── Gizmos2D.js     # ESM reference module (not game-mounted)
    ├── Gizmos3D.js     # ESM reference module (not game-mounted)
    ├── Define.js       # environment helpers
    └── ExecuteGizmos.js # editor auto-discovery
```

When enabled, the extension mounts `editor-assets/GizmosGlobal.ts` through the
Asset Database at `db://cocos-gizmos/GizmosGlobal.ts`. The file contains
TypeScript declarations only and does not generate files in the game's
`assets/` directory or install any game runtime code.

The Editor can index scripts in the mounted package. Global names are available
without per-component imports when the mounted asset belongs to its TypeScript
program. For external IDEs, ensure the TypeScript project includes the mounted
declaration. IDE discovery in Cocos Creator 3.8.8 should be verified using the
installed extension.

When upgrading a project that previously generated
`assets/cocos-gizmos.global.d.ts`, delete that obsolete file from the project's
assets directory. The Editor logs a warning if it remains so duplicate global
declarations can be resolved safely. The extension never removes or replaces
project files.

The runtime is split across internal modules because Cocos Creator 3.8 rejects multiple decorated Components in a single script ("Each script can have at most one Component"). Only `Gizmos.js` is a public entry; consumers still have just two globals and don't import internal files.

The extension's root `main.js`, `scene.js`, and `editor-runtime/` are CommonJS for Cocos Editor processes. The `dist/Gizmos.js` reference entry uses ES module imports from `cc` and `cc/env` but is **not mounted into game assets**. The nested `dist/package.json` explicitly sets `type: module` so Cocos 3.8.x does not parse `Gizmos.js` as CommonJS. The `npm run pack` build validates both module formats using Node's syntax checker. `Gizmos.d.ts` declares both classes globally. The Editor Scene script installs runtime globals only in the Scene process; do not call Gizmos at top level before the Scene script loads.

In scripts running after startup (no per-file import needed):

```ts
Gizmos2D.drawCircle(this.node, { x: 0, y: 0 }, 100);
Gizmos3D.drawSphere(this.node, this.node.worldPosition, 1);
```

Components may implement `onDrawGizmos()` and `onDrawGizmosSelected()` for editor rendering, without a registration decorator. A smoke test in the actual Cocos editor/preview is recommended.

## 2D Gizmos rendering

`Gizmos2D` records each shape as a drawing command and combines compatible
stroke paths using the same RGBA color and render layer. Filled shapes remain
separate so overlapping fills retain their drawing behavior. The renderer
reuses Graphics components and skips geometry updates when the recorded
commands are unchanged from the previous Scene frame.

Use `beginColor()` and `beginLayer()` to group compatible shapes without
creating separate drawing components:

```ts
onDrawGizmos(): void {
    Gizmos2D.beginColor(this.node, Color.GREEN);
    Gizmos2D.drawCircle(this.node, { x: 0, y: 0 }, 100);
    Gizmos2D.drawCircle(this.node, { x: 0, y: 0 }, 200);
    Gizmos2D.drawLine(this.node, { x: -100, y: 0 }, { x: 100, y: 0 });
}
```

Drawing callbacks remain available without a registration decorator.
`Gizmos3D` uses the Scene geometry renderer to draw 3D primitives.

## 3D Gizmos rendering

`Gizmos3D` submits primitives to the Scene geometry renderer. Color state is
snapshotted when `beginColor()` is called and shared by subsequent primitives
until the color changes. Local-space coordinates passed between
`beginLocalPosition()` and `endLocalPosition()` follow the Node world
transform, including rotation and scale.

`drawMesh()` supports readable Mesh assets and vertex/index arrays. For
filled indexed meshes, shared vertices are transformed once per draw. Labels
and sprites are updated when drawn and automatically hidden when omitted from
the following Scene update, without resetting unchanged content every frame.

The Scene callback scheduler refreshes the selection snapshot regularly while
keeping component discovery separate from every-frame drawing. Draw callbacks
remain active every Scene frame so animated Gizmos still update.

## Position Handles in the Scene View

Declare `onGizmoHandles()` on a component to expose editable Vec3 properties
while its node is selected. The component does not need a registration decorator
or any runtime import.

```ts
import { _decorator, Component, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('LineHandles')
export class LineHandles extends Component {
    @property(Vec3)
    startPoint = new Vec3(-150, 0, 0);

    @property(Vec3)
    endPoint = new Vec3(150, 0, 0);

    onGizmoHandles(): GizmoHandleList {
        return [
            { property: 'startPoint', plane: 'xy', space: 'local', snap: 5 },
            { property: 'endPoint', plane: 'xy', space: 'local', snap: 5 },
        ];
    }

    onDrawGizmosSelected(): void {
        Gizmos2D.beginLocalPosition(this.node);
        Gizmos2D.drawLine(this.node, this.startPoint, this.endPoint);
        Gizmos2D.endLocalPosition(this.node);
    }

    onGizmoChanged(property: string, phase: GizmoHandlePhase): void {
        // Respond to handle edits when dependent component values need refreshing.
    }
}
```

- `plane`: `xy`, `xz`, `yz` or `view`. Use `xy` to move a point around
  a 2D Node. Movement is not restricted by a maximum distance.
- `space`: `local` (default) or `world`. The plane follows the node
  transform in local space.
- `axis`: optional `x`, `y` or `z` to allow movement on only one axis.
- `snap`: positive step size in the selected coordinate space.
- `bounds`: optional `min` and `max` per coordinate axis.
- `index`: use when the property is an array of `Vec3` positions.
- `color`: optional hex color for the handle marker.

All handle definitions have named **global TypeScript types**. Type
`onGizmoHandles(): GizmoHandleList` to enable field completion in the
returned objects. The available names are `GizmoHandleDescriptor`,
`GizmoHandleList`, `GizmoHandlePlane`, `GizmoHandleSpace`,
`GizmoHandleAxis`, and `GizmoHandlePhase`. They require no runtime import.
For standalone handle objects, annotate `const handle: GizmoHandleDescriptor`.

The callback name is exactly `onGizmoHandles()` (singular `Gizmo`,
plural `Handles`). The editor includes this optional method in the
`Component` type. To receive property completion inside a method,
keep the explicit `: GizmoHandleList` return type.

Dragging invokes `onGizmoChanged(property, phase, index?)` for the
`begin`, `update`, and `end` phases. Escape cancels an active drag,
restores its starting value, and reports `cancel`. The Editor controller
also receives begin/update/end calls for its normal change tracking.

The extension uses the Editor component Gizmo controller when it is available.
If the current Cocos Creator version does not expose that controller, drawing
callbacks continue working but editable handles remain unavailable.
Use `gizmosHandleStatus` in Scene DevTools to inspect registration:

```js
Editor.Message.request('scene', 'execute-scene-script', {
    name: 'cocos-gizmos',
    method: 'gizmosHandleStatus',
    args: []
}).then(console.log);
```

Component handle declarations contain data only. Projects with type definitions
but without the extension can load these components normally; the game does
not invoke these Editor callbacks automatically.

## Scene View display settings and HUD

Open **Extensions → Gizmos Settings** to configure default visibility without
modifying project files. The two controls are **Gizmo display** (`Always`,
`Selected`, `Off`) and **HUD labels** (`Selected`, `Always`, `Off`).
The settings are applied to the active Scene View and do not modify Game builds.

A component can use regular serialized `@property` fields in the Cocos
Inspector and expose their values through `onGizmoSettings()`. The Inspector
continues to render the component's own fields without a replacement renderer.

```ts
import { _decorator, Component, Enum } from 'cc';

const { ccclass, property } = _decorator;

enum GizmoVisibility {
    Always = 0,
    Selected = 1,
    Off = 2,
}

@ccclass('RangeGizmoView')
export class RangeGizmoView extends Component {
    @property({ type: Enum(GizmoVisibility) })
    gizmoVisibility = GizmoVisibility.Selected;

    @property
    hudEnabled = true;

    onGizmoSettings(): GizmoViewSettings {
        return {
            display: ['always', 'selected', 'off'][this.gizmoVisibility] as GizmoDisplayMode,
            hud: this.hudEnabled ? 'selected' : 'off',
        };
    }

    onGizmoHud(): GizmoHudItem[] {
        return [
            { id: 'name', text: this.node.name, order: 0, color: '#ffffff' },
            { id: 'mode', text: 'Range preview', order: 1, fontSize: 14 },
        ];
    }
}
```

Use stable `id` values to reuse HUD Label components between Scene frames.
The HUD is positioned near the node in the Scene View, not drawn into the game.
A component may return up to 24 text entries; unsupported colors and invalid
entries fall back to safe values or are skipped. HUD text updates only when
the underlying label content changes, while projection follows Scene camera
movement.

A per-component `onGizmoSettings()` result overrides the default panel settings.
The `display` option controls `onDrawGizmos()` and `onDrawGizmosSelected()`.
The `hud` option controls `onGizmoHud()` independently. Both callbacks are
optional; the extension is not required for game runtime.

To inspect HUD activity from Developer Tools:

```js
Editor.Message.request('scene', 'execute-scene-script', {
    name: 'cocos-gizmos',
    method: 'gizmosHudStatus',
    args: []
}).then(console.log);
```

## Interactive HUD controls

Components can return buttons, sliders, toggles, and checkboxes from
`onGizmoHudControls(): GizmoHudControlList`. The Editor displays these controls
beside the node in Scene View. A toggle displays `[ON]` or `[OFF]`, and a
checkbox displays `[x]` or `[ ]`. Click them to flip a serialized
boolean property; sliders drag a numeric property.

```ts
import { _decorator, Component } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('GizmoHudExample')
export class GizmoHudExample extends Component {
    @property
    showRange = true;

    @property
    showGrid = false;

    @property
    radius = 50;

    onGizmoHudControls(): GizmoHudControlList {
        return [
            { type: 'toggle', id: 'range', text: 'Range', property: 'showRange' },
            { type: 'checkbox', id: 'grid', text: 'Grid', property: 'showGrid' },
            {
                type: 'slider', id: 'radius', text: 'Radius',
                property: 'radius', min: 0, max: 200, step: 5,
            },
            { type: 'button', id: 'reset', text: 'Reset' },
        ];
    }

    onGizmoHudAction(id: string): void {
        if (id === 'reset') this.radius = 50;
    }

    onGizmoHudChanged(
        property: string,
        phase: GizmoHandlePhase,
        value: number | boolean,
    ): void {
        // Handle dependent values after a Scene HUD edit.
    }
}
```

The HUD uses stable control IDs and reuses the Scene label renderer. Each
component's text HUD computes one screen-to-world projection from three camera
rays per render pass; all labels reuse that projection for positioning and
scale. Interactive HUD markers share a projection within their update pass.
Changes to control text or current values update labels without rebuilding
picking controllers. Structural changes (ID, type, bound property, range,
color, or control order) refresh the affected controller layout.

**Multiple components on one Node:** HUD labels are namespaced per Component
and laid out in component-discovery order, with one blank 22-pixel row between
component groups. Each control's picking marker uses the same planned row as
its rendered label. Two components can both use `id: 'title'` or
`id: 'radius'` without overwriting each other's labels, and hiding one
component's HUD moves following groups up automatically. You do not need to
invent globally unique IDs; IDs only need to be unique within each component's
own text entries or control list. The layout is recalculated once per Scene
update and shared with the interactive adapter.

Toggle
and checkbox clicks are applied when the pointer is released, and cancelled
clicks leave the property unchanged. Slider edits notify
`onGizmoHudChanged()` during `begin`, `update`, `end`, and `cancel`.
Boolean edits notify `begin`, `update`, and `end` for successful clicks.
The Editor component change handler is notified after a property edit.

Each drag opens one change transaction and closes it once on mouse release.
Only changes to the actual property value trigger update notifications.
Pressing Escape or changing the selected Node cancels an unfinished drag and
restores the starting serialized value. A cancelled or unchanged gesture uses
the controller's cancellation hook when available. The Editor's native undo
and inspector integration is provided through the component Gizmo controller.
Verify Ctrl+Z / Ctrl+Shift+Z with Cocos Creator 3.8.x before shipping.

For component state derived from serialized fields, use the Cocos
`onRestore()` lifecycle callback to resynchronize derived values after
an Inspector reset or Undo/Redo operation.

Interactive HUD controls appear for selected nodes when HUD visibility is
enabled. They require the compatible Editor Gizmo controller. The extension
does not add runtime JavaScript to the game; these optional callbacks can
remain in a project using only the TypeScript declarations.

## Drag-and-drop test Components from the extension Assets

The development extension mounts three **read-only TypeScript Components** in
the Cocos Creator Asset DB, not just in the ZIP's loose `examples/` directory:

| Cocos Assets location | Component | Tests |
| --- | --- | --- |
| `db://cocos-gizmos/Examples/CocosGizmos2DDemo.ts` | `CocosGizmos2DDemo` | 2D shapes, Position Handles, HUD |
| `db://cocos-gizmos/Examples/CocosGizmos3DDemo.ts` | `CocosGizmos3DDemo` | 3D geometry, Mesh, Position Handles, HUD |
| `db://cocos-gizmos/Examples/CocosGizmosSmokeDemo.ts` | `CocosGizmosSmokeDemo` | Serialized fields, HUD controls, Prefab/Undo smoke checks |

After installing/enabling the ZIP and letting the Asset Database refresh,
expand **Assets → cocos-gizmos → Examples**. Select a Scene Node in the
Hierarchy and **drag the desired `.ts` script onto that Node's Inspector**.
This attaches the Component; there is no need to manually copy the script into
your project's `assets/` folder. The extension mount remains read-only.
You can also add the Component by class name in Inspector if Creator lists it.

To verify that Creator has actually imported the mounted scripts, open
**Extensions → Gizmos Settings → Check example assets**. The report now
checks **two separate systems** without modifying your project:

- **Asset DB:** Queries `asset-db/query-asset-info` for each demo script,
  distinguishing `imported`, `missing`, `not-imported`, `invalid`,
  `uuid-mismatch`, `wrong-importer`, `query-failed` and
  `database-not-ready`.
- **Scene class registry:** Checks `cc.js.getClassByName()` and whether the
  registered class derives from `cc.Component`. Each demo reports
  `registered`, `not-registered`, `not-component`,
  `registry-unavailable` or `scene-unavailable`. A Scene reload or an
  unavailable Scene process is **not** treated as a missing class.

Successful Asset DB import and Scene registration are stronger evidence that
Cocos recognized the component, but still **do not prove** that dragging
the script into the Inspector, rendering the Gizmo or native Undo/Redo works.
Those steps require testing inside Cocos Creator 3.8.8.

The mounted samples have `CocosGizmos*` class names to avoid conflicts with
previously copied `Gizmos2DApiTest`, `Gizmos3DApiTest`, and `GizmoSmokeProbe`
scripts. Their committed `.meta` UUIDs remain stable across extension
updates. The ZIP also retains editable original copies under `examples/`.

**Do not rely on these components for production.** Mounted samples are
regular Cocos script assets when referenced by a Scene/Prefab; remove test
components before shipping. Disabling/uninstalling the extension can make
existing sample-component references appear as Missing Script. These are
different from the extension's Editor-only Scene Script.

### Scene View overlays, zoom and 2D drag stability

The Editor Scene viewer can draw geometry while failing to render UI text if
its `RenderRoot2D` labels or sprites use an invisible camera layer. The 3D
Gizmos helper now uses `UI_3D | GIZMOS` for those overlays, compensates
parent Node scale in world space and billboards them with the Scene camera.
Informational HUD labels also clamp their minimum world scale at extreme
close zoom.

A 2D or 3D Label/Sprite persists for 750ms after its last draw callback
before it is cleared, avoiding flicker when Cocos runs the Scene Script's
250ms watchdog rather than receiving every engine frame. The 2D Position
Handle cube targets roughly 22 screen pixels (previously 10) and uses world
scale to avoid shrinking under scaled Canvas/Node hierarchies.

The bundled 2D examples bound all draggable test points to a finite test
area. The bundled 3D example sizes an imported SpriteFrame relative to its
native dimensions so large textures no longer render hundreds of world units
wide. See `docs/EDITOR_SMOKE_TEST.md` for manual zoom, idle and drag tests.

### Creator 3.8.8 Scene camera and missing HUD

If Gizmos lines or shapes render but **HUD text and draggable points are
missing**, install the current `v2` build. The Editor's internal
`renderer.scene.Camera` uses `worldToScreen(out, world)` and
`screenPointToRay(out, x, y)`; the public `cc.Camera` Component uses the
opposite argument order. The Scene camera compatibility bridge now supports
both without guessing by calling the wrong signature.

Use **Extensions → Gizmos Settings → Check Scene integration** to inspect
`bridge.cameraConvention` and `scene.hudDrawn` along with the existing
`handles.active`, `handles.positionHandles`, `handles.hudControls` and
`handles.input` counters. `hudDrawn` counts HUD submissions, not confirmed
on-screen rendering. Cocos 3.8.8's private Gizmo controller picking still
requires real Editor verification.

## Verify in Cocos Creator 3.8.8

Open **Extensions → Gizmos Settings → Check Scene integration** to view the
live Editor connection status without modifying scene data. The report checks
the selected-node API, camera projection, component Gizmo controller bridge,
active handle counts and currently running editor callbacks. It also lists
checks that cannot be verified automatically, including real mouse picking,
native Undo/Redo and Prefab override tracking.

The development extension ZIP contains the mounted `editor-assets/Examples/`
Components, the editable sources under `examples/`, and
`docs/EDITOR_SMOKE_TEST.md`. Drag a mounted Component from the extension
Assets package into a Node's Inspector, or copy an editable source into your
project's `assets/` folder if you need to customize it. The extension never
creates files in the project's `assets/` directory. Follow the guide for
drag/cancel, HUD controls, Scene lifecycle, Prefabs and Undo/Redo.

The component Gizmo pool and controller hooks are private Editor interfaces.
A green CI or a successful compatibility probe cannot guarantee that they
support real pointer events or native Undo/Redo in your local Creator build.

## Build locally

```bash
npm ci
npm run pack
```

`npm run pack` type-checks source, generates `dist/Gizmos.d.ts` and the type-only `editor-assets/GizmosGlobal.ts`, runs API tests, and packages the complete extension into `release/Cocos-Gizmos-v2.0.3.zip`.

The generated `.generated/Gizmos.ts` is an internal intermediate and is **not** shipped.

## Release workflow

Pushes to `v2`, `dev`, and `master` run build and tests without publishing. To publish, create and push a version tag matching `v<package.json version>`. The tag workflow then publishes the extension ZIP and declarations. Type-only repository synchronization runs only when configured.

## Type-only companion repo

When `PhuNope/Cocos-Gizmos-Type` exists with a `main` branch and the main repository has Actions secret `TYPES_REPO_TOKEN` (Contents read/write access to the type repo) and repository variable `TYPES_REPO_READY=true`, a tag release synchronizes the declaration and matching tag to the companion repo.

Another project can install only its types:

```bash
npm install -D github:PhuNope/Cocos-Gizmos-Type#v2.0.3
```

That package does **not** install runtime behavior; use the extension ZIP for that.

See [Cocos Creator extension installation guide](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/install.html).


## Editor-only build handling

The extension registers `contributions.scene.script` for Editor runtime and `contributions.asset-db.mount` for type-only scripts. The Scene Script loads CommonJS modules from `editor-runtime/`. The Asset Database mounts the generated `editor-assets/GizmosGlobal.ts`
type declarations **and** the three optional sample Components under
`editor-assets/Examples/`. The `editor-runtime/` implementation is not mounted
and is not part of the game asset graph. Mounted examples are ordinary Cocos
scripts when a Scene/Prefab references them and should be removed before
building a production game. `dist/Gizmos.d.ts` is generated for separately installed type packages.

The `onAfterBuild` hook strips **only** `onDrawGizmos()` and `onDrawGizmosSelected()` method definitions from compiled JavaScript. It does **not** remove helper methods, `if (EDITOR)` blocks, or unrelated method names. It does **not** validate remaining calls to `Gizmos2D` or `Gizmos3D`; if application code executes such a call in the built game, `ReferenceError` is possible by design. Your project TypeScript files are never modified.

CI tests simulate the builder output, validate the Scene Script manifest and run the callback stripper against a captured Cocos Creator 3.8.8 Web Mobile `System.register` example. A user also confirmed that the stripped output removes both callbacks and excludes the Gizmos runtime from a Cocos 3.8.8 Web Mobile build. Other build targets still require testing.

Web Mobile builds transpile component methods into comma-separated assignments such as `t.onDrawGizmos=function(){...}` inside `assets/main/index.js` (`System.register`). The stripper recognizes these assignments using TypeScript AST and deletes only the two callback assignments, preserving the surrounding comma expression, remaining functions, and JavaScript syntax. This is covered by a regression fixture copied from Cocos Creator 3.8.8 output.


## drawMesh() and Editor Scene updater (v2.0.2)

`Gizmos3D.drawMesh(node, mesh, position?, rotation?, scale?, wireFrame?)` renders
an imported readable `cc.Mesh` asset or a raw `{vertices: Vec3[], indices?: number[]}`.
Wireframe is the default; `wireFrame=false` draws filled triangles. See
`assets/GizmosDrawMeshTest.ts` for a 3D Scene example.

The Scene dispatcher starts and stops with the editor extension. It draws
callbacks on each engine frame so animated 2D/3D Gizmos remain responsive,
while component discovery and selection lookups use separate caches.
A 250 ms idle watchdog updates the Scene when Director frames pause.
The watchdog does not redraw when an engine frame arrived recently, and
recursive update requests are coalesced.

Diagnostics from Editor DevTools:

```js
Editor.Message.request('scene', 'execute-scene-script', {
    name: 'cocos-gizmos', method: 'gizmosStatus', args: []
}).then(console.log);
```

The status includes `engineFrames`, `fallbackFrames`, `timerSkips`, and
`reentrantSkips`. Increasing `timerSkips` while moving the Scene View means
the watchdog is correctly deferring to engine updates. `fallbackFrames`
increases when the Scene needs updates while Director is paused.

The build stripper still removes only the two Gizmos callbacks, not arbitrary
helper methods. The extension runtime remains Editor-only.


## Mesh POSITION format compatibility (v2.0.3)

Cocos-Gizmos v2.0.3 reads imported Mesh POSITION attributes in RGB32F,
RGB16F (half-precision), RGB16I and RGB16UI formats. It uses the submesh's
`vertexBundelIndices` to find the actual position attribute; submesh index
is not necessarily the vertex-bundle index. Unsupported formats now log
which submesh and attribute format could not be processed. Static imported
mesh data is cached and invalidated when the underlying `Mesh.data` buffer
is replaced. This fix is included in release **v2.0.3**.

When using `beginLocalPosition(node)`, pass `Vec3.ONE` as the Gizmos mesh
scale unless additional local scaling is intended, since `node.worldMatrix`
will be applied by the renderer.
