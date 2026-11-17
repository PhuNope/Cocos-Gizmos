import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const source=readFileSync(new URL('../source/GizmoHitTest.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,
}}).outputText;

const component={node:{isValid:true}};
const world=p=>({...p});
const targets=[
    {key:'axis',field:{visual:'axis',property:'v',pickSize:14}},
    {key:'plane',field:{visual:'plane',property:'v',pickSize:14}},
    {key:'point',field:{visual:'point',property:'v',pickSize:12}},
];
const rectangle={left:40,right:80,bottom:40,top:80};
const view={
    worldToScreen(){},node:{forward:{x:0,y:0,z:1}},
    sync(){this.syncs=(this.syncs||0)+1;},
};
const scope={exports:{},require(name){
    if(name==='./GizmoViewportGeometry')return {
        camera(){return view;},
        readField(){return {x:60,y:60,z:0};},
        handleWorldOrigin(c,f,value){return world(value);},
        validPoint(p){return p && Number.isFinite(p.x) &&
            Number.isFinite(p.y) && Number.isFinite(p.z);},
        projectMovePoint(v,point){return {x:point.x,y:point.y};},
        projectedMoveGeometry(c,field){
            if(field.visual==='axis')return {
                type:'axis',rect:rectangle,axis:{
                    start:{x:30,y:60},end:{x:90,y:60},
                },
            };
            if(field.visual==='plane')return {
                type:'plane',rect:rectangle,corners:[
                    {x:45,y:45},{x:75,y:45},{x:75,y:75},{x:45,y:75},
                ],
            };
            if(field.visual==='rotation')return {
                type:'rotation',rect:{left:15,right:105,bottom:15,top:105},
                ring:[{x:100,y:60},{x:60,y:100},{x:20,y:60},{x:60,y:20}],
            };
            return null;
        },
        markerSize(){return 22;},
        rotationPlacement(){return {
            normal:{x:0,y:0,z:1},
        };},
    };
    if(name==='./RotationHandleGeometry')return {
        rotationRingDistanceSquared(pointer) {
            return Math.abs(pointer.x-100)<4 && Math.abs(pointer.y-60)<4 ?
                2:Number.POSITIVE_INFINITY;
        },
    };
    if(name==='./MoveHitGeometry')return {
        centerDistanceSquared(p,r) {
            return (p.x-(r.left+r.right)/2)**2+(p.y-(r.top+r.bottom)/2)**2;
        },
        distanceToSegmentSquared(p,a,b) {
            const dx=b.x-a.x,dy=b.y-a.y;
            const t=Math.max(0,Math.min(1,
                ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
            return (p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
        },
        insideProjectedPlane(p,corners) {
            return p.x>=corners[0].x&&p.x<=corners[2].x&&
                p.y>=corners[0].y&&p.y<=corners[2].y;
        },
        rectContains(p,r) {
            return p.x>=r.left&&p.x<=r.right&&
                p.y>=r.bottom&&p.y<=r.top;
        },
    };
    if(name==='./GizmoHudControls')return {
        hudControlScreenRect(v,index,count,size) {
            const width=typeof size==='object'?size.width:130;
            return {left:20,right:20+width,bottom:50,top:72,
                width,height:22};
        },
    };
    throw Error('Unexpected import '+name);
}};
vm.runInNewContext(compiled,scope);
const {hitTestHandle,hitTestHud}=scope.exports;
assert.equal(hitTestHandle(component,targets,{x:60,y:60},view)?.key,'plane',
    'Plane region has priority when overlapping an axis and point');
assert.equal(hitTestHandle(component,targets,{x:88,y:60},view)?.key,'axis',
    'Axis shaft remains pickable outside the plane');
assert.equal(hitTestHandle(component,[targets[2]],{x:60,y:60},view)?.key,
    'point','Standalone point remains editable');
assert.equal(hitTestHandle(component,targets,{x:-200,y:-100},view),null);
assert.equal(hitTestHandle(component,targets,{x:NaN,y:50},view),null);
assert.equal(hitTestHandle({node:{isValid:false}},targets,{x:60,y:60},view),null);

const ring={key:'ring',field:{visual:'rotation',property:'euler',pickSize:14,ringSize:72}};
assert.equal(hitTestHandle(component,[ring],{x:100,y:60},view)?.key,'ring',
    'Projected rotation stroke is pickable');
assert.equal(hitTestHandle(component,[ring],{x:60,y:60},view),null,
    'Rotation ring has a dead center for object selection');
assert.equal(hitTestHandle(component,[ring,targets[1]],{x:60,y:60},view)?.key,'plane',
    'Plane remains selectable through rotation center');

const hud=[{key:'wide',index:0,control:{size:{width:200,height:22}}},
    {key:'narrow',index:1,control:{size:{width:65,height:22}}}];
const placement={startRow:0,textCount:0};
assert.equal(hitTestHud({x:190,y:60},{width:400,height:300},placement,
    hud,2)?.key,'wide');
assert.equal(hitTestHud({x:230,y:60},{width:400,height:300},placement,
    hud,2),null);
assert.equal(hitTestHud({x:NaN,y:60},{width:400,height:300},placement,
    hud,2),null);
assert.ok(view.syncs>=2,'Viewport projection is synced before screen-space picking');
console.log('[gizmo-hit-test-v3] priority, plane, axis, ring, center exclusion, HUD sizing and invalid-pointer guards OK');
