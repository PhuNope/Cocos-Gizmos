import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const code=ts.transpileModule(readFileSync(
    new URL('../source/SceneViewportInput.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017},
}).outputText;
const appearanceCode=ts.transpileModule(readFileSync(
    new URL('../source/SceneSelectionLease.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017},
}).outputText;
const appearance={exports:{}};vm.runInNewContext(appearanceCode,appearance);
const scope={exports:{},require(id){
    if(id==='./SceneSelectionLease')return appearance.exports;
    throw Error(id);
}};
vm.runInNewContext(code,scope);
const {SceneViewportInput}=scope.exports;

class Document {
    constructor(pointerEvents=true){
        this.defaultView={PointerEvent:pointerEvents?function PointerEvent(){}:undefined};
        this.handlers=new Map();
        this.canvas={
            getBoundingClientRect:()=>({
                left:20,top:40,right:820,bottom:440,width:800,height:400,
            }),
            capture:[],
            setPointerCapture(id){this.capture.push(['set',id]);},
            releasePointerCapture(id){this.capture.push(['release',id]);},
        };
    }
    getElementById(name){return name==='GameCanvas'?this.canvas:null;}
    addEventListener(name,fn,capture){
        assert.equal(capture,true);
        const list=this.handlers.get(name)||[];list.push(fn);this.handlers.set(name,list);
    }
    removeEventListener(name,fn,capture){
        assert.equal(capture,true);
        this.handlers.set(name,(this.handlers.get(name)||[]).filter(x=>x!==fn));
    }
    emit(type,more={}){
        const event={
            clientX:120,clientY:340,pointerId:1,button:0,buttons:1,
            isPrimary:true,
            stopImmediatePropagation(){event.stopped=true;},
            preventDefault(){event.prevented=true;},
            ...more,
        };
        for(const cb of this.handlers.get(type)||[])cb(event);
        return event;
    }
}
const doc=new Document();
const events=[];
let downCount=0;
const ports={
    viewport(){return {width:1600,height:800};},
    down(p){downCount++;events.push(['down',p.x,p.y]);return p.x>=180&&p.x<=240&&p.y>=180&&p.y<=240;},
    move(p){events.push(['drag',p.x,p.y]);},
    hover(p){events.push(['hover',p.x,p.y]);},
    up(p){events.push(['up',p.x,p.y]);},
    cancel(){events.push(['cancel']);},
};
const bridge=new SceneViewportInput(ports,()=>doc);
bridge.refresh();
bridge.refresh();
assert.equal((doc.handlers.get('pointerdown')||[]).length,1,'Re-mount must reuse capture listeners');
assert.equal(bridge.status().reason,'pointer-capture');
const htmlControl=doc.emit('pointerdown',{target:{
    closest(selector){
        assert.equal(selector,'#cocos-gizmos-scene-hud');
        return {};
    },
}});
assert.equal(htmlControl.stopped,undefined,
    'Floating DOM HUD, not WebView fallback, owns its pointerdown');
assert.equal(bridge.status().intercepted,0,
    'DOM click must never start a second Scene input command');
const missed=doc.emit('pointerdown',{clientX:450});
assert.equal(missed.stopped,undefined,'Normal Scene selection must be untouched');
assert.equal(bridge.status().intercepted,0);
const right=doc.emit('pointerdown',{button:2});
assert.equal(right.stopped,undefined,'Right orbit must remain a native event');
assert.equal(downCount,1,'Only primary pointer is eligible');
const hovered=doc.emit('pointermove');
assert.equal(hovered.stopped,undefined);
assert.ok(events.some(e=>e[0]==='hover'&&e[1]===200&&e[2]===200));
const pressed=doc.emit('pointerdown');
assert.equal(pressed.stopped,true);
assert.equal(pressed.prevented,true);
assert.deepEqual(doc.canvas.capture[0],['set',1]);
assert.equal(bridge.status().captured,true);
const moving=doc.emit('pointermove',{clientX:180,clientY:300});
assert.equal(moving.stopped,true);
assert.deepEqual(events.at(-1),['drag',320,280]);
const released=doc.emit('pointerup',{clientX:180,clientY:300});
assert.equal(released.stopped,true);
assert.deepEqual(events.at(-1),['up',320,280]);
assert.deepEqual(doc.canvas.capture.at(-1),['release',1]);
assert.equal(bridge.status().captured,false);
assert.equal(bridge.status().intercepted,1);
const pressedAgain=doc.emit('pointerdown');
assert.equal(pressedAgain.stopped,true);
doc.emit('pointercancel');
assert.deepEqual(events.at(-1),['cancel']);
assert.equal(bridge.status().captured,false);
bridge.detach();
assert.equal(doc.handlers.get('pointerdown').length,0);
const previousEvents=events.length;
doc.emit('pointerdown');
assert.equal(events.length,previousEvents,'Disposed adapter cannot capture Scene events');

const mouseDoc=new Document(false);
const fallback=new SceneViewportInput(ports,()=>mouseDoc);
fallback.refresh();
assert.equal(fallback.status().reason,'mouse-capture');
assert.ok(mouseDoc.handlers.get('mousedown')?.length);
assert.equal(mouseDoc.emit('mousedown').stopped,true);
assert.equal(mouseDoc.emit('mousemove').stopped,true);
assert.equal(mouseDoc.emit('mouseup').stopped,true);
fallback.detach();
// In the real Creator WebView, register on window capture instead of the
// document. Window listeners run before Editor listeners on document/canvas.
const windowDoc=new Document();
const windowHandlers=new Map();
windowDoc.defaultView={
    PointerEvent:function PointerEvent(){},
    addEventListener(name,fn,capture){
        assert.equal(capture,true);
        const list=windowHandlers.get(name)||[];
        list.push(fn);windowHandlers.set(name,list);
    },
    removeEventListener(name,fn,capture){
        assert.equal(capture,true);
        windowHandlers.set(name,(windowHandlers.get(name)||[]).filter(x=>x!==fn));
    },
};
const windowBridge=new SceneViewportInput(ports,()=>windowDoc);
windowBridge.refresh();
assert.equal(windowDoc.handlers.size,0,
    'DOM capture must run before document-level Editor selection handlers');
assert.equal(windowHandlers.get('pointerdown')?.length,1);
const windowEvent={clientX:120,clientY:340,pointerId:5,
    button:0,buttons:1,isPrimary:true,
    stopImmediatePropagation(){this.stopped=true;},
    preventDefault(){this.prevented=true;}};
windowHandlers.get('pointerdown')[0](windowEvent);
assert.equal(windowEvent.stopped,true);
windowHandlers.get('pointerup')[0]({...windowEvent});
windowBridge.detach();
assert.equal(windowHandlers.get('pointerdown').length,0);

const missing=new SceneViewportInput(ports,()=>null);
missing.refresh();
assert.equal(missing.status().active,false);
assert.equal(missing.status().reason,'scene-webview-dom-unavailable');

console.log('[scene-viewport-input] 2D/3D DOM capture, inverted coordinates, hover, drag, click, cancel, native misses and cleanup OK');
