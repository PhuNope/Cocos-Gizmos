# Move Gizmo

## Hiển thị mượt khi zoom và drag

Move 2D/3D dùng kích thước tính từ phép chiếu camera theo pixel, không
còn dựa vào giao ray có thể mất ổn định ở mức zoom lớn. Arrow và viền
plane được vẽ dưới dạng dải 2px với viền alpha mềm (~1px), không phụ thuộc
vào độ dày đường Graphics mặc định hoặc MSAA của Scene.
Khi drag, dữ liệu hình 2D được cập nhật đồng bộ qua lượt vẽ Scene.
Ngay cả khi chỉ **hover + lăn chuột** (không nhấn), camera được kiểm tra
trước mỗi lần vẽ: nếu phép chiếu đã thay đổi vì zoom/pan/orbit, plugin
vẽ lại arrow và plane 2D/3D ngay trong frame, không phải chờ lượt cập
nhật Scene 250ms tiếp theo. Chỉ phát vẽ lại khi fingerprint camera
thay đổi để tránh giật và tốn CPU khi camera đứng yên.

### Cocos 3.8.8: giới hạn tam giác và depth-test

GeometryRenderer chỉ có 10.000 tam giác cho mỗi bộ đệm depth-test. Sphere
mặc định dùng 16×8 segments, giảm chi tiết theo dung lượng còn lại hoặc
fallback thành cross; quad Move fallback thành đường viền khi thiếu chỗ.
Đã sửa winding của dải arrow 3D (tránh back-face culling), có fallback
line khi camera nhìn trùng trục, và khôi phục trạng thái depth-test gốc
sau khi plugin vẽ handle. Các lần repaint do wheel được coalesce
khoảng 30 ms để không tích lũy hình học quá nhiều trước GPU render.


Khi **đang drag và lăn chuột**, bỏ nhánh redraw toàn bộ Scene trong
BEFORE_DRAW và cập nhật native pick quads không cần thiết. 2D giới hạn
redraw chủ động vào khoảng 31 lần/giây, các engine frame vẫn vẽ bình
thường. Khi thả chuột, zoom-hover redraw bật lại lập tức.

## Gizmos2D.move() — Move Object Position trong Canvas 2D

```ts
onGizmoHandles(): GizmoHandleList {
    return [...Gizmos2D.move('targetPosition', {
        space: 'local', axisSize: 66, pickSize: 24,
        planeSize: 18, planeOffset: 14, showPositionLabel: true,
    })];
}
```

Gồm hai trục X (đỏ), Y (xanh lá) và ô XY (vàng) sát tâm.
Kéo trục chỉ đổi một tọa độ; ô XY đổi cả X và Y nhưng không đổi Z.
Mặc định kéo liên tục, không snap; muốn căn lưới thêm `snap: 5`.
Giữ nguyên Undo/Redo và các phase `onGizmoChanged`.
Hoạt động với `@registerGizmos(CustomDrawer)` vì dùng cùng interface `onGizmoHandles`.

 3D – XYZ, mặt phẳng, hover và tọa độ

Cocos Creator **3.8.x** – Editor Scene View. Cách dùng lấy cảm hứng từ các ví dụ `Point3D`, `Line3D`, `Plane3D` và `OnDrawGizmos` trong Creator Gizmo Kit. Không phụ thuộc vào SDK của plugin mẫu.

## Tạo Move Gizmo như công cụ mặc định

Trong một Component đã được đăng ký bởi Cocos, khai báo callback `onGizmoHandles()`:

```ts
import { _decorator, Component, Vec3, Color } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('EditableWaypoint3D')
export class EditableWaypoint3D extends Component {
    @property({ type: Vec3 })
    public waypoint = new Vec3(1, 2, 3);

    public onGizmoHandles(): GizmoHandleList {
        return [
            ...Gizmos3D.move('waypoint', {
                space: 'local',
                axisSize: 66, pickSize: 24,
                planeSize: 18, planeOffset: 14,
                // Khi component đã vẽ box, chọn/kéo được cả phần bên trong.
                boxSize: 0.7,
                hoverColor: '#ffff65',
                showPositionLabel: true,
                positionLabelOffset: 82,
            }),
        ];
    }

    public onDrawGizmosSelected(): void {
        Gizmos3D.beginColor(this.node, Color.CYAN);
        Gizmos3D.drawArrow(this.node, this.node.worldPosition,
            this.node.worldPosition.clone().add(this.waypoint), 0.2);
    }

    public onGizmoChanged(propertyName: string, phase: GizmoHandlePhase): void {
        // begin / update / end / cancel; trường Vec3 tự được cập nhật và hỗ trợ Undo.
    }
}
```

