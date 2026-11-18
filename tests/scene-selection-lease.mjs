import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../source/SceneSelectionLease.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,
}}).outputText;
const scope={exports:{}};
vm.runInNewContext(code,scope);
const {SceneSelectionLease,consumeOwnedSceneEvent}=scope.exports;
const lease=new SceneSelectionLease();
assert.equal(lease.inspect(100),null);
lease.begin('selected-node');
assert.equal(lease.inspect(100).nodeUuid,'selected-node');
assert.equal(lease.inspect(100).active,true);
lease.release(1000);
assert.equal(lease.inspect(1249).nodeUuid,'selected-node');
assert.equal(lease.inspect(1249).active,false);
assert.equal(lease.inspect(1251),null,
    'Lease must expire so normal Scene selection remains possible');
lease.begin('old');
lease.begin('new');
assert.equal(lease.inspect(3000).nodeUuid,'new');
lease.clear();
assert.equal(lease.inspect(3000),null);

const calls=[];
const wrapper={
    stopPropagation(){calls.push('wrapper-stop');},
    preventDefault(){calls.push('wrapper-default');},
    propagationStopped:false,
    detail:{event:{
        stopImmediatePropagation(){calls.push('native-immediate');},
        preventDefault(){calls.push('native-default');},
    }},
};
consumeOwnedSceneEvent(wrapper);
assert.deepEqual(calls,[
    'wrapper-stop','wrapper-default','native-immediate','native-default',
]);
assert.equal(wrapper.propagationStopped,true);
assert.doesNotThrow(()=>consumeOwnedSceneEvent({nativeEvent:{
    stopImmediatePropagation(){throw new Error('read-only event');},
}}));
// 3D Editor Operation events may not include a DOM target: hit test the
// visible HUD panel only, never the transparent full-viewport overlay.
const {isSceneHudPointerEvent}=scope.exports;
const panel={style:{display:'flex'},getBoundingClientRect(){return {
    left:260,top:30,right:540,bottom:210,width:280,height:180,
};}};
const root={style:{display:'flex'},children:[panel]};
scope.document={getElementById(id){
    if(id==='cocos-gizmos-builder-hud')return root;
    if(id==='GameCanvas')return {getBoundingClientRect(){return {
        left:0,top:0,right:800,bottom:500,width:800,height:500,
    };}};
    return null;
}};
assert.equal(isSceneHudPointerEvent({clientX:300,clientY:80}),true,
    'HUD background must not unselect a Scene Node');
assert.equal(isSceneHudPointerEvent({clientX:100,clientY:80}),false,
    'Ordinary viewport clicks must still select Nodes');
assert.equal(isSceneHudPointerEvent({x:300,y:420},
    {x:300,y:420},{width:800,height:500}),true,
    'Targetless 3D Scene coordinates resolve to the HUD panel');
const {isSceneHudDomTarget}=scope.exports;
const browserHudTarget={closest:()=>root};
assert.equal(isSceneHudDomTarget({target:browserHudTarget}),true,
    'Actual HTML buttons must reach DOM event handlers');
assert.equal(isSceneHudDomTarget({clientX:300,clientY:80}),false,
    'Geometry alone does not prove there is a browser target');
scope.document.elementFromPoint=(x,y)=>x>=260&&x<=540&&y>=30&&y<=210?
    browserHudTarget:null;
assert.equal(isSceneHudDomTarget({clientX:300,clientY:80}),true,
    'Targetless 3D Operation event must preserve native DOM input by hit testing');
assert.equal(isSceneHudDomTarget({clientX:100,clientY:80}),false,
    'Actual Scene canvas event may still use geometric picking fallback');
scope.document.elementFromPoint=()=>null;
root.style.display='none';
assert.equal(isSceneHudPointerEvent({clientX:300,clientY:80}),false,
    'A hidden HUD must never block Scene selection');
delete scope.document;
console.log('[scene-selection-lease] focus lease, owned events and 3D HUD geometry guard OK');
