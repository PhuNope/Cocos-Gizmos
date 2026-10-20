# Cocos-Gizmos

Gizmos helpers for Cocos Creator 3.8.2+ with **two public classes**: `Gizmos2D` and `Gizmos3D`.

## Build

```bash
npm ci
npm test
```

The generated `dist/` directory contains exactly two files:

- `Gizmos.js` — a single Cocos ES module, with only two named exports, that installs `globalThis.Gizmos2D` and `globalThis.Gizmos3D`.
- `Gizmos.d.ts` — the public API types (including Cocos `Component.onDrawGizmos` hooks) with global declarations.

The TypeScript intermediate `.generated/Gizmos.ts` is excluded from the package and releases. Cocos provides the `cc` and `cc/env` imports; those engine modules are **not** bundled.

## Use in Cocos Creator

Download the ZIP from GitHub Releases and put **both** files in the Cocos project's `assets/` folder. Alternatively build this extension and let its asset-db mount expose `dist/`.

Once the module has been evaluated by Cocos (load it once during startup if your project does not load scripts automatically), scripts can directly use:

```ts
Gizmos2D.drawCircle(this.node, { x: 0, y: 0 }, 100);
Gizmos3D.drawSphere(this.node, this.node.worldPosition, 1);
```

No per-file import is needed. The classes also support explicit named imports. Do **not** expect the `.d.ts` file alone to execute or load runtime code. If your project invokes Gizmos at top-level, import/load the runtime first; call sites inside lifecycle methods can run after startup.

In editor mode, components defining `onDrawGizmos()` or `onDrawGizmosSelected()` are auto-discovered. No decorator is necessary.

## Release by tag

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions runs `npm test`, creates `Cocos-Gizmos-v1.0.0.zip` containing exactly `Gizmos.js` and `Gizmos.d.ts`, and publishes a GitHub Release with the ZIP plus both individual files.

## Type-only repository (optional until created)

1. Create `PhuNope/Cocos-Gizmos-Type` with a `main` branch.
2. In **this** repository set the Actions secret `TYPES_REPO_TOKEN` to a fine-grained PAT granted **Contents: Read and write** on that type repository.
3. Set this repository's Actions variable `TYPES_REPO_READY` to `true`.

The next tag release commits `Gizmos.d.ts` and `package.json` (`@types/cocos-gizmos`) to the type repo, and creates a matching version tag there. Until it exists/has credentials, this step is skipped and the main release still works.

Install the types in another Cocos project:

```bash
npm install -D github:PhuNope/Cocos-Gizmos-Type#v1.0.0
```

The type-only package provides **no runtime**. In projects overriding `compilerOptions.types`, add `cocos-gizmos` to the list.

## Limitations

The runtime needs Cocos Creator's `cc`/`cc/env` module resolver. Automated tests verify types and export structure; a Cocos editor and preview smoke test is still recommended before publishing a stable version.
