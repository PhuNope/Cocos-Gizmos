import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const options={target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS};
function transpile(path){
    return ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),
        {compilerOptions:options}).outputText;
}
const portScope={exports:{}};
vm.runInNewContext(transpile('../source/SceneGizmoInput.ts'),portScope);
const leaseScope={exports:{}};
vm.runInNewContext(transpile('../source/SceneSelectionLease.ts'),leaseScope);

const pointerScope={exports:{}};
const pointerGlobal={};
vm.runInNewContext(transpile('../source/ScenePointerCoordinates.ts'),{
    exports:pointerScope.exports,globalThis:pointerGlobal,
    require(name) {
        if(name==='./SceneGizmoInput')return portScope.exports;
        throw Error(name);
    },
});
const source=transpile('../source/SceneOperationInput.ts');
const scope={exports:{},console,require(name){
    if(name==='./SceneGizmoInput')return portScope.exports;
    if(name==='./SceneSelectionLease')return leaseScope.exports;
    if(name==='./ScenePointerCoordinates')return pointerScope.exports;
    throw Error('Unexpected import: '+name);
}};
vm.runInNewContext(source,scope);
const {SceneOperationInput,SCENE_GIZMO_INPUT_PRIORITY}=scope.exports;
assert.equal(SCENE_GIZMO_INPUT_PRIORITY,100,
    'Creator 3.8.8 OperationPriority.Gizmo=99, Camera=98');

class MockOperation{
    listeners=new Map();
    on(type,listener,priority=0){
        let list=this.listeners.get(type)||[];
        list.push({listener,priority});
        list.sort((a,b)=>b.priority-a.priority);
        this.listeners.set(type,list);
    }
    removeListener(type,listener){
        this.listeners.set(type,(this.listeners.get(type)||[])
            .filter(entry=>entry.listener!==listener));
    }
    emit(type,event){
        for(const {listener} of this.listeners.get(type)||[]){
            if(listener(event)===false)return false;
        }
    }
}
const op=new MockOperation();
const events=[];
const point={x:120,y:80,button:0,buttons:1,
    stopPropagation(){this.stopped=true;},
    preventDefault(){this.prevented=true;}};
let nativeSelection=0,nativeCamera=0;
op.on('mousedown',()=>{
    nativeSelection++;
    events.push(['native-selection']);
},99);
op.on('mousedown',()=>nativeCamera++,98);
let ownDown=0;
const ports={
    viewport(){return {width:800,height:500};},
    down(p){
        ownDown++;events.push(['begin',p.x,p.y]);
        return p.x>=100&&p.x<=150&&p.y>=60&&p.y<=100;
    },
    hover(p){events.push(['hover',p.x,p.y]);},
    move(p){events.push(['update',p.x,p.y]);},
    up(p){events.push(['end',p.x,p.y]);},
    cancel(){events.push(['cancel']);},
};
let currentOperation=op;
const input=new SceneOperationInput(ports,()=>currentOperation);
input.refresh();
input.refresh();
assert.equal(input.status().active,true);
assert.equal(input.status().priority,100);
assert.equal(op.listeners.get('mousedown').length,3,
    'Repeated updates cannot install duplicate Scene listeners');
op.emit('mousemove',{...point});
assert.deepEqual(events.at(-1),['hover',120,80]);
// Real Editor Operation x/y may differ from canvas-local pixels. Match the
// rendered viewport via clientX/clientY and the actual canvas rectangle.
pointerGlobal.document={getElementById(name){
    if(name!=='GameCanvas')return null;
    return {getBoundingClientRect:()=>({
        left:20,top:40,right:420,bottom:290,width:400,height:250,
    })};
}};
op.emit('mousemove',{...point,x:900,y:999,clientX:80,clientY:250});
assert.deepEqual(events.at(-1),['hover',120,80],
    'Hover is aligned to rendered handle, never raw Operation x/y');
assert.equal(input.status().pointerSource,'canvas-client');
delete pointerGlobal.document;

const domHudHit={closest(selector){
    assert.equal(selector,'#cocos-gizmos-scene-hud');return {};
}};
const handledBeforeDom=ownDown;
assert.equal(op.emit('mousedown',{...point,target:domHudHit}),false,
    'Browser floating HUD events cannot reach the native Scene picker');
assert.equal(ownDown,handledBeforeDom,
    'Native Operation must not begin a duplicate DOM HUD command');
assert.equal(nativeSelection,0);
assert.equal(op.emit('mousedown',{...point}),false);
assert.equal(nativeSelection,0,'HUD/handle click blocks native Node selection');
assert.equal(nativeCamera,0);
assert.equal(input.status().captured,true);
op.emit('mousemove',{...point,x:128});
op.emit('mousemove',{...point,x:138});
assert.deepEqual(events.slice(-2),[['update',128,80],['update',138,80]],
    'Held drag updates across multiple Scene frames');
assert.equal(events.filter(x=>x[0]==='cancel').length,0,
    'Native selection must not cancel a held slider');
assert.equal(op.emit('mouseup',{...point,x:142}),false);
assert.deepEqual(events.at(-1),['end',142,80]);
assert.equal(input.status().captured,false);
assert.equal(op.emit('mousedown',{...point,x:350}),undefined);
assert.equal(nativeSelection,1,'Clicks outside custom shapes still select normally');
assert.equal(nativeCamera,1);
assert.equal(op.emit('mousedown',{...point,button:2,buttons:2}),undefined);
assert.equal(nativeSelection,2,'Right-button operations remain Editor-owned');
assert.equal(op.emit('mousedown',{...point,x:125}),false);
assert.equal(op.emit('keydown',{key:'Escape',keyCode:27}),false);
assert.deepEqual(events.at(-1),['cancel']);
assert.equal(input.status().captured,false);
assert.equal(input.status().intercepted,2);
assert.equal(input.status().cancelled,1);

// Creator can briefly replace its Operation singleton between Scene
// callbacks. The already-captured dispatcher must finish the old gesture.
const cancelsBeforeSwitch=events.filter(e=>e[0]==='cancel').length;
assert.equal(op.emit('mousedown',{...point}),false);
currentOperation=null;
input.refresh();
assert.equal(input.status().reason,'operation-transition-deferred');
assert.equal(input.status().captured,true);
op.emit('mousemove',{...point,x:132});
assert.equal(op.emit('mouseup',{...point,x:136}),false);
assert.deepEqual(events.at(-1),['end',136,80]);
assert.equal(events.filter(e=>e[0]==='cancel').length,cancelsBeforeSwitch);
input.refresh();
assert.equal(input.status().active,false);
input.detach();
assert.equal(op.listeners.get('mousedown').length,2,
    'Unmount removes all extension listeners but leaves Editor listeners');
assert.equal(op.listeners.get('mousemove').length,0);
assert.equal(op.listeners.get('mouseup').length,0);
assert.equal(input.status().active,false);

const absent=new SceneOperationInput(ports,()=>null);
absent.refresh();
assert.equal(absent.status().reason,'scene-operation-unavailable');
assert.equal(absent.status().active,false);
console.log('[scene-operation-input] Creator 3.8.8 priority, hover, HUD ownership, multiframe drag, Escape and native passthrough OK');
