# Cocos-Gizmos v3 – kiến trúc Editor

## Mục tiêu

Ưu tiên **dễ khai báo**, **ít trạng thái ẩn**, **bảo toàn thao tác kéo/Undo**. Không cần giữ API dư thừa chỉ vì tương thích với bản phát triển cũ. Tuy nhiên, không phá những API vẽ Gizmos 2D/3D đang hữu ích cho game.

### Public API (Facade)

Trong Cocos Component chỉ cần khai báo:

```ts
onGizmoHandles(): GizmoHandleList {
    return [
        ...Gizmos3D.move('moveObject', {
            snap: 0.25, pickSize: 28, showPositionLabel: true,
        }),
    ];
}
```

Với node UI 2D:

```ts
onGizmoHandles(): GizmoHandleList {
    return [
        Gizmos2D.point('point', { snap: 5 }),
        ...Gizmos2D.points('waypoints', this.waypoints.length, {
            color: '#00ffff',
        }),
    ];
}
```

Không cần tự ghép 6 descriptor cho move gizmo hoặc lặp `index` cho từng waypoint. Hàm trả về mô tả thuần, không tạo controller/đối tượng Scene mỗi lần gọi.

### Các lớp và ranh giới

| Lớp | File | Trách nhiệm |
| --- | --- | --- |
| Domain / Descriptor | `GizmoHandlePresets.ts` | Tạo và kiểm tra mô tả point, points, move; không phụ thuộc Cocos |
| Domain / Geometry | `PositionDragSolver.ts`, `AxisHandleGeometry.ts`, `PlaneHandleGeometry.ts` | Ray, chuyển đổi tọa độ, snap, khóa trục/mặt phẳng |
| Application / Command | `GizmoMoveCommand.ts` | Đơn vị thao tác Begin → Update → End/Cancel, không biết Scene |
| Application / Transaction | `GizmoEditSession.ts` | Snapshot trước khi kéo, loại bỏ no-op, rollback nếu Cancel |
| Editor Adapter | `PositionHandles.ts` | BoxController, event routing, hover, hit proxy và nối command vào Inspector |
| Scene Lifecycle | `ExecuteGizmos.ts`, `SceneUpdateScheduler.ts` | Quét component, đồng bộ node đang chọn, reset khi chuyển Scene |
| Presentation | `Gizmos2D.ts`, `Gizmos3D.ts`, `GizmoHud*.*` | Hình vẽ, label, HUD (không quyết định cách ghi serialized data) |

## Command Pattern / SOLID

- **S** (Single Responsibility): `PositionDragSolver` không ghi component. `GizmoMoveCommand` không tự raycast Cocos. `PositionHandles` không trực tiếp quản lý state machine Undo.
- **O/D** (Open-closed, Dependency inversion): `GizmoMoveCommand` nhận `GizmoValuePort` (đọc/ghi) và hooks, có thể đổi nguồn dữ liệu Vec3 mà không chỉnh command.
- **L/I** (Interface segregation, Liskov): `GizmoCommand` nhỏ với 4 thao tác; không bắt layer geometry implement callback Editor.
- **Undo/Redo:** một gesture tạo một phiên giao dịch, Escape gọi Cancel để khôi phục snapshot; thả chuột commit, không lưu trữ từng frame thành một transaction riêng.

Native controller và HUD vẫn được giải phóng theo vòng đời Scene, kể cả controller bị ẩn sau đổi selection. Chuột giữa/phải không mở lệnh drag.

### Định hướng mở rộng

Khi thêm Rotate hoặc Scale, tạo command mới dùng lại pattern `GizmoEditSession` và adapter riêng. Không thêm các nhánh `if (shape === 'rotate')` vào `PositionHandles`. Không viết lớp factory/hệ thống sự kiện tổng quát nếu chỉ có một loại command.

## Kiểm thử

- `tests/command-architecture.mjs`: factory thuần, validate, command begin/update/commit/cancel, Undo rollback, snap/axis
- `tests/position-adapter.mjs`: native Cocos mock, chọn trục/plane, hover, drag và undo callbacks
- `tests/scene-discovery.mjs`: thay scene chưa lưu và phục hồi updater
- `tests/renderer-3d.mjs` / `draw-commands-2d.mjs`: render và 3D/2D API mới
- `npm run pack`: kiểm tra ZIP cài đặt và sự phân tách runtime Editor–game

CI không thể thay thế test bằng chuột trực tiếp trong Cocos Creator 3.8.8. Nên chạy đủ 2D → 3D, pan bằng nút giữa, scene chưa lưu, hover, kéo plane và Reset Gizmos trước khi chốt release.
