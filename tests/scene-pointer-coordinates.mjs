import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const options={target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS};
const inputScope={exports:{}};
vm.runInNewContext(ts.transpileModule(
    readFileSync(new URL('../source/SceneGizmoInput.ts',import.meta.url),'utf8'),
    {compilerOptions:options}).outputText,inputScope);
const source=ts.transpileModule(readFileSync(
    new URL('../source/ScenePointerCoordinates.ts',import.meta.url),'utf8'),
    {compilerOptions:options}).outputText;
const scope={exports:{},globalThis:{},require(name){
    if(name==='./SceneGizmoInput')return inputScope.exports;
    throw Error(name);
}};
vm.runInNewContext(source,scope);
const {sceneEventToViewport}=scope.exports;
const rect={left:20,top:40,right:420,bottom:340,width:400,height:300};
const doc={getElementById(id) {
    return id==='GameCanvas'?{getBoundingClientRect:()=>rect}:null;
}};
const viewport={width:800,height:600};
// Browser and Editor Operation x/y can be in DIFFERENT coordinate systems.
// The browser's measured canvas position is authoritative for rendering.
const p={clientX:120,clientY:265,x:1600,y:1200};
const r=sceneEventToViewport(p,viewport,doc);
assert.equal(r.source,'canvas-client');
assert.equal(r.pointer.x,200);
assert.equal(r.pointer.y,150,'CSS top-left Y is converted to bottom-left');
assert.equal(sceneEventToViewport({clientX:20,clientY:340,x:999,y:999},
    viewport,doc).pointer.y,0);
assert.equal(sceneEventToViewport({clientX:420,clientY:40,x:999,y:999},
    viewport,doc).pointer.x,800);
assert.equal(sceneEventToViewport({clientX:420,clientY:40,x:999,y:999},
    viewport,doc).pointer.y,600);
const scaling=sceneEventToViewport(p,{width:1200,height:900},doc);
assert.equal(scaling.pointer.x,300,'DPR and Editor zoom use viewport scaling');
assert.equal(scaling.pointer.y,225);
const unavailable=sceneEventToViewport({x:45,y:95},viewport,doc);
assert.equal(unavailable.source,'editor-xy');
assert.equal(unavailable.pointer.x,45);
assert.equal(unavailable.pointer.y,95);
const foreign=sceneEventToViewport({clientX:10000,clientY:10000,x:45,y:95},
    viewport,doc);
assert.equal(foreign.source,'editor-xy',
    'Do not use unrelated window client coordinates for Scene picking');
assert.equal(sceneEventToViewport({clientX:120,clientY:265},viewport,null).pointer,null);
assert.equal(sceneEventToViewport({x:NaN,y:Infinity},viewport,null).source,'missing');
assert.equal(sceneEventToViewport({x:45,y:95},null,doc).pointer.x,45);
console.log('[scene-pointer-coordinates] measured viewport, scroll offset, Y inversion, DPR and fallback OK');