**Kéo liên tục:** không cấu hình `snap` thì mọi điểm được cập nhật bằng tọa độ số thực theo chuột, không bị nhảy theo bước. Nếu cần căn lưới, có thể thêm `snap: 0.25`.

**Vùng tương tác:** ba tia đỏ X, xanh lá Y, xanh dương Z; các ô nhỏ XY, XZ, YZ gần gốc. Kéo tia khóa một trục, kéo ô khóa mặt phẳng. Native BoxController dùng +Y editable face làm hit proxy, với footprint lớn hơn và dự phòng hit-test trên toàn thân tia. Vùng hiển thị nhỏ hơn vùng nhấp, nên giao diện vẫn gọn. Dùng `pickSize: 30` khi cần vùng bắt chuột lớn hơn (hợp lệ từ 12 đến 72 pixel).

**Kéo box:** `boxSize: 0.7` là tùy chọn: khớp với ô wireframe
`drawBox(..., new Vec3(0.7, 0.7, 0.7))` trong demo. Click bên trong
box để kéo theo mặt phẳng camera; click vào thân tia để khóa trục,
hoặc vào mặt phẳng tô màu để khóa hai trục. Điểm chọn là mesh trong suốt
khớp với hình đang thấy, không dùng mặt +Y có ký hiệu `+` nữa.

**Hover:** vùng được highlight vàng (`hoverColor`) khi mouse-in hoặc khi kéo. Di chuyển ra sẽ trở lại màu gốc. Hover không ghi lên dữ liệu Scene.

**Nhãn tọa độ:** `showPositionLabel` đặt một nhãn `Pos X/Y/Z` trên vị trí đang chỉnh, offset mặc định 94 pixel màn hình. Font được giới hạn 12–22 pixel khi zoom. Nhãn dùng ID ổn định, không tạo thêm node mỗi frame.

## Tạo từng handle theo API cơ bản

```ts
public onGizmoHandles(): GizmoHandleList {
    return [
        // Có thể dùng riêng trục và mặt phẳng, tùy component:
        { property: 'waypoint', id: 'move-x', axis: 'x',
          plane: 'view', visual: 'axis', pickSize: 28,
          color: '#ff5555', hoverColor: '#ffff66' },
        { property: 'waypoint', id: 'move-yz', plane: 'yz',
          visual: 'plane', planeSize: 18, planeOffset: 14,
          pickSize: 24, color: '#ff77dd' },
    ];
}
```

`visual:'point'` (mặc định), `visual:'plane'`, `visual:'axis'` và `visual:'box'` vẫn được hỗ trợ. Các handle khác nhau có thể cùng tham chiếu một `Vec3` bằng `property` và `id` khác nhau. `space`, `snap`, `bounds`, `axis`, `plane` vẫn tương thích.

## Vẽ Gizmos bằng API mới

- `Gizmos3D.move(property, options)`: tạo sáu handle kéo chung một `Vec3`
- `Gizmos3D.drawPositionLabel(node, id, worldPosition, options)`: vẽ nhãn vị trí, điều chỉnh `offsetPixels`, `digits`, `minSize`, `maxSize`, `color`
- `Gizmos3D.drawArrow(node, from, to, headSize?)`: minh họa vector giống Point3D/Line3D
- `Gizmos3D.drawPlanePreview(node, center, normal, size?, wireFrame?)`: trực quan mặt phẳng giống Plane3D, không tạo MeshRenderer
- Các API cũ như `drawLine`, `drawQuad`, `drawSphere`, `drawLabel`, `drawMesh`, `beginColor`, `beginLocalPosition` vẫn hoạt động.

## Demo có thể kéo vào scene

Trong Assets của Creator, mở gói read-only `cocos-gizmos/Examples/CocosGizmos3DDemo.ts` và kéo lên Node. Chọn Component trong Inspector rồi chuyển sang 3D Scene View; thử các trục, plane, hover, nhãn tọa độ và nút Reset trong HUD.

Phiên bản editable trong gói ZIP: `examples/Gizmos3DApiTest.ts`. Nếu dùng script đó trong dự án thì phải sửa tên `@ccclass` theo nhu cầu tránh trùng với demo mounted.

Phím giữa để pan camera và phím phải để orbit vẫn thuộc Editor, không được bắt đầu drag Gizmos. Nếu trạng thái editor bị lỗi, dùng menu **Gizmos → Reset Gizmos**.

> Chạy type-check/test tự động không xác minh hoàn toàn việc raycast của native Scene trên từng góc camera. Hãy thử click cả thân tia và các ô XY/XZ/YZ trong Cocos Creator 3.8.8.
