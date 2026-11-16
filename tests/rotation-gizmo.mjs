import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evaluate = (name, imports = {}) => {
    const source = readFileSync(path.join(root, 'source', name + '.ts'), 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2017 },
    }).outputText;
    const sandbox = { exports: {}, require(name) {
        if (name in imports) return imports[name];
        throw Error('Missing module: ' + name);
    }};
    vm.runInNewContext(code, sandbox);
    return sandbox.exports;
};
const geometry = evaluate('RotationHandleGeometry');
const solver = evaluate('RotationDragSolver', {
    './RotationHandleGeometry': geometry,
});
const edits = evaluate('GizmoEditSession');
const moves = evaluate('GizmoMoveCommand', {
    './GizmoEditSession': edits, './PositionDragSolver': evaluate('PositionDragSolver'),
});
const commands = evaluate('GizmoRotateCommand', {
    './RotationHandleGeometry': geometry,
    './RotationDragSolver': solver,
    './GizmoMoveCommand': moves,
    './GizmoEditSession': edits,
});
const presets = evaluate('GizmoHandlePresets');
const { rotationRingGeometry, rotationRingDistanceSquared, rotateBasis,
    rotateEulerQuat, rotateQuatMul, rotateAxisQuat,
    rotateAxisVector, ROTATE_IDENTITY } = geometry;
const near = (a,b,message) => assert.ok(Math.abs(a-b)<1e-4,
    message + ': expected ' + b + ', got ' + a);
const initial = {x:0,y:0,z:0}, center = {x:0,y:0,z:0};
const cast = (x,y) => ({o:{x,y,z:100},d:{x:0,y:0,z:-1}});
const ring2d = rotationRingGeometry(center,rotateBasis(initial,ROTATE_IDENTITY,'local'),
    'z',0.72);
assert.equal(ring2d.points.length,65);
near(ring2d.points[0].x,0.72,'Ring begins on positive X');
near(ring2d.points[16].y,0.72,'Ring passes positive Y');
const projected = ring2d.points.map(({x,y}) => ({x,y}));
near(rotationRingDistanceSquared({x:0.72,y:0},projected),0,
    'Hit-testing matches actual circle circumference');
assert.ok(rotationRingDistanceSquared({x:0,y:0},projected)>0.5,
    'The empty center is not a rotation hit target');
assert.equal(rotationRingGeometry(center,rotateBasis(initial,ROTATE_IDENTITY,'local'),
    'z',0),null);
assert.equal(presets.makeRotateGizmo('rotationEuler').length,3);
assert.deepEqual(Array.from(presets.makeRotateGizmo('rotationEuler'), h => h.axis),
    ['x','y','z']);
assert.deepEqual(Array.from(presets.makeRotateGizmo2D('rotationEuler'), h => h.axis), ['z']);
assert.throws(()=>presets.makeRotateGizmo('angle',{snap:-15}));
assert.throws(()=>presets.makeRotateGizmo('angle',{ringSize:400}));
const selectedPivot=presets.makeRotateGizmo('tangentRotation',{
    pivotProperty:'activeKnotPosition',pivotSpace:'local',space:'world'});
assert.equal(selectedPivot.length,3);
assert.deepEqual(Array.from(selectedPivot,x=>x.pivotProperty),
    ['activeKnotPosition','activeKnotPosition','activeKnotPosition']);
