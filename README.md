# Cocos-Gizmos

Cocos Creator Editor extension for drawing and interacting with Gizmos in Scene View. Compatible with Creator 3.8.2+; developed and tested primarily against the 3.8.x Editor APIs.

## Main features

- **2D and 3D Gizmos:** draw points, lines, shapes, meshes, and editor visualization.
- **Interactive handles:** move/rotate handles, coordinate constraints, snapping, selection-aware interaction and editing callbacks.
- **Editor-only rendering:** custom drawing runs in the Editor's Scene View and is excluded from game runtime code.
- **Declarative registration:** register standalone Gizmo drawers for Components with `registerGizmos`.
- **Scene HUD builder:** `GizmoHUD.createHud()` defines nested row/column layouts, property-bound controls and action commands, rendered in the Scene View.
- **Editor tools:** Gizmos settings, diagnostics, reset command, API document panel and optional Example Components installed through Gizmos > Install Example.
- **Build-time cleanup:** removes Editor-only Gizmo drawing hooks from game build output.

## Installation

Download a development artifact from the [v3 Actions workflow](https://github.com/PhuNope/Cocos-Gizmos/actions/workflows/release.yml), or an explicitly approved package from [Releases](https://github.com/PhuNope/Cocos-Gizmos/releases). In Cocos Creator open **Extensions → Extension Manager → Import Extension**, import the ZIP, then enable the extension.

## Usage

Editor-only Component drawers can be registered with `registerGizmos`. The `Gizmos2D` and `Gizmos3D` globals provide Scene View drawing operations; interactive Move/Rotate handles support editing component values.

For API examples, details, and test instructions, see:

- [Architecture](docs/ARCHITECTURE.md)
- [HUD builder and command API](docs/HUD_BUILDER.md)
- [Callbacks](docs/CALLBACKS.md)
- [Move handles](docs/MOVE_GIZMO.md)
- [Rotate handles](docs/ROTATE_GIZMO.md)
- [Editor smoke tests](docs/EDITOR_SMOKE_TEST.md)

## Development

Active development takes place on **`v3`**. Development builds are distributed as CI artifacts for testing. Version tags and GitHub Releases are created **only after approval**. Breaking API changes are allowed on v3; consumers must review and update their integrations when upgrading.

Release-specific features, fixes and breaking changes belong in [CHANGELOG.md](CHANGELOG.md) and the GitHub Release notes, rather than the README.

Run `npm ci && npm test` to check the source. Run `npm run pack` for a minimal installable ZIP; the packaging script uses a strict file allowlist and checks the built output.

### Development: reference-frame Move Gizmos

New v3 development builds support `Gizmos3D.move(property,{space:'local',frameNode:parentNode})` and the analogous 2D preset. Rendering, picking and drag calculations share the referenced Node's local axes; existing Move handles remain unchanged. Consumers can feature-detect `Gizmos3D.supportsMoveFrameNode`. This functionality is not present in the original v3.0.3 package. See [Move Gizmo docs](docs/MOVE_GIZMO.md). Development builds only; no tag/release.

### External history for computed Gizmos (v3 development)

Move/Rotate handle descriptors support `history:'external'` to delegate native undo grouping to a domain extension. When enabled, Cocos-Gizmos still sends drag callbacks but does not call native SelectGizmo history hooks for that handle. It is suitable only when the consumer commits real serialized properties and creates a single Scene snapshot; ordinary handles continue using native hooks by default.
