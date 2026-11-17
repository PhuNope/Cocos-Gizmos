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

**Slider click-to-set:** Click vào bất kỳ vị trí nào trên thanh slider
sẽ set giá trị tương ứng ngay ở mouse-down, có áp dụng `min/max/step`.
Kéo tiếp từ vị trí đó sẽ chỉnh theo tọa độ tuyệt đối trên thanh, không bị
nhảy về giá trị trước khi click. Click phần nhãn (ngoài thanh) giữ cách
kéo tương đối cũ. `onGizmoHudChanged` nhận `begin → update → end`
ngay cả khi click mà không kéo. Nhấn Escape trong lúc giữ chuột để
`cancel` và khôi phục giá trị ban đầu.

**HUD style dạng DOM (v3):** Trả descriptor từ `onGizmoHud()` và
`onGizmoHudControls()`; mỗi row nhận `size` và `style` giống
`HTMLElement.style` theo dạng camelCase. Không cần tạo DOM thủ công:

```ts
onGizmoHud(): GizmoHudItem[] {
    return [
        { id: 'title', text: 'Scene Tools',
          size: { width: 210, height: 20 },
          style: { color: '#93ddd3', fontWeight: 600,
              backgroundColor: '#183139', borderRadius: 7, padding: 5 } },
        { id: 'status', text: 'Ready',
          size: 'small', style: { color: '#bac8d6', fontSize: 12 } },
    ];
}

onGizmoHudControls(): GizmoHudControlList {
    return [
        { type: 'slider', id: 'radius', text: 'Radius',
          property: 'radius', min: 5, max: 100, width: 120,
          size: 'normal', style: { color: '#dce7ef' } },
        { type: 'button', id: 'reset', text: 'Reset',
          size: { width: 128, height: 20 },
          style: { backgroundColor: '#28656a',
              color: '#e9fffc', borderRadius: 8, fontWeight: 600 } },
    ];
}
```

`size` chấp nhận `'small' | 'normal' | 'large'` hoặc
`{ width?: number, height?: number }`, đơn vị pixel của Scene View.
Chiều cao được giới hạn **16–22px** để không lệch với vùng chọn native
Gizmo; chiều rộng tự giới hạn theo cột và viewport. Đối với slider,
thuộc tính `width` riêng vẫn chỉnh **độ dài thanh trượt**, được kẹp
trong vùng control, không phải chiều rộng của hàng.

`style` nhận **một tập con an toàn của CSS**: `color`,
`backgroundColor`, `borderColor`, `borderWidth`, `borderRadius`,
`fontSize`, `fontWeight`, `opacity`, `padding`,
`letterSpacing`, `textAlign`. Màu dùng HEX (ví dụ `#28656a`).
Các thuộc tính `position`, `transform`, `pointerEvents`, `zIndex`,
HTML và CSS tuỳ ý đều không được áp dụng vì chúng có thể làm lệch
hit-testing, phá layout hoặc chặn chuột của Scene.

HUD mặc định là dock màu slate với điểm nhấn teal, tự chia cột gọn theo
viewport. DOM renderer và texture fallback dùng cùng quy tắc size,
hình học picking và bảng màu. `order` vẫn sắp control theo thứ tự,
text ở trước control và không cần thay đổi API callback.

Nút bấm không dùng `onGizmoHudChanged()`; phải khai báo
`onGizmoHudAction()` để nhận `id`.

## Rotation Gizmos at a selected Vec3 pivot (v3)

The optional `Gizmos3D.rotate('euler', {pivotProperty:'activePoint'})`
and `Gizmos2D.rotate(...)` descriptor accepts any valid Vec3 getter on
the selected Component. The Vec3 is **local** to its Component Node by
default; pass `pivotSpace:'world'` for a pre-converted global point.
This moves the visible/pickable rotation ring and the rotation drag
solver centre together. The editable `euler` value is still an
Euler Vec3 on the Component, not a Node transform.

`Gizmos3D.supportsRotationPivot` and
`Gizmos2D.supportsRotationPivot` are true on SDK builds with this
feature, so callers can opt out cleanly on older SDKs rather than
accidentally rotating at the Node origin. The pivot getter is read
again on every marker update; missing or non-finite pivot data hides
the handle rather than drawing an invalid ring. The SDK does not
create child Knot Nodes, serialize the pivot or infer how to apply
Euler values to an application-specific spline; that remains the
Component's responsibility.
