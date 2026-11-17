import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const code=ts.transpileModule(readFileSync(
    new URL('../source/SceneEngineInput.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017},
}).outputText;
const emitter={
    handlers:new Map(),
    on(name,handler) {
        const list=this.handlers.get(name)||[];
        list.push(handler);this.handlers.set(name,list);
    },
    off(name,handler) {
        this.handlers.set(name,(this.handlers.get(name)||[]).filter(fn=>fn!==handler));
    },
    emit(name,fields={}) {
        const event={x:120,y:80,button:0,
            stopImmediatePropagation(){this.stopped=true;},
            preventDefault(){this.prevented=true;},
            ...fields};
        for(const handler of this.handlers.get(name)||[])handler(event);
        return event;
    },
};
const inputTypes={MOUSE_DOWN:'mouse-down',MOUSE_MOVE:'mouse-move',MOUSE_UP:'mouse-up'};
const scope={exports:{},require(id) {
    if(id==='cc')return {Input:{EventType:inputTypes},input:emitter};
    if(id==='./SceneGizmoInput')return {
        readScenePointer(e){return Number.isFinite(e?.x)&&Number.isFinite(e?.y)?
            {x:e.x,y:e.y}:null;},
        isPrimaryScenePointer(e){return e?.button===0;},
    };
    if(id==='./SceneSelectionLease')return {
        consumeOwnedSceneEvent(e){e.stopImmediatePropagation?.();e.preventDefault?.();}
    };
    throw Error(id);
}};
vm.runInNewContext(code,scope);
const {SceneEngineInput}=scope.exports;
const events=[];
const ports={
    viewport(){return {width:800,height:600};},
    down(e){events.push(['down',e.x,e.y]);return e.x>=100&&e.x<=160;},
    move(e){events.push(['move',e.x,e.y]);},
    hover(e){events.push(['hover',e.x,e.y]);},
    up(e){events.push(['up',e.x,e.y]);},
    cancel(){events.push(['cancel']);},
};
const bridge=new SceneEngineInput(ports);
bridge.refresh(true);bridge.refresh(true);
assert.equal(bridge.status().active,true);
assert.equal(emitter.handlers.get('mouse-down').length,1,
    'Repeated Scene refresh must not attach duplicate engine callbacks');
assert.equal(emitter.emit('mouse-move').stopped,undefined);
assert.equal(events.at(-1)[0],'hover');
assert.equal(emitter.emit('mouse-down',{x:250}).stopped,undefined,
    'Clicks outside our HUD/handle remain with native Scene selection');
assert.equal(emitter.emit('mouse-down',{button:2}).stopped,undefined,
    'Right-button orbit must remain with Editor');
const down=emitter.emit('mouse-down');
assert.equal(down.stopped,true);
assert.equal(down.prevented,true);
assert.equal(bridge.status().captured,true);
assert.equal(emitter.emit('mouse-move',{x:150}).stopped,true);
assert.deepEqual(events.at(-1),['move',150,80]);
assert.equal(emitter.emit('mouse-up',{x:150}).stopped,true);
assert.equal(bridge.status().captured,false);
assert.deepEqual(events.at(-1),['up',150,80]);
emitter.emit('mouse-down');
bridge.refresh(false);
assert.equal(events.at(-1)[0],'cancel');
assert.equal(bridge.status().reason,'webview-pointer-preferred');
assert.equal(emitter.handlers.get('mouse-down').length,0);
const previous=events.length;
emitter.emit('mouse-down');
assert.equal(events.length,previous);
console.log('[scene-engine-input] native Cocos fallback: hover, click, multi-frame drag, native misses and lifecycle OK');
