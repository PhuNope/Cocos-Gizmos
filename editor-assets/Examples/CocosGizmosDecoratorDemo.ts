import { _decorator, Component, Color, Vec3 } from 'cc';
import { registerGizmos, type IDrawGizmos } from '../RegisterGizmos';

const { ccclass, property } = _decorator;

/** Plain TypeScript drawer class, not a second Cocos Component. */
class CustomDrawer implements IDrawGizmos<CocosGizmosDecoratorDemo> {
    constructor(public readonly component: CocosGizmosDecoratorDemo) {}

    onGizmoSettings(): GizmoViewSettings {
        return { display: 'always', hud: 'selected' };
    }
    onGizmoHandles(): GizmoHandleList {
        return [...Gizmos3D.move('moveObject')];
    }
    onGizmoHud(): GizmoHudItem[] {
        return [{ id: 'title', text: 'Registered Gizmos Drawer' },
            { id: 'event', text: this.component.lastEvent }];
    }
    onGizmoHudControls(): GizmoHudControlList {
        return [{ type: 'button', id: 'reset', text: 'Reset position' }];
    }
    onGizmoHudAction(id: string): void {
        if (id === 'reset') this.component.moveObject = new Vec3(1.2, 0.8, 0);
    }
    onGizmoChanged(name: string, phase: GizmoHandlePhase, index?: number): void {
        this.component.lastEvent = name +
            (index === undefined ? '' : '[' + index + ']') + ': ' + phase;
    }
    onDrawGizmos(): void {
        const owner = this.component;
        const world = Vec3.transformMat4(new Vec3(),
            owner.moveObject, owner.node.worldMatrix);
        Gizmos3D.beginColor(owner.node, Color.CYAN);
        Gizmos3D.drawSphere(owner.node, world, 0.3);
    }
    onDrawGizmosSelected(): void {
        const owner = this.component;
        const world = Vec3.transformMat4(new Vec3(),
            owner.moveObject, owner.node.worldMatrix);
        Gizmos3D.drawPositionLabel(owner.node, 'registered-position', world);
    }
}

@ccclass('CocosGizmosDecoratorDemo')
@registerGizmos(CustomDrawer)
export class CocosGizmosDecoratorDemo extends Component {
    @property({ type: Vec3 }) public moveObject = new Vec3(1.2, 0.8, 0);
    public lastEvent = 'none';
}
