# GizmoHUD v3 — Fluent Builder and Command Architecture

Status: **development API on `v3`**, not a tagged release.

## Design

The public API is `GizmoHUD.createHud()`. It creates a **declarative tree**
rather than a DOM element, CC Node or native Editor Gizmo. It is inspired by
[Flexily](https://www.npmjs.com/package/flexily)'s composable layout nodes:
a layout is a hierarchy with direction, gap, padding, grow and alignment.
We do **not** ship the Flexily layout engine: the Scene DOM adapter already
supports CSS Flexbox, and a later Canvas adapter could consume the same tree.

```ts
class Shape3D extends Component {
    @property size = 1;
    @property wireframe = true;
    @property depthTest = true;
    public lastEvent = 'none';

    onGizmoHUD(): GizmoHudDefinition {
        return GizmoHUD.createHud('shape')
            .width(340).padding(12).gap(8)
            .style({ backgroundColor: '#1b2833', borderRadius: 10 })
            .shrink(0).basis(340).wrap(false)
            .text('heading', 'Shape preview', {
                style: { color: '#93ddd3', fontSize: 17, fontWeight: 600 },
            })
            .text('status', 'Last: ' + this.lastEvent)
            .slider('size', 'Shape size', GizmoHUD.bind('size'), {
                min: 0.5, max: 3, step: 0.25,
            })
            .row('flags', row => {
                row.gap(12)
                    .checkbox('depth', 'Depth test', GizmoHUD.bind('depthTest'))
                    .toggle('wire', 'Wireframe', GizmoHUD.bind('wireframe'));
            })
            .button('reset', 'Reset', GizmoHUD.action((owner: Shape3D) => {
                owner.size = 1;
                owner.wireframe = true;
                owner.lastEvent = 'reset';
            }))
            .build();
    }

    onGizmoHudChanged(property: string, phase: GizmoHandlePhase,
                      value: number | boolean): void {
        this.lastEvent = property + ': ' + phase + ' = ' + value;
    }
}
```

No imports are needed for the global `GizmoHUD` type or runtime in Editor.
The mounted `GizmosGlobal.ts` provides completion for `onGizmoHUD()` and
builder methods.

## Fluent layout API

`GizmoHUD.createHud(id?)` returns `GizmoHudBuilder`, a column by default.
Configure the current group with `width(px)`, `height(px)`, `gap(px)`,
`padding(px)`, `grow(factor)`, `shrink(factor)`,
`basis(px)`, `wrap(boolean)`, `style(cssLikeStyle)`,
`align('start'|'center'|'end'|'stretch')` and
`justify('start'|'center'|'end'|'between'|'around'|'evenly')`.

Use `row(id, row => ...)` and `column(id, column => ...)` to nest groups.
Add `text(id, text, options?)`, `slider(id, label, command, {min,max,step?})`,
`checkbox(id, label, command)`, `toggle(id, label, command)` and
`button(id, label, command)`. Each control also accepts optional
`{ style, grow }`. Styles are a safe CSS-like subset (color, background,
font, border, padding); absolute positioning, arbitrary HTML and
`pointerEvents` cannot be overridden through the builder.

`build()` returns a read-only snapshot `GizmoHudDefinition`. IDs must be
unique within a tree (including groups); maximum depth is 8 and maximum
node count is 64. Reusing the builder after `build()` does not mutate
previous definitions.

## Commands and state transitions

`GizmoHUD.bind('propertyName')` is a typed **property command descriptor**.
A Slider requires an existing finite numeric field; Checkbox and Toggle
require boolean fields. The application controller reads/writes the owner
Component and emits `onGizmoHudChanged(property, phase, value)`.

`GizmoHUD.action(component => ...)` creates a Button action. It only runs
on click and is not an Inspector property path.

The builder returns data, not a DOM node. A caller should return the
definition from `onGizmoHUD()`; do not execute commands inside the callback,
which is reevaluated whenever the Scene refreshes.

`GizmoHudCommandController` in the application layer owns the edit
transaction and uses the existing `GizmoEditSession`: begin -> zero or
more updates -> end, or cancel + rollback. Optional Editor notification
hooks are injected at composition time and cannot break a live gesture.
The DOM adapter uses a native range/checkbox/button event path and
keeps controls alive while dragging, independent of Scene raycasting.

**Editor Undo integration:** builder property commands currently provide
transaction grouping, change callbacks and cancellation rollback. Creator's
private native Inspector Undo hooks are **not guaranteed** for the new DOM
port; they require a supported Editor adapter. The existing flat legacy HUD
retains its own native SelectGizmo integration. Do not assume Ctrl+Z support
until validated on your specific Creator build.

## Rendering and fallback

- Scene DOM available: `GizmoHudDomRenderer` renders a floating top-right
  flex panel, with real DOM controls, safe text nodes and focused pointer
  ownership. Background gaps pass mouse input back to the Scene.
- No Scene DOM: `GizmoHudLayout` flattens the definition into legacy
  labels and controls for texture / `cce.Operation` picking. It uses the
  builder's command mapping for Buttons and bound property descriptors.
  Nested flex **visual layout** is unavailable in this fallback; controls
  become sequential rows.
- Selecting a different Node removes or replaces its HUD. The controller
  never calls `Editor.Selection.select()` to restore a stale Node.

## Clean Architecture

```text
Component.onGizmoHUD()
        |
GizmoHUD.createHud()         Domain (no DOM, Cocos or Editor)
        |                    
GizmoHudDefinition           Immutable tree: flex groups + commands
        |
GizmoHudLayout               Scene application adapter / fallback flatten
        |
GizmoHudCommandController    EditSession, value bindings, actions
        |
GizmoHudDomRenderer          Scene DOM / CSS Flexbox adapter
        |
Native Cocos Editor Scene    Selection + rendering host
```

Legacy `onGizmoHud()` / `onGizmoHudControls()` can still be used on
Components without `onGizmoHUD()`, but new code should use the Builder.
No global action registry, no runtime Component allocation and no
additional npm layout dependency are required.