assert.deepEqual(Array.from(selectedPivot,x=>x.pivotSpace),['local','local','local']);
assert.throws(()=>presets.makeRotateGizmo('angle',{pivotProperty:''}),/pivotProperty/);
assert.throws(()=>presets.makeRotateGizmo('angle',{pivotSpace:'wrong'}),/pivotSpace/);
const positionAdapterSource=readFileSync(path.join(root,'source','PositionHandles.ts'),'utf8');
assert.match(positionAdapterSource,/field\.pivotProperty/);
assert.match(positionAdapterSource,/Vec3\.transformMat4\(world,new Vec3\(pivot\.x/);
assert.match(positionAdapterSource,/field\.pivotProperty, field\.pivotSpace/);


const circular = new solver.RotationDragSolver(initial,center,{x:0,y:0,z:1},
    ROTATE_IDENTITY,{axis:'z',space:'local',twoD:true});
assert.equal(circular.begin(cast(1,0)),true);
near(circular.move(cast(0,1)).z,90,'Quarter turn rotates +90 degrees');
near(circular.move(cast(-1,0)).z,180,'Half turn rotates +180');
near(circular.move(cast(0,-1)).z,270,'Signed angles unwrap across -180');
near(circular.move(cast(1,0)).z,360,'Full circle reaches 360 degrees');
near(circular.move(cast(0,1)).z,450,'Second revolution keeps accumulating');
assert.deepEqual({...circular.cancel()},initial);
const snapped = new solver.RotationDragSolver(initial,center,{x:0,y:0,z:1},
    ROTATE_IDENTITY,{axis:'z',snap:15,twoD:true});
assert.equal(snapped.begin(cast(1,0)),true);
const a = Math.PI/180;
near(snapped.move(cast(Math.cos(23*a),Math.sin(23*a))).z,30,
    'Snap uses angular degrees (not translation units)');
const invalid = new solver.RotationDragSolver(initial,center,{x:0,y:0,z:1},
    ROTATE_IDENTITY,{axis:'z',twoD:true});
assert.equal(invalid.begin({o:{x:1,y:0,z:0},d:{x:1,y:0,z:0}}),false,
    'Parallel camera ray cannot start a rotation');
assert.throws(()=>new solver.RotationDragSolver(initial,center,{x:0,y:0,z:1},
    ROTATE_IDENTITY,{axis:'z',snap:0}));
// 3D X/Y rings become edge-on from front view. A ray parallel to the
// rotation plane should still rotate using the projected-screen tangent.
const edge = new solver.RotationDragSolver(initial,center,{x:1,y:0,z:0},
    ROTATE_IDENTITY,{axis:'x',space:'world'},
    {tangent:{x:0,y:1},radiusPixels:72});
const edgeRay={o:{x:0,y:1,z:10},d:{x:0,y:0,z:-1}};
assert.equal(edge.begin(edgeRay,{x:200,y:100}),true);
const edgeEuler=edge.move(edgeRay,{x:200,y:100+Math.PI*36});
assert.ok(edgeEuler && [edgeEuler.x,edgeEuler.y,edgeEuler.z].every(Number.isFinite));
near(edgeEuler.x,90,'Edge-on X ring responds to a screen drag');
assert.equal(edge.cancel().x,0);
assert.equal(edge.move(edgeRay),null,'Edge-on pointer coordinates are required');

const original = {x:30,y:40,z:12};
const frame = rotateEulerQuat({x:0,y:35,z:0});
const basis = rotateBasis(original,frame,'world');
const worldRing = rotationRingGeometry(center,basis,'z',1);
const world = new solver.RotationDragSolver(original,center,worldRing.normal,frame,
    {axis:'z',space:'world'});
assert.equal(world.begin(cast(1,0)),true);
const worldEuler = world.move(cast(0,1));
assert.ok(worldEuler && [worldEuler.x,worldEuler.y,worldEuler.z].every(Number.isFinite));
const expectedWorld = rotateQuatMul(
    rotateQuatMul(geometry.rotateQuatInverse(frame),
        rotateAxisQuat(rotateAxisVector('z'),90)),
    rotateQuatMul(frame,rotateEulerQuat(original)));
const actualWorld = rotateEulerQuat(worldEuler);
const qDot = Math.abs(expectedWorld.x*actualWorld.x + expectedWorld.y*actualWorld.y
    + expectedWorld.z*actualWorld.z + expectedWorld.w*actualWorld.w);
near(qDot,1,'World-axis drag composes quaternion in correct frame');
const localBasis = rotateBasis(original,frame,'local');
assert.ok(Math.hypot(localBasis.z.x,localBasis.z.y)>0.01,
    'Local ring follows rotated Euler property rather than world-Z');

let current={...initial};
const phases=[];
const command = new commands.GizmoRotateCommand(initial,center,{x:0,y:0,z:1},
    ROTATE_IDENTITY,{axis:'z',space:'local',twoD:true},
    {read:()=>current,write:value=>{current={...value};}},
    {begin:()=>phases.push('begin'), update:()=>phases.push('update'),
        end:()=>phases.push('end'),rollback:()=>phases.push('rollback')});
assert.equal(command.begin(cast(1,0)),true);
assert.equal(command.update(cast(0,1)),true);
near(current.z,90,'Rotation command writes live degree values');
command.end();
assert.ok(phases.includes('begin') && phases.includes('update'));
assert.ok(phases.includes('end'),'Committed rotation closes Undo transaction');
const cancelled = new commands.GizmoRotateCommand(current,center,{x:0,y:0,z:1},
    ROTATE_IDENTITY,{axis:'z',twoD:true},
    {read:()=>current,write:value=>{current={...value};}},
    {begin:()=>phases.push('begin'), rollback:()=>phases.push('rollback'),
        update:()=>phases.push('update'), end:()=>phases.push('end')});
assert.equal(cancelled.begin(cast(1,0)),true);
cancelled.update(cast(-1,0));
cancelled.cancel();
near(current.z,90,'Escape rolls back a rotation edit');
console.log('[rotation-gizmo] colored XYZ/Z rings, hit test, snap, quaternion space, 360°, undo/cancel OK');
