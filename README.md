# Cocos-Gizmos

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

A Cocos Creator **3.8.2+ extension** providing two public classes: `Gizmos2D` and `Gizmos3D`.

## Install the extension

1. Download `Cocos-Gizmos-v2.0.2.zip` from GitHub Releases (or the CI artifact).
2. In Cocos Creator, open **Extensions → Extension Manager**, choose **Project** (or **Global**), click **Import Extension (+)** and select the ZIP.
3. Enable `cocos-gizmos`. The extension's Scene Script initializes Gizmos in the Scene Editor; it does not mount JS runtime into the game asset database.

**Important:** The ZIP contains `package.json` **at its root**, plus `README.md` and `dist/`. Do not extract and import the two generated files separately. Do not add another enclosing directory inside the ZIP.

```text
Cocos-Gizmos-v2.0.2.zip
├── package.json
├── README.md
├── main.js       # Editor lifecycle: install TypeScript reference
├── scene.js      # Editor-only scene loader
├── editor-runtime/ # CommonJS runtime, never added to game asset-db
├── builder.js
├── build/         # Build-time callback stripper
└── dist/
    ├── package.json    # type: module — runtime files are ESM
    ├── Gizmos.js       # type/public API reference entry; not game-mounted
    ├── Gizmos.d.ts     # global types for WebStorm
    ├── Gizmos2D.js     # ESM reference module (not game-mounted)
    ├── Gizmos3D.js     # ESM reference module (not game-mounted)
    ├── Define.js       # environment helpers
    └── ExecuteGizmos.js # editor auto-discovery
```

When you enable the extension, its editor entry automatically creates `assets/cocos-gizmos.global.d.ts` in the **Cocos project**, containing a triple-slash reference **and direct ambient declarations for both `Gizmos2D` and `Gizmos3D`**. The direct declarations are inside the consuming project so WebStorm can index the names for completion when typing `Gizmo`, not only resolve properties after a complete identifier. The declarations point to the extension's real `dist/Gizmos.d.ts`. This lets WebStorm and TypeScript see `Gizmos2D` and `Gizmos3D` without per-file imports. The generated file is safe to check into the project repository, but it contains a relative reference to the installed extension path; after moving the project or switching global/project installation, re-enable the extension to update it. Disabling the extension does not delete the bridge; remove it manually if you uninstall Gizmos.

For projects whose `tsconfig.json` has an explicit `include` or `files`, ensure `assets/cocos-gizmos.global.d.ts` is included. With the extension enabled, this is normally covered by `assets/**/*`. Then restart WebStorm's TypeScript Service and reindex if completions do not refresh. GitHub CI exercises TypeScript Language Service prefix completion; WebStorm's private completion engine must still be checked in the actual IDE. Cocos extensions outside project scope are not automatically discovered by WebStorm until this bridge is included.

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

`npm run pack` type-checks the source, produces exactly `dist/Gizmos.js` and `dist/Gizmos.d.ts`, runs public-API tests and packages the **complete extension** into `release/Cocos-Gizmos-v2.0.2.zip`. Packaging is cross-platform and needs no extra zip tool.

The generated `.generated/Gizmos.ts` is an internal intermediate and is **not** shipped.

## Release workflow

Push a version bump to `dev` and wait for CI to pass, then merge `dev` into `master`. The `master` workflow validates and packages the plugin, creates the `v2.0.1` tag for this version, publishes the extension ZIP and standalone `Gizmos.js` / `Gizmos.d.ts`, and syncs the Types companion repository when configured. Tags and releases are not created on `dev`.

## Type-only companion repo

When `PhuNope/Cocos-Gizmos-Type` exists with a `main` branch and the main repository has Actions secret `TYPES_REPO_TOKEN` (Contents read/write access to the type repo) and repository variable `TYPES_REPO_READY=true`, a tag release synchronizes the declaration and matching tag to the companion repo.

Another project can install only its types:

```bash
npm install -D github:PhuNope/Cocos-Gizmos-Type#v2.0.1
```

That package does **not** install runtime behavior; use the extension ZIP for that.

See [Cocos Creator extension installation guide](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/install.html).


## Editor-only build handling

The extension now registers `contributions.scene.script` instead of `contributions.asset-db.mount`. Cocos runs `scene.js` in the Editor Scene process; it loads separate CommonJS modules from `editor-runtime/`. These files are **not project assets**, so Cocos does not import the Gizmos runtime into the built game. The existing `dist/Gizmos.d.ts` remains available to WebStorm via the project's generated `assets/cocos-gizmos.global.d.ts`.

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
