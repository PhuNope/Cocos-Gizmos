# Cocos-Gizmos

A Cocos Creator **3.8.2+ extension** providing two public classes: `Gizmos2D` and `Gizmos3D`.

## Install the extension

1. Download `Cocos-Gizmos-v2.0.0.zip` from GitHub Releases (or the CI artifact).
2. In Cocos Creator, open **Extensions → Extension Manager**, choose **Project** (or **Global**), click **Import Extension (+)** and select the ZIP.
3. Enable `cocos-gizmos`. The extension mounts its `dist/` folder as read-only project assets.

**Important:** The ZIP contains `package.json` **at its root**, plus `README.md` and `dist/`. Do not extract and import the two generated files separately. Do not add another enclosing directory inside the ZIP.

```text
Cocos-Gizmos-v2.0.0.zip
├── package.json
├── README.md
├── main.js       # Editor lifecycle: install TypeScript reference
└── dist/
    ├── Gizmos.js
    └── Gizmos.d.ts
```

When you enable the extension, its editor entry automatically creates `assets/cocos-gizmos.global.d.ts` in the **Cocos project**, containing a triple-slash reference to the extension's real `dist/Gizmos.d.ts`. This lets WebStorm and TypeScript see `Gizmos2D` and `Gizmos3D` without per-file imports. The generated file is safe to check into the project repository, but it contains a relative reference to the installed extension path; after moving the project or switching global/project installation, re-enable the extension to update it. Disabling the extension does not delete the bridge; remove it manually if you uninstall Gizmos.

For projects whose `tsconfig.json` has an explicit `include` or `files`, ensure `assets/cocos-gizmos.global.d.ts` is included. Then restart WebStorm's TypeScript Service if completions do not refresh. Cocos extensions outside project scope are not automatically discovered by WebStorm until this bridge is included.

The JS is a Cocos ES module; `cc` and `cc/env` are provided by the engine. `Gizmos.d.ts` declares both classes globally. The JS module must be evaluated for runtime globals to exist; do not call Gizmos in top-level initializers before script loading.

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

`npm run pack` type-checks the source, produces exactly `dist/Gizmos.js` and `dist/Gizmos.d.ts`, runs public-API tests and packages the **complete extension** into `release/Cocos-Gizmos-v2.0.0.zip`. Packaging is cross-platform and needs no extra zip tool.

The generated `.generated/Gizmos.ts` is an internal intermediate and is **not** shipped.

## Tag-triggered release

```bash
git switch dev
git pull origin dev
git tag v2.0.0
git push origin v2.0.0
```

On `v2.0.0`, GitHub Actions verifies that the tag equals the version in `package.json`, builds the plugin ZIP and publishes it with `Gizmos.js` and `Gizmos.d.ts` as additional individual assets. Development builds can be downloaded from Actions without tagging.

## Type-only companion repo

When `PhuNope/Cocos-Gizmos-Type` exists with a `main` branch and the main repository has Actions secret `TYPES_REPO_TOKEN` (Contents read/write access to the type repo) and repository variable `TYPES_REPO_READY=true`, a tag release synchronizes the declaration and matching tag to the companion repo.

Another project can install only its types:

```bash
npm install -D github:PhuNope/Cocos-Gizmos-Type#v2.0.0
```

That package does **not** install runtime behavior; use the extension ZIP for that.

See [Cocos Creator extension installation guide](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/install.html).
