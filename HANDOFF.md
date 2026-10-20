# Cocos-Gizmos maintainer notes

The former `assets/Gizmos.ts` and global `Gizmos.Gizmos2D` API have been retired.
See [README.md](README.md) for the release and type-only package setup.

Build pipeline:

1. `source/*.ts` remains the source of truth.
2. `scripts/build.mjs` combines the source using TypeScript AST namespaces into `.generated/Gizmos.ts` to isolate duplicate helper class names.
3. The same build step transpiles that source into `dist/Gizmos.js`, leaving `cc` and `cc/env` external.
4. `scripts/type.mjs` emits a declaration from the intermediate, keeps only two exported classes and the Cocos component hooks, and adds ambient global values to `dist/Gizmos.d.ts`.
5. `scripts/verify-output.mjs` rejects additional public exports or dist files. `tests/dts` contains positive and negative compiler tests.
6. `npm test` runs all checks. GitHub Actions runs on PRs and tags; tag builds package just the two files.

The extension's `asset-db` mount points to `./dist`; the `assets/Example.ts` file is for development only. Runtime registration is unconditional (`globalThis`), while editor-only drawing updates remain guarded by `Editor`.

Do not manually edit `dist/` or `.generated/`. To verify editor integration, open Cocos Creator 3.8+, ensure both dist files are imported, and check that a component's `onDrawGizmos` method draws with the direct `Gizmos2D`/`Gizmos3D` names.
