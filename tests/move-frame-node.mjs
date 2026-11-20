import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile=name=>ts.transpileModule(
 readFileSync(new URL('../source/'+name+'.ts',import.meta.url),'utf8'),
 {compilerOptions:{target:ts.ScriptTarget.ES2019,module:ts.ModuleKind.CommonJS}}).outputText;
function load(source,mocks={}){
 const scope={exports:{},require(id){
  if(id in mocks)return mocks[id];
  throw Error('Unexpected dependency '+id);
 }};
 vm.runInNewContext(compile(source),scope);
 return scope.exports;
}
class Vec3 {
 constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
 static transformMat4(out,p,m){
  out.x=m[0]*p.x+m[4]*p.y+m[8]*p.z+m[12];
  out.y=m[1]*p.x+m[5]*p.y+m[9]*p.z+m[13];
  out.z=m[2]*p.x+m[6]*p.y+m[10]*p.z+m[14];
  return out;
 }
}
const c=Math.SQRT1_2;
const m=[2,0,0,0,0,3*c,3*c,0,0,-4*c,4*c,0,10,20,30,1];
const axes=[
 {x:m[0],y:m[1],z:m[2]},
 {x:m[4],y:m[5],z:m[6]},
 {x:m[8],y:m[9],z:m[10]},
];
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const det=dot(axes[0],cross(axes[1],axes[2]));
const localOf=p=>{
 const q={x:p.x-10,y:p.y-20,z:p.z-30};
 return {
  x:dot(q,cross(axes[1],axes[2]))/det,
  y:dot(q,cross(axes[2],axes[0]))/det,
  z:dot(q,cross(axes[0],axes[1]))/det,
 };
};
const ref={
 isValid:true,worldMatrix:m,
 inverseTransformPoint(out,p){Object.assign(out,localOf(p));return out;},
};
const child={
 isValid:true,
 worldMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,100,200,300,1],
 inverseTransformPoint(out,p){Object.assign(out,{x:p.x-100,y:p.y-200,z:p.z-300});return out;},
};
const viewport=load('GizmoViewportGeometry',{
 cc:{Vec3,RenderRoot2D:class {}},
 './MoveScreenScale':{moveWorldPerPixel:()=>.25},
 './SceneCameraBridge':{resolveSceneCamera:()=>({camera:null})},
 './PlaneHandleGeometry':{planeHandleGeometry:()=>null},
 './AxisHandleGeometry':{axisHandleGeometry:()=>null},
 './MoveHitGeometry':{boundsOf:()=>null},
 './RotationHandleGeometry':{rotateBasis:()=>null,rotationRingGeometry:()=>null,ROTATE_IDENTITY:{}},
 './SceneGizmoInput':{},
});
const property={x:1,y:2,z:7};
const component={node:child,position:property};
const field={property:'position',visual:'axis',axis:'x',plane:'view',
 space:'local',frameNode:ref};
const actual=viewport.spaceFor(component,field);
const world=actual.toWorld(property),roundTrip=actual.toLocal(world);
const eq=(a,b)=>assert(Math.abs(a-b)<1e-8,String(a)+' != '+String(b));
for(const axis of ['x','y','z'])eq(roundTrip[axis],property[axis]);
assert.equal(world.x,12);
assert(world.y<30,'Container tilted XY changes the World Z and Y basis');
assert.notEqual(world.x,101,'The child Node transform must NOT control the handle');
for(const axis of ['x','y','z'])eq(viewport.handleWorldOrigin(component,field,property)[axis],world[axis]);
const xAxis=actual.toWorld({x:2,y:2,z:7});
eq(xAxis.x-world.x,2);
eq(xAxis.y-world.y,0);
eq(xAxis.z-world.z,0);
const yAxis=actual.toWorld({x:1,y:3,z:7});
eq(yAxis.y-world.y,3*c);
eq(yAxis.z-world.z,3*c);
const untouched=viewport.spaceFor(component,{...field,frameNode:undefined});
assert.equal(untouched.toWorld(property).x,101,'Without a frame, retain node-local behavior');
const global=viewport.spaceFor(component,{...field,space:'world'});
assert.equal(global.toWorld(property).x,1,'World handles ignore reference frame');
ref.isValid=false;
assert(Number.isNaN(viewport.spaceFor(component,field).toWorld(property).x),
 'Invalid reference frame must not produce draggable geometry');
ref.isValid=true;
const preset=load('GizmoHandlePresets');
const handles=preset.makeMoveGizmo('position',{frameNode:ref,space:'local'});
assert.equal(handles.length,6);
assert(handles.every(h=>h.frameNode===ref));
assert(handles.every(h=>h.space==='local'));
const xy=preset.makeMoveGizmo2D('position',{frameNode:ref,space:'local'});
assert.deepEqual(Array.from(xy,x=>x.axis||x.plane),['x','y','xy']);
console.log('MOVE FRAME NODE PASS: owner-independent local axes, tilted/scaled frame, roundtrip, world mode, invalid node and 2D presets.');
