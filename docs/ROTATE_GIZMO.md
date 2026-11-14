# Rotation Gizmos — Cocos Creator 3.8.8

2D and 3D rotation rings reuse the extension's Scene selection, camera,
native picking and Undo/Redo system rather than adding game components.

## 2D: a circular Z rotation handle

```ts
@property({ type: Vec3 })
rotationEuler = new Vec3(0, 0, 20);

onGizmoHandles(): GizmoHandleList {
    return [...Gizmos2D.rotate('rotationEuler', {
        space: 'local', ringSize: 70, pickSize: 14,
        // snap: 15, // optional angle snapping
    })];
}
```

The circle's center is the selected Component's Node. A complete turn
increments or decrements Z by 360 degrees; X and Y are left unchanged.

## 3D: X/Y/Z colored rings

```ts
@property({ type: Vec3 })
rotationEuler = new Vec3(15, 20, 30);

onGizmoHandles(): GizmoHandleList {
    return [...Gizmos3D.rotate('rotationEuler', {
        space: 'local', ringSize: 72, pickSize: 14,
    })];
}
```

Red = X, green = Y, blue = Z. Each ring rotates around its own
axis while the Vec3 remains an Euler-degree property on the Component.

## API options

- `space`: `local` (default) or `world`. Local rings follow the Node's
  world rotation composed with the Euler field, while World rings stay
  aligned to global XYZ. Quaternion composition is used for 3D turns.
- `ringSize`: visual radius in Scene screen pixels (24..180, default 72).
- `pickSize`: selection tolerance near the ring (8..32, default 14).
  The native picking mesh is an annulus rather than an opaque square.
- `snap`: optional positive angle step in degrees (e.g. `snap: 15`).

## Interaction and caveats

- Rotation is **not** automatically written to `node.eulerAngles`; the
  serialized Component Vec3 is edited. Apply it in your own callback or
  draw a virtual object using this Euler rotation.
- A drag emits `onGizmoChanged(property, phase, index?)` with
  `begin → update → end` or `begin → update → cancel`, using one Undo
  transaction. Escape restores the pre-drag value.
- 2D rotation unwraps angles beyond +/-180 degrees; whole turns remain
  continuous. In 3D, Euler representations may re-map around gimbal
  singularities, though the underlying quaternion rotation stays correct.
- Edge-on 3D X/Y rings use a screen-space projected tangent if the
  exact ray/rotation-plane intersection is nearly parallel.
- 64-segment 2D/3D ring strokes are rendered with the existing soft
  Move lines, with constant visual size under camera zoom.
- Installed examples `CocosGizmos2DDemo` and `CocosGizmos3DDemo`
  expose `rotationEuler` Inspector values and visual pointer/box previews.
- Automated CI verifies geometry, math, simulated pointer selection,
  Undo and packaging. Test real clicks/dragging in Cocos Creator 3.8.8.
