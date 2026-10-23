import { _decorator, Color, Component, Mesh, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('GizmosDrawMeshTest')
export class GizmosDrawMeshTest extends Component {
    @property({ type: Mesh })
    mesh: Mesh | null = null;

    @property
    wireframe = true;

    private _drawCount = 0;

    onDrawGizmos(): void {
        ++this._drawCount;
        if (this._drawCount === 1 || this._drawCount % 300 === 0) {
            console.info('[GizmosDrawMeshTest] onDrawGizmos updated:', this._drawCount);
        }
        Gizmos3D.beginColor(this.node, Color.GREEN);
        if (this.mesh) {
            Gizmos3D.drawMesh(this.node, this.mesh, this.node.worldPosition, Vec3.ZERO, Vec3.ONE, this.wireframe);
            return;
        }
        Gizmos3D.drawMesh(this.node, {
            vertices: [
                new Vec3(0, 1, 0), new Vec3(-1, -1, 1),
                new Vec3(1, -1, 1), new Vec3(0, -1, -1),
            ],
            indices: [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2],
        }, this.node.worldPosition, Vec3.ZERO, new Vec3(50, 50, 50), this.wireframe);
    }
    onDrawGizmosSelected(): void {
        // Optional selected-only drawing.
    }
}
