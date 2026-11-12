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

The runtime is split across internal modules because Cocos Creator 3.8 rejects multiple decorated Components in a single script ("Each script can have at most one Component"). Only `Gizmos.js` is a public entry; consumers still have just two globals and don't import internal files.

The extension's root `main.js`, `scene.js`, and `editor-runtime/` are CommonJS for Cocos Editor processes. The `dist/Gizmos.js` reference entry uses ES module imports from `cc` and `cc/env` but is **not mounted into game assets**. The nested `dist/package.json` explicitly sets `type: module` so Cocos 3.8.x does not parse `Gizmos.js` as CommonJS. The `npm run pack` build validates both module formats using Node's syntax checker. `Gizmos.d.ts` declares both classes globally. The Editor Scene script installs runtime globals only in the Scene process; do not call Gizmos at top level before the Scene script loads.

In scripts running after startup (no per-file import needed):

```ts
Gizmos2D.drawCircle(this.node, { x: 0, y: 0 }, 100);
Gizmos3D.drawSphere(this.node, this.node.worldPosition, 1);
```

Components may implement `onDrawGizmos()` and `onDrawGizmosSelected()` for editor rendering, without a registration decorator. A smoke test in the actual Cocos editor/preview is recommended.

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

The extension registers `contributions.scene.script` for Editor runtime and `contributions.asset-db.mount` for type-only scripts. The Scene Script loads CommonJS modules from `editor-runtime/`. Only `editor-assets/GizmosGlobal.ts` is mounted into the Asset Database; the runtime modules are not game assets. `dist/Gizmos.d.ts` is generated for separately installed type packages.

The `onAfterBuild` hook strips **only** `onDrawGizmos()` and `onDrawGizmosSelected()` method definitions from compiled JavaScript. It does **not** remove helper methods, `if (EDITOR)` blocks, or unrelated method names. It does **not** validate remaining calls to `Gizmos2D` or `Gizmos3D`; if application code executes such a call in the built game, `ReferenceError` is possible by design. Your project TypeScript files are never modified.

CI tests simulate the builder output, validate the Scene Script manifest and run the callback stripper against a captured Cocos Creator 3.8.8 Web Mobile `System.register` example. A user also confirmed that the stripped output removes both callbacks and excludes the Gizmos runtime from a Cocos 3.8.8 Web Mobile build. Other build targets still require testing.

Web Mobile builds transpile component methods into comma-separated assignments such as `t.onDrawGizmos=function(){...}` inside `assets/main/index.js` (`System.register`). The stripper recognizes these assignments using TypeScript AST and deletes only the two callback assignments, preserving the surrounding comma expression, remaining functions, and JavaScript syntax. This is covered by a regression fixture copied from Cocos Creator 3.8.8 output.


## drawMesh() and Editor Scene updater (v2.0.2)

`Gizmos3D.drawMesh(node, mesh, position?, rotation?, scale?, wireFrame?)` renders
an imported readable `cc.Mesh` asset or a raw `{vertices: Vec3[], indices?: number[]}`.
Wireframe is the default; `wireFrame=false` draws filled triangles. See
`assets/GizmosDrawMeshTest.ts` for a 3D Scene example.

The Scene dispatcher is started/stopped with the editor extension, scans the
current Scene, and uses a 120ms idle fallback if Director updates stop.
Diagnostics from Editor DevTools:

```js
Editor.Message.request('scene', 'execute-scene-script', {
    name: 'cocos-gizmos', method: 'gizmosStatus', args: []
}).then(console.log);
```

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
