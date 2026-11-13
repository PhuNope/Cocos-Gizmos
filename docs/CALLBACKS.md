# Callback Gizmos trong Cocos Creator 3.8.x

Phần này cũng xuất hiện trong **Gizmos → OpenDoc → Callbacks**, có sơ đồ SVG
và các ví dụ TypeScript có thể sao chép. Thư mục `docs/` chỉ nằm trong
repository, **không được đóng gói** vào extension ZIP.

## Callback và mục đích

| Callback | Khi nào sử dụng |
|---|---|
| `onGizmoSettings(): GizmoViewSettings` | Chọn display và HUD visibility. |
| `onGizmoHandles(): GizmoHandleList` | Khai báo các handle sửa `Vec3` hoặc `Vec3[]`. |
| `onDrawGizmos(): void` | Vẽ gizmos khi component được phép hiển thị. |
| `onDrawGizmosSelected(): void` | Vẽ thêm khi node được chọn. |
| `onGizmoChanged(name, phase, index?)` | Phản hồi các thao tác kéo handle. |
| `onGizmoHud(): GizmoHudItem[]` | Trả danh sách nhãn HUD. |
| `onGizmoHudControls(): GizmoHudControlList` | Khai báo slider, toggle, checkbox, button. |
| `onGizmoHudChanged(name, phase, value)` | Phản hồi edit slider hoặc toggle/checkbox. |
| `onGizmoHudAction(id)` | Xử lý thao tác bấm button. |

### GizmoHandlePhase

- `begin`: bắt đầu một lần kéo.
- `update`: giá trị thuộc tính đã được ghi. Có thể phát nhiều lần.
- `end`: thả chuột và kết thúc thao tác.
- `cancel`: hủy thao tác và hoàn nguyên thuộc tính, ví dụ Escape.

Callback `onGizmoChanged` có tham số `index` chỉ khi handle trỏ tới
phần tử của một mảng `Vec3[]`. Điểm `Vec3` đơn thì `index === undefined`.

## Ví dụ Move Gizmo và đồng bộ Node

```ts
import { _decorator, Component, Node, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('MoveCallbackExample')
export class MoveCallbackExample extends Component {
    @property({ type: Vec3 }) position = new Vec3();
    @property({ type: Node }) movedNode: Node | null = null;

    onGizmoHandles(): GizmoHandleList {
        return [...Gizmos3D.move('position')]; // Không snap: kéo liên tục
    }

    onGizmoChanged(name: string, phase: GizmoHandlePhase, index?: number): void {
        if (name !== 'position' || phase === 'begin') return;
        this.syncMovedNode(); // update / end / cancel
    }

    onRestore(): void { this.syncMovedNode(); }

    private syncMovedNode(): void {
        if (!this.movedNode?.isValid) return;
        const world = Vec3.transformMat4(new Vec3(),
            this.position, this.node.worldMatrix);
        this.movedNode.setWorldPosition(world);
    }
}
```

**Lưu ý:** Update dữ liệu liên tục trong `onGizmoChanged(update)`.
Khi hủy kéo, vị trí gốc đã được hoàn nguyên trước callback `cancel`.
Đồng bộ thêm trong `onRestore()` nếu có state phụ thuộc khi Undo/Reset.
Không thay đổi dữ liệu serialized trong `onDrawGizmos()`.
Native Undo/Redo cần kiểm tra trong Editor Cocos Creator thực tế.

## Callback HUD

```ts
onGizmoHudControls(): GizmoHudControlList {
    return [
        { type: 'slider', id: 'radius', text: 'Radius',
          property: 'radius', min: 5, max: 100 },
        { type: 'checkbox', id: 'visible', text: 'Visible',
          property: 'visible' },
        { type: 'button', id: 'reset', text: 'Reset' },
    ];
}
onGizmoHudChanged(name: string, phase: GizmoHandlePhase,
    value: number | boolean): void {
    // Thuộc tính đã thay đổi trong phase update.
    // Slider có cancel; checkbox/toggle thông thường begin-update-end.
}
onGizmoHudAction(id: string): void {
    if (id === 'reset') this.radius = 40;
}
```

Nút bấm không dùng `onGizmoHudChanged()`; phải khai báo
`onGizmoHudAction()` để nhận `id`.
