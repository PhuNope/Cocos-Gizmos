/** Read-only Cocos-Gizmos extension demo. Drag from db://cocos-gizmos/Examples. */
import { _decorator, Component, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Scene-only interactive Gizmo regression fixture.
 * Attach to a Node or a Prefab instance and select the Node in Scene View.
 * Serialized fields remain editable through the default Cocos Inspector.
 */
@ccclass('CocosGizmosSmokeDemo')
export default class CocosGizmosSmokeDemo extends Component {
    @property({ type: Vec3 })
    public point = new Vec3(150, 20, 0);

    @property({ type: [Vec3] })
    public checkpoints: Vec3[] = [
        new Vec3(-150, -20, 0),
        new Vec3(80, 100, 0),
    ];

    @property
    public radius = 75;

    @property
    public showRange = true;

    @property
    public showGrid = false;

    /** Last edit phase; diagnostic only, not a serialized property. */
    public lastPhase = 'not-edited';

    public onGizmoSettings(): GizmoViewSettings {
        return { display: 'selected', hud: 'selected' };
    }

    public onGizmoHandles(): GizmoHandleList {
        return [
            { property: 'point', plane: 'xy', space: 'local', snap: 5, color: '#ffcc00' },
            { property: 'checkpoints', index: 0, plane: 'xy', space: 'local' },
            { property: 'checkpoints', index: 1, plane: 'xy', space: 'local' },
        ];
    }

    public onGizmoHud(): GizmoHudItem[] {
        return [
            { id: 'title', text: 'Gizmo Smoke Probe', order: 0, color: '#ffffff' },
            { id: 'state', text: 'Last change: ' + this.lastPhase, order: 1 },
        ];
    }

    public onGizmoHudControls(): GizmoHudControlList {
        return [
            { type: 'slider', id: 'radius', text: 'Radius', property: 'radius', min: 0, max: 300, step: 5 },
            { type: 'toggle', id: 'show-range', text: 'Show Range', property: 'showRange' },
            { type: 'checkbox', id: 'show-grid', text: 'Show Grid', property: 'showGrid' },
            { type: 'button', id: 'reset-radius', text: 'Reset radius' },
        ];
    }

    public onGizmoHudAction(id: string): void {
        if (id === 'reset-radius') this.radius = 75;
    }

    public onGizmoHudChanged(property: string, phase: GizmoHandlePhase, value: number | boolean): void {
        this.lastPhase = property + ': ' + phase + ' (' + String(value) + ')';
    }

    public onGizmoChanged(property: string, phase: GizmoHandlePhase, index?: number): void {
        this.lastPhase = property + (index === undefined ? '' : '[' + index + ']') + ': ' + phase;
    }

    public onDrawGizmosSelected(): void {
        Gizmos2D.beginLocalPosition(this.node);
        if (this.showRange) {
            Gizmos2D.drawCircle(this.node, this.point, this.radius);
        }
        if (this.showGrid) {
            Gizmos2D.drawLine(this.node, { x: -200, y: 0 }, { x: 200, y: 0 });
            Gizmos2D.drawLine(this.node, { x: 0, y: -200 }, { x: 0, y: 200 });
        }
        Gizmos2D.drawLine(this.node, this.checkpoints[0], this.checkpoints[1]);
        Gizmos2D.endLocalPosition(this.node);
    }

    protected onRestore(): void {
        // The Editor restores serialized values; derive nonserialized state again.
        this.lastPhase = 'restored from Inspector / Undo';
    }
}
