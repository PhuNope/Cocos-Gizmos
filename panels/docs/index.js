'use strict';

// Self-contained Editor-only reference: no external images, network calls or game assets.
// SVG illustrations are explanatory diagrams, not Scene screenshots.
const drawings = {
    move: '<svg viewBox="0 0 480 174" role="img" aria-label="Move Gizmo with X Y Z axes and XY XZ YZ plane squares" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="174" rx="12" fill="#161f2c"/><g stroke-linecap="round" stroke-width="5"><line x1="222" y1="125" x2="409" y2="125" stroke="#ff606b"/><line x1="222" y1="125" x2="222" y2="20" stroke="#53de7d"/><line x1="222" y1="125" x2="105" y2="161" stroke="#5a9eff"/></g><path d="M409 125l-17 -9v18z" fill="#ff606b"/><path d="M222 20l-9 18h18z" fill="#53de7d"/><path d="M105 161l20 -2 -6 -17z" fill="#5a9eff"/><path d="M236 108h20v20h-20z" fill="#f6d85c" stroke="#fff5ba"/><path d="M209 119l-20 7 -9 9 20 -7z" fill="#79a8fc" stroke="#a8c7ff"/><path d="M208 103l14 -6v20l-14 6z" fill="#e38cce" stroke="#f7b1dd"/><circle cx="222" cy="125" r="7" fill="#f3f6fa" stroke="#172033" stroke-width="2"/><g font-family="Arial,sans-serif" font-size="15" font-weight="700"><text x="415" y="130" fill="#ff8791">X</text><text x="233" y="26" fill="#73f8a0">Y</text><text x="83" y="157" fill="#91bdff">Z</text><text x="276" y="107" fill="#fbe78d">XY</text><text x="145" y="144" fill="#8db8ff">XZ</text><text x="183" y="88" fill="#f0a2d8">YZ</text></g></svg>',
    shapes2d: '<svg viewBox="0 0 480 174" role="img" aria-label="Outline circle, solid rectangle, ellipse and Bezier curve" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="174" rx="12" fill="#162131"/><g stroke="#53d7f5" stroke-width="3" fill="none"><circle cx="76" cy="76" r="36"/><ellipse cx="227" cy="76" rx="48" ry="28"/><rect x="335" y="39" width="86" height="73" rx="3"/></g><rect x="348" y="52" width="61" height="47" fill="#f8a06d" opacity=".72"/><path d="M24 148 Q95 88 155 148 T287 143 T458 144" fill="none" stroke="#f782d9" stroke-width="3"/><g fill="#cad9e9" font-family="Arial,sans-serif" font-size="12"><text x="52" y="130">Circle</text><text x="208" y="130">Ellipse</text><text x="362" y="130">Rect</text></g></svg>',
    shapes3d: '<svg viewBox="0 0 480 174" role="img" aria-label="Sphere, box, cylinder, cone and wireframe 3D Gizmo shapes" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="174" rx="12" fill="#172132"/><g fill="none" stroke-width="2.3" stroke-linejoin="round"><circle cx="82" cy="80" r="47" stroke="#ffd066"/><ellipse cx="82" cy="80" rx="23" ry="47" stroke="#ffd066" opacity=".7"/><ellipse cx="82" cy="80" rx="47" ry="15" stroke="#ffd066" opacity=".7"/><path d="M177 54l53 -24 52 26 -52 27zM177 54v58l53 28V83M230 140l52 -29V56" stroke="#6fe0f0"/><path d="M340 53q37 -22 75 0v62q-38 23 -75 0zM340 53q35 25 75 0M340 115q35 -24 75 0" stroke="#f49bd6"/></g><g fill="#cad9e9" font-family="Arial,sans-serif" font-size="12"><text x="62" y="147">Sphere</text><text x="210" y="156">Box</text><text x="351" y="147">Cylinder</text></g></svg>',
    move2d: '<svg viewBox="0 0 480 174" role="img" aria-label="2D Move gizmo X red axis Y green axis XY yellow plane near origin" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="174" rx="12" fill="#192536"/><g stroke-width="4" stroke-linecap="round"><path d="M117 135H402" stroke="#ff5961"/><path d="M117 135V19" stroke="#48df78"/></g><path d="M402 135l-17 -9v18z" fill="#ff5961"/><path d="M117 19l-9 18h18z" fill="#48df78"/><rect x="135" y="97" width="25" height="25" fill="#ffed76" fill-opacity=".6" stroke="#ffed76" stroke-width="2"/><circle cx="117" cy="135" r="6" fill="#f6fbff"/><g font-family="Arial,sans-serif" font-size="16" font-weight="700"><text x="408" y="140" fill="#ff8990">X</text><text x="130" y="25" fill="#7ef3a1">Y</text><text x="173" y="110" fill="#fff2a4">XY</text></g></svg>',
    handles2d: '<svg viewBox="0 0 480 174" role="img" aria-label="Editable points on a 2D polyline" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="174" rx="12" fill="#192335"/><path d="M67 117L168 52L284 101L394 37" fill="none" stroke="#79d6f7" stroke-width="3"/><g stroke="#e9fcff" stroke-width="3"><circle cx="67" cy="117" r="10" fill="#0acbd1"/><circle cx="168" cy="52" r="10" fill="#fbd76e"/><circle cx="284" cy="101" r="10" fill="#0acbd1"/><circle cx="394" cy="37" r="10" fill="#0acbd1"/></g><circle cx="168" cy="52" r="22" fill="none" stroke="#ffd770" stroke-dasharray="5 5" opacity=".65"/><text x="162" y="96" fill="#fbd76e" font-size="13" font-family="Arial,sans-serif">Drag</text></svg>',
    hud: '<svg viewBox="0 0 480 174" role="img" aria-label="Scene HUD with text, slider, toggle, checkbox and button" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="174" rx="12" fill="#142031"/><rect x="20" y="17" width="440" height="140" rx="8" fill="#253248" stroke="#5f7795"/><text x="37" y="42" fill="#fff4a5" font-family="Arial,sans-serif" font-size="17" font-weight="700">Gizmos HUD</text><text x="37" y="74" fill="#dfebff" font-family="Arial,sans-serif" font-size="13">Radius</text><rect x="120" y="64" width="206" height="6" rx="3" fill="#50637a"/><rect x="120" y="64" width="134" height="6" rx="3" fill="#63b3ff"/><rect x="250" y="59" width="9" height="16" rx="2" fill="#e3efff"/><text x="337" y="73" fill="#dfebff" font-size="13">45</text><rect x="37" y="90" width="36" height="19" rx="9" fill="#4dd18a"/><circle cx="62" cy="99.5" r="7" fill="#fff"/><text x="85" y="103" fill="#dfebff" font-size="13">Visible</text><rect x="218" y="91" width="17" height="17" rx="2" fill="#63b3ff"/><path d="M222 99l4 4 6-9" stroke="#11233c" stroke-width="2" fill="none"/><text x="242" y="104" fill="#dfebff" font-size="13">Labels</text><rect x="37" y="119" width="106" height="26" rx="4" fill="#49617d"/><text x="58" y="137" fill="#fff" font-size="13">Reset</text></svg>',
    callbackFlow: '<svg viewBox="0 0 480 174" role="img" aria-label="Gizmo callback workflow: configure and draw then begin, update, end or cancel" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="174" rx="12" fill="#172235"/><g font-family="Arial,sans-serif" text-anchor="middle" font-size="12" font-weight="700"><rect x="19" y="22" width="132" height="36" rx="8" fill="#365279" stroke="#7cbafe"/><text x="85" y="45" fill="#e9f8ff">Setup / Draw</text><rect x="179" y="22" width="94" height="36" rx="8" fill="#4a466e" stroke="#bcabff"/><text x="226" y="45" fill="#f2eeff">begin</text><rect x="303" y="22" width="156" height="36" rx="8" fill="#265f60" stroke="#7de5cb"/><text x="381" y="45" fill="#dcfff5">update × N</text><rect x="264" y="111" width="96" height="35" rx="7" fill="#306b48" stroke="#88e3a5"/><text x="312" y="134" fill="#e2ffeb">end</text><rect x="365" y="111" width="94" height="35" rx="7" fill="#764652" stroke="#fd9da8"/><text x="412" y="134" fill="#ffeef0">cancel</text></g><g stroke="#b7cbdf" stroke-width="2.5" fill="none" stroke-linecap="round"><path d="M151 40h26"/><path d="M273 40h28"/><path d="M381 58v18h-69v33"/><path d="M425 58v51"/><path d="M381 22v-11h-45v11" stroke-dasharray="5 5"/></g><path d="M177 40l-7 -5v10zM301 40l-7 -5v10zM312 109l-5 -8h10zM425 109l-5 -8h10z" fill="#d5e7ff"/><text x="239" y="91" fill="#bad0e5" font-size="11" font-family="Arial,sans-serif">Mouse up</text><text x="372" y="159" fill="#bad0e5" font-size="10" font-family="Arial,sans-serif">Esc / hide</text></svg>',
    decorator: '<svg viewBox="0 0 480 174" role="img" aria-label="Component decorated with registerGizmos binds one custom drawer per instance in Scene Editor" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="174" rx="12" fill="#172334"/><g font-family="Arial,sans-serif" font-size="13" text-anchor="middle"><rect x="14" y="30" width="125" height="70" rx="10" fill="#234b68" stroke="#64baf0"/><text x="76" y="60" fill="#e0f4ff">CompA</text><text x="76" y="82" fill="#c7def8" font-size="11">Component</text><rect x="175" y="30" width="135" height="70" rx="10" fill="#51435c" stroke="#d4a9f4"/><text x="242" y="59" fill="#fbeeff">registerGizmos</text><text x="242" y="81" fill="#e7c8fb" font-size="11">Editor only</text><rect x="348" y="30" width="117" height="70" rx="10" fill="#27604d" stroke="#7ee3ad"/><text x="406" y="60" fill="#e1fff0">IDrawGizmos</text><text x="406" y="82" fill="#b7f2d3" font-size="11">CustomDrawer</text><path d="M139 65h33M310 65h35" fill="none" stroke="#c9e3f7" stroke-width="3"/><path d="M172 65l-9 -6v12zM345 65l-9 -6v12z" fill="#c9e3f7"/><text x="242" y="132" fill="#9ed6fd" font-weight="700">draw · handles · HUD · callbacks</text><text x="242" y="152" fill="#c3d6e8" font-size="11">Preview / Game: không gắn callback</text></g></svg>',
    labels: '<svg viewBox="0 0 480 174" role="img" aria-label="Position label and sprite annotation above a scene object" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="174" rx="12" fill="#142233"/><g stroke="#7b91aa" stroke-width="2" fill="none"><path d="M36 141l186 -84 218 83M222 57v89"/><path d="M78 140l164 -72 151 72"/></g><circle cx="222" cy="117" r="10" fill="#ffda7c"/><path d="M222 105v-28" stroke="#e7f3ff" stroke-dasharray="4 4"/><rect x="132" y="26" width="219" height="31" rx="7" fill="#344e70" stroke="#80b9fa"/><text x="146" y="46" fill="#f1f8ff" font-size="14" font-family="Arial,sans-serif">Pos X: 1.25  Y: 2  Z: 3</text></svg>',
};
const examples = Object.freeze([
    {
        id: 'start', group: 'start', heading: 'Bắt đầu với Scene Gizmos',
        summary: 'Gọi API trong callback của Component, không dùng trong top-level initializer. Không cần import Gizmos2D/Gizmos3D; extension cung cấp globals.',
        apis: ['onDrawGizmos', 'onDrawGizmosSelected', 'onGizmoSettings', 'beginColor', 'beginLocalPosition', 'endLocalPosition'],
        figure: 'shapes2d', caption: 'Hình minh họa các primitive trong Scene View',
        code: [
            "import { _decorator, Component, Color, Vec2 } from 'cc';",
            'const { ccclass } = _decorator;',
            "@ccclass('GizmoIntro')",
            'export class GizmoIntro extends Component {',
            '  onGizmoSettings(): GizmoViewSettings {',
            "    return { display: 'always', hud: 'selected' };",
            '  }',
            '  onDrawGizmos(): void {',
            '    Gizmos2D.beginColor(this.node, Color.CYAN);',
            '    Gizmos2D.beginLocalPosition(this.node);',
            '    Gizmos2D.drawCircle(this.node, Vec2.ZERO, 40);',
            '    Gizmos2D.endLocalPosition(this.node);',
            '  }',
            '}',
        ].join('\n'),
    },
    {
        id: 'shapes2d', group: '2d', heading: 'Gizmos2D: hình cơ bản',
        summary: 'Đường, đa giác, hình tròn, elip, chữ nhật, cung và vùng tô. Vẽ trong onDrawGizmos() để thấy cả khi chưa chọn node.',
        apis: ['drawLine', 'drawLineList', 'drawCircle', 'drawSolidCircle', 'drawRect', 'drawSolidRect', 'drawEllipse', 'drawSolidEllipse', 'drawArc', 'drawSolidArc', 'drawSolidPolygon'],
        figure: 'shapes2d', caption: 'Circle / Ellipse / Rect / đường cong (sơ đồ)',
        code: [
            "import { Color, Vec2 } from 'cc';",
            'onDrawGizmos(): void {',
            '  const n = this.node;',
            '  Gizmos2D.beginLocalPosition(n);',
            '  Gizmos2D.beginColor(n, Color.CYAN);',
            '  Gizmos2D.drawCircle(n, new Vec2(0, 0), 45);',
            '  Gizmos2D.drawRect(n, new Vec2(70, -30), 75, 60);',
            '  Gizmos2D.beginColor(n, Color.YELLOW);',
            '  Gizmos2D.drawSolidCircle(n, new Vec2(-90, 0), 15);',
            '  Gizmos2D.endLocalPosition(n);',
            '}',
        ].join('\n'),
    },
    {
        id: 'curves2d', group: '2d', heading: 'Gizmos2D: đường cong & annotation',
        summary: 'Bezier, quadratic curve, label và sprite có ID ổn định; label hỗ trợ giới hạn kích thước khi zoom.',
        apis: ['drawBezierCurves', 'drawQuadraticCurve', 'drawSprite', 'drawLabel', 'beginLayer', 'DEFAULT_LAYER'],
        figure: 'labels', caption: 'Nhãn gắn với vị trí trong Scene View',
        code: [
            "import { Color, Vec2 } from 'cc';",
            'onDrawGizmos(): void {',
            '  const n = this.node;',
            '  Gizmos2D.beginColor(n, Color.MAGENTA);',
            '  Gizmos2D.drawQuadraticCurve(n,',
            '    new Vec2(-100, 0), new Vec2(0, 100), new Vec2(100, 0));',
            "  Gizmos2D.drawLabel(n, 'tip', 'Editable path',",
            '    new Vec2(0, 120), 18, Vec2.ONE, 12, 24);',
            '}',
        ].join('\n'),
    },
    {
        id: 'shapes3d', group: '3d', heading: 'Gizmos3D: khối và wireframe',
        summary: 'Các primitive dùng tọa độ Vec3; thay đổi màu theo node và bật/tắt depth test khi cần.',
        apis: ['drawSphere', 'drawBox', 'drawCircle', 'drawDisc', 'drawPolygon', 'drawCylinder', 'drawCone', 'drawCapsule', 'drawOctahedron', 'drawCross', 'setDepTest'],
        figure: 'shapes3d', caption: 'Sphere / Box / Cylinder (sơ đồ, không phải ảnh Scene)',
        code: [
            "import { Color, Vec3 } from 'cc';",
            'onDrawGizmos(): void {',
            '  const n = this.node, p = n.worldPosition;',
            '  Gizmos3D.setDepTest(n, false);',
            '  Gizmos3D.beginColor(n, Color.YELLOW);',
            '  Gizmos3D.drawSphere(n, p, 1, true);',
            '  Gizmos3D.drawBox(n,',
            '    new Vec3(p.x + 3, p.y, p.z), new Vec3(2, 2, 2));',
            '  Gizmos3D.setDepTest(n, true);',
            '}',
        ].join('\n'),
    },
    {
        id: 'curves3d', group: '3d', heading: 'Gizmos3D: vector, mesh & labels',
        summary: 'Line/arrow/quad, đường cong 3D, mesh; nhãn vị trí có min/max kích thước trong screen pixels.',
        apis: ['drawLine', 'drawLineList', 'drawDashLine', 'drawDashLineList', 'drawArrow', 'drawQuad', 'drawBezier', 'drawSpline', 'drawMesh', 'drawSprite', 'drawLabel', 'drawPositionLabel', 'drawPlanePreview'],
        figure: 'labels', caption: 'Một nhãn tọa độ cố định kích thước khi zoom',
        code: [
            "import { Color, Vec3 } from 'cc';",
            'onDrawGizmosSelected(): void {',
            '  const n = this.node;',
            '  Gizmos3D.beginColor(n, Color.CYAN);',
            '  Gizmos3D.drawArrow(n, n.worldPosition,',
            '    new Vec3(n.worldPosition.x + 2,',
            '      n.worldPosition.y, n.worldPosition.z), 0.2);',
            "  Gizmos3D.drawPositionLabel(n, 'pos', n.worldPosition,",
            '    { offsetPixels: 82, minSize: 12, maxSize: 22 });',
            '}',
        ].join('\n'),
    },
    {
        id: 'move', group: 'handles', heading: 'Gizmos3D.move(): Move Object Position',
        summary: 'Một lời gọi tạo 3 arrow X/Y/Z và 3 plane XY/XZ/YZ. Kéo tự do mặc định, hỗ trợ Undo và snap tùy chọn.',
        apis: ['Gizmos3D.move', 'onGizmoHandles', 'onGizmoChanged', 'axisSize', 'planeSize', 'planeOffset', 'boxSize', 'snap'],
        figure: 'move', caption: 'Sơ đồ Move Gizmo với arrow và các ô chọn plane sát tâm',
        code: [
            "import { _decorator, Component, Vec3 } from 'cc';",
            "const { ccclass, property } = _decorator;",
            "@ccclass('MoveExample')",
            'export class MoveExample extends Component {',
            '  @property({ type: Vec3 })',
            '  targetPosition = new Vec3();',
            '  onGizmoHandles(): GizmoHandleList {',
            "    return [...Gizmos3D.move('targetPosition', {",
            "      space: 'local', axisSize: 66, pickSize: 24,",
            '      planeSize: 18, planeOffset: 14,',
            '      showPositionLabel: true,',
            '    })];',
            '  }',
            '}',
        ].join('\n'),
    },
    {
        id: 'move2d', group: 'handles', heading: 'Gizmos2D.move(): Move Object Position 2D',
        summary: 'Hai arrow X/Y và một ô XY sát tâm để di chuyển Vec3 trên Canvas 2D. Không thay đổi Z, mặc định kéo liên tục không snap; hỗ trợ Undo/Redo, Local/World, callback và @registerGizmos.',
        apis: ['Gizmos2D.move', 'GizmosMove2DHandleOptions', 'onGizmoChanged', 'axisSize', 'pickSize', 'planeSize', 'planeOffset', 'snap'],
        figure: 'move2d', caption: '2D X (đỏ), Y (xanh lá), XY (vàng); không có trục Z',
        code: [
            "import { _decorator, Component, Vec3 } from 'cc';",
            'const { ccclass, property } = _decorator;',
            "@ccclass('Move2DExample')",
            'export class Move2DExample extends Component {',
            '  @property({ type: Vec3 }) targetPosition = new Vec3();',
            '  onGizmoHandles(): GizmoHandleList {',
            "    return [...Gizmos2D.move('targetPosition', {",
            "      space: 'local', axisSize: 66, pickSize: 24,",
            '      planeSize: 18, planeOffset: 14,',
            '      showPositionLabel: true,',
            '    })];',
            '  }',
            '  onGizmoChanged(name: string, phase: GizmoHandlePhase): void {',
            "    if (name === 'targetPosition' && phase === 'update') {",
            '      // targetPosition đã chứa giá trị mới',
            '    }',
            '  }',
            '}',
        ].join('\n'),
    },
    {
        id: 'points', group: 'handles', heading: 'Gizmos2D.point() và points()',
        summary: 'Điểm có thể kéo trong Scene; dùng point() cho Vec3 và points() cho Vec3[]. Không khai báo snap nếu muốn kéo liên tục.',
        apis: ['Gizmos2D.point', 'Gizmos2D.points', 'GizmoHandleDescriptor', 'plane', 'bounds', 'space', 'pickSize'],
        figure: 'handles2d', caption: 'Các điểm chỉnh sửa dọc một polyline',
        code: [
            "import { _decorator, Component, Vec3 } from 'cc';",
            'const { ccclass, property } = _decorator;',
            "@ccclass('PathExample')",
            'export class PathExample extends Component {',
            '  @property({ type: Vec3 }) point = new Vec3();',
            '  @property({ type: [Vec3] }) waypoints: Vec3[] = [];',
            '  onGizmoHandles(): GizmoHandleList {',
            '    return [',
            "      Gizmos2D.point('point', { color: '#ffcc00' }),",
            "      ...Gizmos2D.points('waypoints', this.waypoints.length),",
            '    ];',
            '  }',
            '}',
        ].join('\n'),
    },
    {
        id: 'hud', group: 'hud', heading: 'Scene HUD: text và controls',
        summary: 'Tạo HUD từ callback. Tùy chỉnh từng control bằng order, size (small/normal/large), fontSize và width (button/slider); vùng click slider đồng bộ với track.',
        apis: ['onGizmoHud', 'onGizmoHudControls', 'onGizmoHudAction', 'onGizmoHudChanged', 'GizmoHudItem', 'GizmoHudControlList'],
        figure: 'hud', caption: 'Minh họa HUD gồm slider, toggle, checkbox và nút bấm',
        code: [
            'onGizmoHud(): GizmoHudItem[] {',
            "  return [{ id: 'title', text: 'Edit my gizmo', order: 0 }];",
            '}',
            'onGizmoHudControls(): GizmoHudControlList {',
            '  return [',
            "    { type: 'slider', id: 'size', text: 'Size',",
            "      property: 'size', min: 0, max: 100,",
            "      width: 220, size: 'large', fontSize: 16, order: 1 },",
            "    { type: 'checkbox', id: 'visible', text: 'Visible',",
            "      property: 'visible' },",
            "    { type: 'button', id: 'reset', text: 'Reset' },",
            '  ];',
            '}',
            'onGizmoHudAction(id: string): void {',
            "  if (id === 'reset') this.size = 25;",
            '}',
        ].join('\n'),
    },
    {
        id: "callbacks-overview", group: "callbacks", heading: "Callback: khai báo, vẽ và hiển thị",
        summary: "onGizmoSettings() quyết định visibility, onGizmoHandles() trả mô tả tay nắm, onDrawGizmos() vẽ khi component được phép hiển thị, onDrawGizmosSelected() chỉ vẽ khi chọn node. Không chỉnh dữ liệu Scene trong callback vẽ.",
        apis: ["onGizmoSettings", "onGizmoHandles", "onDrawGizmos", "onDrawGizmosSelected", "onGizmoHud"],
        figure: "callbackFlow", caption: "Luồng callback trong Editor: khai báo và vẽ, sau đó xử lý sự kiện",
        notes: [
            "onGizmoSettings: trả display = always / selected / off; hud = selected / always / off.",
            "onGizmoHandles: trả danh sách handle liên kết với thuộc tính Vec3 / Vec3[].",
            "onDrawGizmos: vẽ tùy theo display; onDrawGizmosSelected: vẽ riêng khi Node được chọn.",
            "Đặt Gizmos2D/Gizmos3D trong callback, không gọi trong constructor hoặc top-level initializer.",
        ],
        code: [
            "import { _decorator, Component, Color, Vec3 } from 'cc';",
            "const { ccclass, property } = _decorator;",
            "@ccclass('CallbackOverview')",
            "export class CallbackOverview extends Component {",
            "  @property({ type: Vec3 }) point = new Vec3(1, 0, 0);",
            "  onGizmoSettings(): GizmoViewSettings {",
            "    return { display: 'always', hud: 'selected' };",
            "  }",
            "  onGizmoHandles(): GizmoHandleList {",
            "    return [...Gizmos3D.move('point')];",
            "  }",
            "  onDrawGizmos(): void {",
            "    Gizmos3D.beginColor(this.node, Color.CYAN);",
            "    const p = this.node.worldPosition;",
            "    Gizmos3D.drawLine(this.node, p,",
            "      new Vec3(p.x + 1, p.y, p.z));",
            "  }",
            "  onDrawGizmosSelected(): void {",
            "    Gizmos3D.beginColor(this.node, Color.YELLOW);",
            "    Gizmos3D.drawSphere(this.node, this.node.worldPosition, 0.25);",
            "  }",
            "}",
        ].join('\n'),
    },
    {
        id: "callback-phases", group: "callbacks", heading: "onGizmoChanged: begin / update / end / cancel",
        summary: "Callback nhận (property, phase, index?). begin bắt đầu kéo, update xảy ra sau khi Vec3 được ghi, end hoàn tất và cancel khôi phục giá trị ban đầu. Khi thay đổi dữ liệu phụ thuộc, xử lý cả update, end, cancel.",
        apis: ["onGizmoChanged", "GizmoHandlePhase", "onRestore", "Vec3.transformMat4", "setWorldPosition"],
        figure: "callbackFlow", caption: "Một lượt drag: begin → update (nhiều lần) → end hoặc cancel",
        notes: [
            "phase='begin': bắt đầu thao tác, chưa nhất thiết có thay đổi vị trí.",
            "phase='update': dữ liệu Vec3 đã được ghi; sử dụng để cập nhật Node / preview.",
            "phase='end': kết thúc drag (có thể không đổi); phase='cancel': dữ liệu đã được hoàn nguyên, ví dụ Escape.",
            "onRestore(): khôi phục dữ liệu dẫn xuất sau Undo / Inspector reset; hãy kiểm tra Undo/Redo trong Editor thật.",
        ],
        code: [
            "import { _decorator, Component, Node, Vec3 } from 'cc';",
            "const { ccclass, property } = _decorator;",
            "@ccclass('MoveCallbackExample')",
            "export class MoveCallbackExample extends Component {",
            "  @property({ type: Vec3 }) position = new Vec3();",
            "  @property({ type: Node }) movedNode: Node | null = null;",
            "  onGizmoHandles(): GizmoHandleList {",
            "    return [...Gizmos3D.move('position')];",
            "  }",
            "  onGizmoChanged(name: string, phase: GizmoHandlePhase,",
            "      index?: number): void {",
            "    if (name !== 'position') return;",
            "    if (phase === 'begin') return;",
            "    // 'update', 'end', 'cancel': đồng bộ theo Vec3 hiện tại.",
            "    this.syncMovedNode();",
            "  }",
            "  onRestore(): void { this.syncMovedNode(); }",
            "  private syncMovedNode(): void {",
            "    if (!this.movedNode?.isValid) return;",
            "    const world = Vec3.transformMat4(new Vec3(),",
            "      this.position, this.node.worldMatrix);",
            "    this.movedNode.setWorldPosition(world);",
            "  }",
            "}",
        ].join('\n'),
    },
    {
        id: "callback-index", group: "callbacks", heading: "onGizmoChanged: index của Vec3[]",
        summary: "Khi khai báo Gizmos2D.points() cho một mảng Vec3, tham số index cho biết point nào đang kéo. Một Vec3 đơn sẽ có index === undefined.",
        apis: ["Gizmos2D.points", "onGizmoHandles", "onGizmoChanged", "index", "onDrawGizmos"],
        figure: "handles2d", caption: "Kéo point nào sẽ nhận index tương ứng trong callback",
        notes: [
            "index có kiểu number | undefined: luôn kiểm tra trước khi truy cập mảng.",
            "Dùng phase='update' để refresh preview; phase='cancel' để tái đồng bộ sau hoàn nguyên.",
            "Không ghi lại this.waypoints[index] trong callback chỉ để giữ nguyên vị trí: adapter đã ghi giá trị.",
        ],
        code: [
            "import { _decorator, Component, Vec3 } from 'cc';",
            "const { ccclass, property } = _decorator;",
            "@ccclass('PointsCallbackExample')",
            "export class PointsCallbackExample extends Component {",
            "  @property({ type: [Vec3] }) waypoints: Vec3[] = [",
            "    new Vec3(-60, 0, 0), new Vec3(60, 0, 0),",
            "  ];",
            "  lastMovedIndex = -1;",
            "  onGizmoHandles(): GizmoHandleList {",
            "    return Gizmos2D.points('waypoints', this.waypoints.length);",
            "  }",
            "  onGizmoChanged(name: string, phase: GizmoHandlePhase,",
            "      index?: number): void {",
            "    if (name !== 'waypoints' || index === undefined) return;",
            "    if (phase === 'update' || phase === 'end' ||",
            "        phase === 'cancel') {",
            "      this.lastMovedIndex = index;",
            "      // this.waypoints[index] đã được cập nhật / hoàn nguyên.",
            "    }",
            "  }",
            "}",
        ].join('\n'),
    },
    {
        id: "callback-hud", group: "callbacks", heading: "HUD callback: slider / checkbox / button",
        summary: "Slider phát begin/update/end/cancel qua onGizmoHudChanged(name, phase, value). Toggle/checkbox thường phát begin/update/end; button chỉ gọi onGizmoHudAction(id). Giá trị thuộc tính đã được áp dụng khi nhận update.",
        apis: ["onGizmoHud", "onGizmoHudControls", "onGizmoHudChanged", "onGizmoHudAction", "GizmoHandlePhase", "onRestore"],
        figure: "hud", caption: "Giá trị được ghi trước callback update; button dùng event riêng",
        notes: [
            "Slider có thể phát cancel khi kéo bị hủy; toggle/checkbox là click, không có quá trình drag kéo dài.",
            "Slider click trên track đặt value ngay, width tùy chỉnh luôn dùng chung tọa độ giữa HUD và picking.",
            "Click vào thanh slider sẽ set value ngay; click-trên-track và kéo dùng tọa độ tuyệt đối, tuân theo min/max/step.",
            "Nhấn Escape khi đang giữ slider sẽ hoàn nguyên cả giá trị được chọn bằng click (cancel); thả chuột commit trong một phiên Undo/Redo.",
            "onGizmoHudChanged nhận value: number | boolean; kiểm tra typeof khi dùng dữ liệu.",
            "onGizmoHudAction(id) dùng cho button, không nhận phase hoặc value.",
            "Không gán lại field vô điều kiện trong callback update; Editor đã cập nhật field trước đó.",
        ],
        code: [
            "import { _decorator, Component, Vec2 } from 'cc';",
            "const { ccclass, property } = _decorator;",
            "@ccclass('HudCallbackExample')",
            "export class HudCallbackExample extends Component {",
            "  @property radius = 40;",
            "  @property visible = true;",
            "  lastEvent = 'none';",
            "  onGizmoHud(): GizmoHudItem[] {",
            "    return [{ id: 'status', text: this.lastEvent }];",
            "  }",
            "  onGizmoHudControls(): GizmoHudControlList {",
            "    return [",
            "      { type: 'slider', id: 'radius', text: 'Radius',",
            "        property: 'radius', min: 5, max: 100 },",
            "      { type: 'checkbox', id: 'visible', text: 'Visible',",
            "        property: 'visible' },",
            "      { type: 'button', id: 'reset', text: 'Reset' },",
            "    ];",
            "  }",
            "  onGizmoHudChanged(name: string, phase: GizmoHandlePhase,",
            "      value: number | boolean): void {",
            "    this.lastEvent = `${name}: ${phase} = ${String(value)}`;",
            "  }",
            "  onGizmoHudAction(id: string): void {",
            "    if (id === 'reset') this.radius = 40;",
            "  }",
            "  onDrawGizmos(): void {",
            "    if (this.visible) Gizmos2D.drawCircle(",
            "      this.node, Vec2.ZERO, this.radius);",
            "  }",
            "}",
        ].join('\n'),
    },
    {
        id: 'decorator', group: 'decorators',
        heading: '@registerGizmos(CustomDrawer): tách logic Editor khỏi Component',
        summary: 'Một drawer TypeScript implement IDrawGizmos<T> được tạo riêng cho từng Component khi callback đầu tiên chạy. Các method được bind vào Component trong Scene Editor; Preview/game không cài callback.',
        apis: ['registerGizmos', 'IDrawGizmos', 'EDITOR_NOT_IN_PREVIEW', 'Gizmos3D.move', 'onGizmoChanged'],
        figure: 'decorator',
        caption: 'Component → decorator → drawer theo từng instance (chỉ Scene Editor)',
        notes: [
            'Cài extension ở Project rồi import từ extensions/cocos-gizmos/dist/RegisterGizmos (đổi đường dẫn tương đối theo script). Đây là phụ thuộc BẮT BUỘC.',
            'Định nghĩa class Drawer trước Component vì decorator được thực thi ngay khi khai báo class.',
            'Mỗi Component được khởi tạo một drawer khi cần; drawer.component trỏ đúng Component đó.',
            'Drawer dùng class methods (không dùng arrow fields). Các callback còn trên Component sẽ được giữ nếu Drawer không triển khai.',
            'Không có side-effect trên Preview hoặc game vì module kiểm tra EDITOR_NOT_IN_PREVIEW.',
        ],
        code: [
            "import { _decorator, Component, Vec3, Color } from 'cc';",
            "import { registerGizmos, type IDrawGizmos }",
            "  from '../extensions/cocos-gizmos/dist/RegisterGizmos';",
            "const { ccclass, property } = _decorator;",
            "",
            "class CompADrawer implements IDrawGizmos<CompA> {",
            "  constructor(public readonly component: CompA) {}",
            "  onGizmoHandles(): GizmoHandleList {",
            "    return [...Gizmos3D.move('targetPosition')];",
            "  }",
            "  onDrawGizmos(): void {",
            "    const c = this.component;",
            "    Gizmos3D.beginColor(c.node, Color.CYAN);",
            "    Gizmos3D.drawSphere(c.node, c.node.worldPosition, 0.25);",
            "  }",
            "  onGizmoChanged(name: string, phase: GizmoHandlePhase): void {",
            "    if (name === 'targetPosition' && phase === 'update') {",
            "      // c.targetPosition đã chứa vị trí mới",
            "    }",
            "  }",
            "}",
            "",
            "@ccclass('CompA')",
            "@registerGizmos(CompADrawer)",
            "export class CompA extends Component {",
            "  @property({ type: Vec3 })",
            "  targetPosition = new Vec3(1, 0, 0);",
            "}",
        ].join('\n'),
    },
]); 
const groups = [
    ['all', 'Tất cả'],
    ['start', 'Bắt đầu'],
    ['2d', '2D'],
    ['3d', '3D'],
    ['handles', 'Move / Points'],
    ['callbacks', 'Callbacks'],
    ['hud', 'HUD'],
    ['decorators', 'Decorators'],
];
function html(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}
function renderExample(example) {
    const keywords = [
        example.heading, example.summary, example.apis.join(' '), example.code,
        (example.notes || []).join(' '),
    ].join(' ').toLowerCase();
    return [
        '<article class="cg-api-card" data-doc-group="', html(example.group),
        '" data-doc-search="', html(keywords), '">',
        '<div class="cg-api-card-head"><h2>', html(example.heading), '</h2>',
        '<button class="cg-copy" type="button" data-doc-copy="', html(example.id),
        '" aria-label="Sao chép ví dụ ', html(example.heading), '">Copy code</button></div>',
        '<p class="cg-desc">', html(example.summary), '</p>',
        '<figure class="cg-figure">', drawings[example.figure],
        '<figcaption>', html(example.caption), '</figcaption></figure>',
        example.notes ? '<ul class="cg-notes">' + example.notes.map(note =>
            '<li>' + html(note) + '</li>').join('') + '</ul>' : '',
        '<pre class="cg-code"><code>', html(example.code), '</code></pre>',
        '<div class="cg-tags">',
        example.apis.map(api => '<code>' + html(api) + '</code>').join(''),
        '</div></article>',
    ].join('');
}
exports.template = [
    '<main class="cg-docs">',
    '<header class="cg-hero"><span class="cg-eyebrow">COCOS-GIZMOS · EDITOR API</span>',
    '<h1>Gizmos Open Document</h1><p>Tra cứu API, ví dụ TypeScript và sơ đồ minh họa ngay trong Cocos Creator.</p>',
    '<p class="cg-hint">Gizmos chỉ vẽ trong Scene Editor; callback có thể tồn tại trong component mà không chạy trong game.</p></header>',
    '<div class="cg-toolbar"><label for="cg-doc-search">Tìm API</label>',
    '<input id="cg-doc-search" type="search" placeholder="move, callback, begin/update, HUD..." autocomplete="off" /></div>',
    '<nav class="cg-nav" id="cg-doc-tabs" aria-label="Nhóm API">',
    groups.map(([id, label], i) => '<button type="button" data-doc-tab="' +
        id + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' + label + '</button>').join(''),
    '</nav>',
    '<section id="cg-doc-cards" class="cg-grid" aria-label="API examples">',
    examples.map(renderExample).join(''),
    '</section>',
    '<p id="cg-doc-empty" hidden>Không tìm thấy API phù hợp. Thử từ khóa khác.</p>',
    '<p id="cg-doc-status" class="cg-status" role="status" aria-live="polite"></p>',
    '<footer class="cg-footer">Hình minh họa là sơ đồ SVG, không phải ảnh chụp Scene. ',
    'Các ví dụ gọi Gizmos trong callback Editor. API đầy đủ xem tên hàm bên dưới mỗi ví dụ.</footer>',
    '</main>',
].join('');

exports.style = [
    '.cg-docs { box-sizing:border-box; height:100%; min-height:250px; overflow-y:auto;',
    '  padding:18px; background:var(--color-normal, #171f2a); color:var(--color-normal-fill, #e8eff9);',
    '  font:13px/1.55 sans-serif; }',
    '.cg-docs * { box-sizing:border-box; }',
    '.cg-hero { padding:18px 20px; background:linear-gradient(120deg,#21314c,#192c39);',
    '  border:1px solid #354c69; border-radius:12px; }',
    '.cg-eyebrow { color:#7ecbff; font-size:10px; letter-spacing:.14em; font-weight:700; }',
    '.cg-hero h1 { color:#f3f7ff; font-size:24px; margin:3px 0 6px; }',
    '.cg-hero p { color:#cfdaea; margin:6px 0; }',
    '.cg-hero .cg-hint { color:#a9c7dc; font-size:12px; }',
    '.cg-toolbar { margin:16px 0 9px; display:flex; align-items:center; gap:12px; }',
    '.cg-toolbar label { font-weight:700; white-space:nowrap; }',
    '#cg-doc-search { min-width:0; flex:1; border-radius:6px; border:1px solid #54718a;',
    '  padding:9px 11px; background:#111c2b; color:#fff; font:inherit; }',
    '.cg-nav { display:flex; flex-wrap:wrap; gap:7px; margin:0 0 16px; }',
    '.cg-nav button,.cg-copy { color:#dceaf9; border:1px solid #59738e; border-radius:6px;',
    '  padding:6px 11px; background:#2b4059; cursor:pointer; font:inherit; }',
    '.cg-nav button[aria-pressed="true"] { color:#071b28; background:#8fdbf5; border-color:#8fdbf5; font-weight:700; }',
    '.cg-nav button:focus-visible,.cg-copy:focus-visible { outline:2px solid #a1e6ff; outline-offset:2px; }',
    '.cg-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr)); gap:14px; }',
    '.cg-api-card { min-width:0; padding:14px; border-radius:10px; border:1px solid #354b63; background:#202c3d; }',
    '.cg-api-card[hidden], #cg-doc-empty[hidden] { display:none !important; }',
    '.cg-api-card-head { display:flex; gap:8px; justify-content:space-between; align-items:flex-start; }',
    '.cg-api-card h2 { font-size:16px; color:#f5f9ff; margin:0; line-height:1.35; }',
    '.cg-copy { white-space:nowrap; font-size:11px; padding:5px 8px; }',
    '.cg-desc { margin:9px 0; color:#c0d0e3; min-height:35px; }',
    '.cg-figure { margin:12px 0; } .cg-figure svg { display:block; width:100%; height:auto; max-height:180px; }',
    '.cg-figure figcaption { font-size:11px; margin-top:4px; color:#9fb7d1; }',
    '.cg-notes { margin:7px 0 12px; padding-left:19px; color:#c2d5e8; }',
    '.cg-notes li { margin:3px 0; }',
    '.cg-code { overflow-x:auto; background:#101927; border:1px solid #394a62;',
    '  color:#d0f2f2; border-radius:7px; padding:12px; margin:9px 0; font:12px/1.5 monospace; }',
    '.cg-tags { display:flex; flex-wrap:wrap; gap:5px; }',
    '.cg-tags code { display:inline-block; font:11px/1.45 monospace; padding:3px 6px;',
    '  background:#30455b; color:#b8ddff; border-radius:4px; }',
    '.cg-status { color:#acdff0; min-height:20px; }',
    '.cg-footer { font-size:11px; margin-top:10px; color:#9db4c9; }',
    '@media(max-width:520px) { .cg-docs { padding:10px; } .cg-hero { padding:13px; }',
    '  .cg-api-card { padding:10px; } .cg-api-card-head { flex-wrap:wrap; } }',
].join('\n');

exports.$ = {
    search: '#cg-doc-search',
    tabs: '#cg-doc-tabs',
    cards: '#cg-doc-cards',
    empty: '#cg-doc-empty',
    status: '#cg-doc-status',
};
exports.ready = function ready() {
    const host = this;
    const ui = host.$;
    host._cgDocGroup = 'all';
    const refresh = () => {
        const term = String(ui.search.value || '').trim().toLowerCase();
        const items = ui.cards.querySelectorAll('.cg-api-card');
        let count = 0;
        for (const card of items) {
            const match = (host._cgDocGroup === 'all' ||
                card.dataset.docGroup === host._cgDocGroup) &&
                (card.dataset.docSearch || '').includes(term);
            card.hidden = !match;
            if (match) count++;
        }
        ui.empty.hidden = count !== 0;
        for (const tab of ui.tabs.querySelectorAll('[data-doc-tab]')) {
            tab.setAttribute('aria-pressed', String(tab.dataset.docTab === host._cgDocGroup));
        }
    };
    const onSearch = () => refresh();
    const onTab = event => {
        const tab = event.target?.closest?.('[data-doc-tab]');
        if (!tab || !groups.some(([id]) => id === tab.dataset.docTab)) return;
        host._cgDocGroup = tab.dataset.docTab;
        refresh();
    };
    const onCopy = async event => {
        const button = event.target?.closest?.('[data-doc-copy]');
        if (!button) return;
        const item = examples.find(value => value.id === button.dataset.docCopy);
        if (!item) return;
        try {
            const clipboard = globalThis.navigator?.clipboard;
            if (!clipboard || typeof clipboard.writeText !== 'function') {
                ui.status.textContent = 'Clipboard chưa khả dụng trong Editor; bạn có thể chọn code để copy.';
                return;
            }
            await clipboard.writeText(item.code);
            ui.status.textContent = 'Đã sao chép ví dụ: ' + item.heading;
        } catch (error) {
            ui.status.textContent = 'Không thể copy: ' + String(error?.message || error);
        }
    };
    host._cgDocSearch = onSearch;
    host._cgDocTabClick = onTab;
    host._cgDocCopyClick = onCopy;
    ui.search.addEventListener('input', onSearch);
    ui.tabs.addEventListener('click', onTab);
    ui.cards.addEventListener('click', onCopy);
    refresh();
};
exports.close = function close() {
    const ui = this.$;
    if (this._cgDocSearch) ui.search.removeEventListener('input', this._cgDocSearch);
    if (this._cgDocTabClick) ui.tabs.removeEventListener('click', this._cgDocTabClick);
    if (this._cgDocCopyClick) ui.cards.removeEventListener('click', this._cgDocCopyClick);
    this._cgDocSearch = this._cgDocTabClick = this._cgDocCopyClick = null;
};
