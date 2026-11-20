import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const source=readFileSync(new URL('../source/EditorHandleAdapterV3.ts',import.meta.url),'utf8');
const compilerOptions={target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS};
const js=ts.transpileModule(source,{compilerOptions}).outputText;
const operationJs=ts.transpileModule(readFileSync(
    new URL('../source/SceneOperationInput.ts',import.meta.url),'utf8'),
    {compilerOptions}).outputText;
const leaseJs=ts.transpileModule(readFileSync(
    new URL('../source/SceneSelectionLease.ts',import.meta.url),'utf8'),
    {compilerOptions}).outputText;
const leaseScope={exports:{}};
vm.runInNewContext(leaseJs,leaseScope);
const events=[],paints=[];
let bridgePort=null;
let bridgeMounts=0;
let bridgeDetaches=0;
let bridgeCaptured=false;
let editorRebuildsOnUpdate=false;
let editorRebuildsOnBegin=false;
const component={
    node:{uuid:'v3-target',isValid:true,activeInHierarchy:true},
    isValid:true,enabled:true, __classname__:'MyV3Component',
    position:{x:0,y:0,z:0},visible:true,radius:10,size:1,
    onGizmoHandles(){return [{property:'position',plane:'xy',visual:'point'}];},
    onGizmoHudControls(){return [
        {id:'visible',type:'checkbox',text:'Visible',
            property:'visible',color:'#ffffff',size:'normal'},
        {id:'radius',type:'slider',text:'Radius',property:'radius',
            min:0,max:100,step:1,color:'#ffffff',size:'normal'},
        {id:'reset',type:'button',text:'Reset',color:'#ffffff',size:'normal'},
        {id:'size',type:'slider',text:'ShapeSize',property:'size',
            min:0.1,max:5,step:0.1,color:'#ffffff',size:'normal'},
    ];},
    onGizmoHudAction(id){events.push(['button',id]);},
    onGizmoChanged(...args){events.push(['handle',...args]);},
    onGizmoHudChanged(...args){events.push(['hud',...args]);},
};
class SelectGizmo {
    constructor(target){this.target=target;}
    show(){this.onShow?.();}
    hide(){this.onHide?.();}
    destroy(){this.onDestroy?.();}
    getCompPropPath(name){return 'serialized.'+name;}
    onControlBegin(name){
        events.push(['begin',name]);
        if(editorRebuildsOnBegin){this.hide();this.destroy();}
    }
    onControlUpdate(name){
        events.push(['update',name]);
        if(editorRebuildsOnUpdate){this.hide();this.destroy();}
    }
    onControlEnd(name){events.push(['end',name]);}
    onComponentChanged(node){events.push(['node',node.uuid]);}
}
class BuiltInCameraGizmo extends SelectGizmo {}
const typeDefs={'cc.Camera':BuiltInCameraGizmo};
const manager={
    _gizmoPool:{_getPool(name) {assert.equal(name,'component');return {typeDefs};}},
    showComponentGizmo(c){
        const Type=typeDefs[c.__classname__];
        if(!Type)return;
        if(!c.gizmo){
            c.gizmo=new Type(c);
            c.gizmo.init();
        }
    },
    createGizmo(name,c){const Type=typeDefs[name];if(!Type)return null;
        c.gizmo=new Type(c);c.gizmo.init();return c.gizmo;},
};
const cce={Gizmo:manager,Engine:{repaintInEditMode(){}}};
const scope={
    exports:{}, console, globalThis:{cce},
    require(name){
        if(name==='cc')return {Component:class {}};
        if(name==='./GizmoViewportGeometry')return {
            camera(){return {viewport:{width:900,height:500}};},
            validPoint(p){return p&&['x','y','z'].every(k=>Number.isFinite(p[k]));},
            sceneRay(p){return {o:{x:p.x,y:p.y,z:10},d:{x:0,y:0,z:-1}};},
            spaceFor(){return {toWorld:p=>p,toLocal:p=>p};},
            readField(c,f){return c[f.property];},
            writeField(c,f,v){c[f.property]={...v};return true;},
            handleWorldOrigin(c,f,p){return p;},
            markerSize(){return 22;},
            axisPlacement(){return null;},
            rotationPlacement(){return null;},
            rotationFrame(){return {x:0,y:0,z:0,w:1};},
            isCanvas2D(){return false;},
        };
        if(name==='./GizmoHandleRenderer')return {
            drawSelectedPositionMarkers(c){paints.push(c);},
            setSelectedHandleHover(c,k){events.push(['hover',k]);},
        };
        if(name==='./GizmoHitTest')return {
            hitTestHandle(c,items,point){
                return point.x>=50&&point.x<200 ? items[0]||null:null;
            },
            hitTestHud(p,viewport,place,items){
                if(p.x>=860&&p.x<=895)return items[3]||null;
                if(p.x>=700&&p.x<=850)return items[2]||null;
                if(p.x>=420&&p.x<=600)return items[1]||null;
                return p.x>=200&&p.x<=400?items[0]||null:null;
            },
        };
        if(name==='./PositionDragSolver')return {handlePlaneNormal(){
            return {x:0,y:0,z:1};}};
        if(name==='./AxisHandleGeometry')return {axisDragNormal(){
            return {x:0,y:0,z:1};}};
        if(name==='./GizmoCommandBuilder')return {GizmoCommands:{
            move() {
                const args={};
                return {
                    initial(v){args.initial=v;return this;},
                    space(v){args.space=v;return this;},
                    planeNormal(v){args.normal=v;return this;},
                    constraints(v){args.options=v;return this;},
                    value(v){args.port=v;return this;},
                    hooks(v){args.hooks=v;return this;},
                    build(){
                        events.push(['builder','move']);
                        const Type=scope.require('./GizmoMoveCommand').GizmoMoveCommand;
                        return new Type(args.initial,args.space,args.normal,
                            args.options,args.port,args.hooks);
                    },
                };
            },
            rotate(){throw new Error('rotation stub not expected for point handle');},
        }};
        if(name==='./GizmoMoveCommand')return {GizmoMoveCommand:class {
            constructor(value,space,normal,options,port,hooks){
                this.start={...value};this.port=port;this.hooks=hooks;
            }
            begin(){this.hooks.begin(this.start);return true;}
            update(ray){this.port.write({x:ray.o.x,y:ray.o.y,z:0});
                this.hooks.update(this.port.read());return true;}
            end(){this.hooks.end(this.port.read(),false,true);}
            cancel(){this.port.write(this.start);this.hooks.rollback();
                this.hooks.end(this.start,true,false);}
        }};
        if(name==='./GizmoRotateCommand')return {GizmoRotateCommand:class {}};
        if(name==='./RotationHandleGeometry')return {};
        if(name==='./GizmoEditSession')return {GizmoEditSession:class {
            constructor(read,write,hooks){Object.assign(this,{read,write,hooks});
                this.start=read();}
            begin(){this.hooks.begin(this.start);}
            apply(value){this.write(value);this.hooks.update(value);}
            finish(cancelled=false){
                if(cancelled){this.write(this.start);this.hooks.rollback();}
                this.hooks.end(this.read(),cancelled,this.read()!==this.start);
            }
        }};
        if(name==='./GizmoHudControls')return {
            hudControlScreenRect(_viewport,index,_count,size) {
                const left=index===0?200:index===1?420:index===2?700:860;
                return {left,right:left+190,top:92,bottom:68,width:190,height:24};
            },
            normalizeHudControls(){return component.onGizmoHudControls();},
            hudSliderScreenTrack(){return {left:400,width:100};},
            HudSliderDrag:class {
                constructor(control,value,startX) {
                    this.value=value;this.startX=startX;this.base=control.min;
                    this.control=control;
                }
                move(x){
                    const base=this.control.id==='size'?870:400;
                    return Math.max(this.control.min,
                        Math.min(this.control.max,x-base));
                }
            },
        };
        if(name==='./SceneGizmoInput')return {
            GizmoInputDiagnostics:class {
                record(name){events.push(['input',name]);}
                snapshot(){return {gizmoDown:0,controllerDown:0};}
            },
            readScenePointer(e){return Number.isFinite(e?.x)&&Number.isFinite(e?.y) ?
                {x:e.x,y:e.y}:null;},
            isPrimaryScenePointer(e){return e?.button===undefined||e.button===0;},
            readSceneHandleName(e){return e?.handleName||null;},
        };
        if(name==='./SceneHudElement')return {
            connectSceneHudInput(port) {
                events.push(['dom-hud-connected',!!port]);
                return () => events.push(['dom-hud-disconnected']);
            },
        };
        if(name==='./SceneSelectionLease')return leaseScope.exports;
        if(name==='./ScenePointerCoordinates')return {
            sceneEventToViewport(event) {
                const pointer=scope.require('./SceneGizmoInput').readScenePointer(event);
                return {pointer,source:pointer?'editor-xy':'missing'};
            },
        };
        if(name==='./SceneViewportInput')return {SceneViewportInput:class {
            constructor(ports){
                this.ports=ports;
                bridgePort={
                    ...ports,
                    down(event) {
                        const acquired=ports.down(event);
                        if(acquired)bridgeCaptured=true;
                        return acquired;
                    },
                    up(event) {
                        try{return ports.up(event);}
                        finally{bridgeCaptured=false;}
                    },
                    cancel() {
                        try{return ports.cancel();}
                        finally{bridgeCaptured=false;}
                    },
                };
            }
            refresh(){bridgeMounts++;}
            detach(){
                bridgeDetaches++;
                if(bridgeCaptured)bridgePort.cancel();
            }
            status(){return {active:true,reason:'mock-pointer-capture',
                captured:bridgeCaptured,
                observed:0,intercepted:0,hover:0,cancelled:0};}
        }};
        if(name==='./SceneEngineInput')return {SceneEngineInput:class {
            refresh(enabled){events.push(['engine-fallback-enabled',enabled]);}
            detach(){}
            status(){return {active:false,reason:'webview-pointer-preferred',
                captured:false,observed:0,intercepted:0,hover:0};}
        }};
        if(name==='./SceneOperationInput') {
            const module={exports:{}};
            vm.runInNewContext(operationJs,{
                exports:module.exports,console,globalThis:scope.globalThis,
                require(name){return scope.require(name);},
            },{filename:'SceneOperationInput.js'});
            return module.exports;
        }
        if(name==='./ExecuteGizmos')return {tickOnce(){paints.push('tick');}};
        throw Error(name);
    },
};
vm.runInNewContext(js,scope,{filename:'EditorHandleAdapterV3.js'});
const {resolveSelectGizmo,createV3HandleAdapter}=scope.exports;
assert.equal(resolveSelectGizmo(typeDefs),SelectGizmo);
assert.equal(resolveSelectGizmo({Fake:class {}}),null);
const placement={startRow:0,textCount:0,
    controls:component.onGizmoHudControls()};
const layout={get(){return placement;},totalRows:1};
const adapter=createV3HandleAdapter(()=>true,layout);
adapter.refresh([component],new Set(['v3-target']),100);
assert.ok(component.gizmo instanceof SelectGizmo);
assert.ok(!(component.gizmo instanceof BuiltInCameraGizmo),
    'Standalone adapter derives from SelectGizmo, not a built-in component');
assert.equal(typeof typeDefs.MyV3Component,'function');
assert.equal(typeDefs.Object,undefined,'Generic Object must never own the native Gizmo pool');
assert.equal(typeDefs['cc.Object'],undefined);

assert.equal(adapter.status().reason,'ready-select-gizmo');
assert.ok(bridgePort && bridgeMounts>0,'Scene WebView bridge must be installed');
assert.equal(adapter.status().viewportInput.active,true);
assert.ok(events.some(e=>e[0]==='engine-fallback-enabled'&&e[1]===false),
    'Native Cocos mouse fallback must not duplicate active WebView capture');
assert.equal(adapter.status().positionHandles,1);
assert.equal(adapter.status().hudControls,4);
assert.ok(paints.includes(component),'2D/3D rendering is a separate port');
const domHoverBefore=events.length;
bridgePort.hover({x:80,y:80,button:0,buttons:0});
assert.ok(events.slice(domHoverBefore).some(e=>e[0]==='hover'&&
    e[1]==='position:position:single'),
    'Direct Scene viewport hover must work with no native raycast handle');
bridgePort.hover({x:650,y:80,button:0,buttons:0});
assert.equal(events.at(-1)[0],'hover');
assert.equal(events.at(-1)[1],null,'Direct Scene hover clears outside the handle');
assert.equal(bridgePort.down({x:80,y:80,button:0,buttons:1}),true);
bridgePort.move({x:95,y:80,button:0,buttons:1});
assert.equal(component.position.x,95,
    'Viewport capture must drive the same MoveCommand as native callbacks');
bridgePort.up({x:95,y:80,button:0,buttons:0});
assert.equal(adapter.status().draggingPosition,0);
assert.equal(bridgePort.down({x:650,y:250,button:0,buttons:1}),false,
    'Unrelated Scene clicks remain native selection events');
const domHudButtonCount=events.filter(e=>e[0]==='button').length;
assert.equal(bridgePort.down({x:740,y:80,button:0,buttons:1}),true,
    'HUD Buttons must be captured without BoxController raycast meshes');
bridgePort.up({x:740,y:80,button:0,buttons:0});
assert.equal(events.filter(e=>e[0]==='button').length,domHudButtonCount+1);

// Native Gizmo rays may win when hovering over a Move handle. They must
// still update our presentation highlight, without consuming Editor input.
const hoverBefore=events.filter(e=>e[0]==='hover').length;
assert.equal(component.gizmo.onGizmoMouseMove({x:80,y:80}),undefined);
assert.ok(events.slice(hoverBefore).some(e=>e[0]==='hover'&&
    e[1]==='position:position:single'),
    'Move hover is updated on the native gizmo-move route');
assert.equal(component.gizmo.onGizmoMouseMove({x:650,y:250}),undefined);
assert.equal(events.at(-1)[0],'hover');
assert.equal(events.at(-1)[1],null,'Hover clears when leaving the handle');

assert.equal(component.gizmo.onGizmoMouseDown(
    {x:80,y:80,handleName:'transform:move:x'}),undefined,
    'Other native transform hit is never consumed');
assert.equal(adapter.status().draggingPosition,0,
    'Native transform gizmo must retain ownership of its own pointer-down');
component.gizmo.onGizmoMouseDown({x:80,y:80});
assert.equal(adapter.status().draggingPosition,0,
    'Unnamed native raycast event must not hijack Creator selection');
assert.equal(component.gizmo.onNotGizmoMouseDown({x:80,y:80}),false,
    'Native Scene selection should be informed when a custom handle owns the gesture');
assert.equal(adapter.status().draggingPosition,1);
assert.equal(component.gizmo.onNotGizmoMouseMove({x:90,y:80}),false);
assert.equal(component.position.x,90);
assert.equal(component.gizmo.onNotGizmoMouseUp({x:90,y:80}),false);
assert.equal(adapter.status().draggingPosition,0);
assert.equal(component.gizmo.onNotGizmoMouseDown({x:650,y:250}),undefined,
    'Ordinary Scene clicks must remain available for Node selection');
assert.ok(events.some(e=>e[0]==='handle'&&e[2]==='end'));
assert.ok(events.some(e=>e[0]==='begin'&&e[1]==='serialized.position'));
assert.ok(events.some(e=>e[0]==='update'&&e[1]==='serialized.position'));
assert.ok(events.some(e=>e[0]==='end'&&e[1]==='serialized.position'),
    'Native Undo hooks receive the SelectGizmo serialized Component path');
assert.ok(events.some(e=>e[0]==='builder'&&e[1]==='move'),
    'The v3 adapter constructs domain commands through the fluent Builder');
 // A computed/derived property may be committed by a domain-specific
 // serialized transaction. Its declared external history must never trigger
 // native SelectGizmo history hooks (otherwise it generates an extra Undo).
 const oldFields=component.onGizmoHandles;
 component.onGizmoHandles=()=>[{property:'position',plane:'xy',visual:'point',
     history:'external'}];
 adapter.refresh([component],new Set(['v3-target']),510);
 const hooksBefore=events.filter(e=>['begin','update','end','node'].includes(e[0])).length;
 const phasesBefore=events.filter(e=>e[0]==='handle').length;
 component.gizmo.onNotGizmoMouseDown({x:90,y:80});
 component.gizmo.onNotGizmoMouseMove({x:100,y:80});
 component.gizmo.onNotGizmoMouseUp({x:100,y:80});
 assert.equal(events.filter(e=>['begin','update','end','node'].includes(e[0])).length,
     hooksBefore,'External history must suppress all native SelectGizmo hooks');
 assert(events.slice().filter(e=>e[0]==='handle').length>=phasesBefore+3,
     'External history must still dispatch begin/update/end to the drawer');
 component.onGizmoHandles=oldFields;
 adapter.refresh([component],new Set(['v3-target']),520);

component.gizmo.onNotGizmoMouseDown({x:90,y:80});
component.gizmo.onNotGizmoMouseMove({x:120,y:80});
component.gizmo.onKeyDown({key:'Escape'});
assert.equal(component.position.x,90,'Escape rolls back the edit command');
const hudDown={x:240,y:80,
    stopPropagation(){events.push(['stop','hud-down']);},
    preventDefault(){events.push(['prevent','hud-down']);}};
component.gizmo.onNotGizmoMouseDown(hudDown);
assert.ok(events.some(e=>e[0]==='stop'&&e[1]==='hud-down'),
    'A HUD-owned mouse-down must stop native Scene selection propagation');
assert.equal(adapter.protectedSelection()?.nodeUuid,'v3-target');
component.gizmo.refreshHandles(); // New row objects from the next HUD frame.
component.gizmo.onNotGizmoMouseUp({x:240,y:80});
assert.equal(component.visible,false,'HUD checkbox uses the same undo-capable session');
assert.equal(adapter.protectedSelection()?.nodeUuid,'v3-target',
    'Selection lease survives until native async selection broadcast');

// A button callback must run without surrendering Node selection to the
// underlying native Scene raycaster, even if HUD items refresh meanwhile.
const beginsBeforeButton=events.filter(e=>e[0]==='begin').length;
const buttonDown={x:740,y:80,
    stopImmediatePropagation(){events.push(['button-stop']);},
    preventDefault(){events.push(['button-prevent']);}};
assert.equal(component.gizmo.onNotGizmoMouseDown(buttonDown),false);
assert.ok(events.some(e=>e[0]==='button-stop'),
    'HUD Button owns its pointer down event, not Scene object selection');
component.gizmo.refreshHandles();
assert.equal(component.gizmo.onNotGizmoMouseUp({x:740,y:80}),false);
assert.ok(events.some(e=>e[0]==='button'&&e[1]==='reset'),
    'HUD Button action must fire after an intermediate Scene frame');
assert.equal(events.filter(e=>e[0]==='begin').length,beginsBeforeButton,
    'Button IDs are actions, not serialized Component Undo properties');
assert.equal(adapter.protectedSelection()?.nodeUuid,'v3-target');
adapter.refresh([component],new Set(),400);
assert.equal(adapter.protectedSelection()?.nodeUuid,'v3-target',
    'Delayed Scene selection refresh must not erase HUD gesture protection');
adapter.refresh([component],new Set(['v3-target']),650);
assert.equal(adapter.status().active,1);

// Reproduction from Creator 3D: ShapeSize updates once and gets cancelled
// if a private SelectGizmo Inspector hook throws while the slider is held.
// Native hook errors must not roll back the Component value or break HUD.
const nativeBegin=component.gizmo.onControlBegin;
const nativeUpdate=component.gizmo.onControlUpdate;
const nativeEnd=component.gizmo.onControlEnd;
const nativeComponentChanged=component.gizmo.onComponentChanged;
component.gizmo.onControlBegin=()=>{throw new Error('Inspector begin unsupported');};
component.gizmo.onControlUpdate=()=>{throw new Error('Inspector update unsupported');};
component.gizmo.onControlEnd=()=>{throw new Error('Inspector end unsupported');};
component.gizmo.onComponentChanged=()=>{throw new Error('Inspector node stale');};
const sizeCancels=events.filter(e=>e[0]==='hud'&&e[1]==='size'&&
    e[2]==='cancel').length;
assert.equal(component.gizmo.onNotGizmoMouseDown({x:870,y:80}),false);
component.gizmo.onNotGizmoMouseMove({x:872,y:80});
component.gizmo.onNotGizmoMouseMove({x:873,y:80});
assert.equal(component.size,3);
assert.equal(adapter.status().draggingSlider,1);
assert.equal(component.gizmo.onNotGizmoMouseUp({x:873,y:80}),false);
assert.equal(component.size,3);
assert.equal(events.filter(e=>e[0]==='hud'&&e[1]==='size'&&
    e[2]==='cancel').length,sizeCancels,
    'ShapeSize must commit instead of cancelling on optional Inspector errors');
const buttonCountBefore=events.filter(e=>e[0]==='button').length;
component.gizmo.onNotGizmoMouseDown({x:740,y:80});
component.gizmo.onNotGizmoMouseUp({x:740,y:80});
assert.equal(events.filter(e=>e[0]==='button').length,buttonCountBefore+1,
    'HUD button remains usable when native onComponentChanged throws');
component.gizmo.onControlBegin=nativeBegin;
component.gizmo.onControlUpdate=nativeUpdate;
component.gizmo.onControlEnd=nativeEnd;
component.gizmo.onComponentChanged=nativeComponentChanged;

const originalHudChanged=component.onGizmoHudChanged;
component.onGizmoHudChanged=(property,phase)=>{
    if(phase==='update')throw new Error('injected HUD failure');
};
component.gizmo.onNotGizmoMouseDown({x:240,y:80});
assert.throws(()=>component.gizmo.onNotGizmoMouseUp({x:240,y:80}),
    /injected HUD failure/);
assert.equal(component.visible,false,'Failed HUD callback rolls back changed property');
component.onGizmoHudChanged=originalHudChanged;
component.gizmo.onNotGizmoMouseDown({x:80,y:80});
assert.equal(adapter.status().draggingPosition,1,
    'An exception in HUD input must never leave Scene pointer captured');
component.gizmo.onNotGizmoMouseUp({x:80,y:80});

// Reproduction: Creator may invoke hide()/destroy() in the SAME frame
// that onControlUpdate updates the Inspector (while mouse button is held).
// The command must survive until a real mouse-up or Escape.
editorRebuildsOnUpdate=true;
editorRebuildsOnBegin=true;
const cancelsBefore=events.filter(e=>e[0]==='handle'&&e[2]==='cancel').length;
component.gizmo.onNotGizmoMouseDown({x:80,y:80});
assert.equal(adapter.status().draggingPosition,1,
    'Synchronous hide/destroy during onControlBegin does not terminate capture');
component.gizmo.onNotGizmoMouseMove({x:105,y:80});
assert.equal(adapter.status().draggingPosition,1,
    'An Editor visibility refresh during onControlUpdate cannot cancel a drag');
const refreshed=adapter.status();
assert.ok(refreshed.active>=1);
assert.ok(component.gizmo.diagnosticState().suppressedLifecycleCancels>=2,
    'Transient Editor lifecycle callbacks are suppressed while dragging');
adapter.refresh([component],new Set(),700);
assert.equal(adapter.status().draggingPosition,1,
    'One empty selection snapshot must not cancel the captured gesture');
component.gizmo.onNotGizmoMouseMove({x:130,y:80});
assert.equal(component.position.x,130,
    'The second pointer frame must update the SAME edit session');
assert.equal(events.filter(e=>e[0]==='handle'&&e[2]==='cancel').length,
    cancelsBefore,'No false cancel before mouse-up');
component.gizmo.onNotGizmoMouseUp({x:130,y:80});
assert.equal(adapter.status().draggingPosition,0);
assert.equal(component.position.x,130,'Mouse-up commits final multi-frame value');
assert.equal(events.filter(e=>e[0]==='handle'&&e[2]==='cancel').length,
    cancelsBefore,'Commit must not be converted into cancel');
// The reported HUD regression: an update is followed by an unexpected
// cancel on the first frame when the Editor refreshes the Gizmo.
const hudCancelCount=events.filter(e=>e[0]==='hud'&&e[2]==='cancel').length;
assert.equal(component.gizmo.onNotGizmoMouseDown({x:440,y:80}),false);
assert.equal(adapter.status().draggingSlider,1);
component.gizmo.onNotGizmoMouseMove({x:460,y:80});
assert.equal(adapter.status().draggingSlider,1);
component.gizmo.onNotGizmoMouseMove({x:480,y:80});
assert.equal(component.radius,80);
assert.equal(events.filter(e=>e[0]==='hud'&&e[2]==='cancel').length,
    hudCancelCount,'HUD slider must not cancel during a held mouse drag');
assert.equal(component.gizmo.onNotGizmoMouseUp({x:480,y:80}),false);
assert.equal(adapter.status().draggingSlider,0);
assert.equal(component.radius,80);
assert.equal(events.filter(e=>e[0]==='hud'&&e[2]==='cancel').length,
    hudCancelCount,'HUD slider should commit rather than cancel on mouse-up');
assert.ok(events.some(e=>e[0]==='hud'&&e[2]==='end'&&e[3]===80));
editorRebuildsOnUpdate=false;
editorRebuildsOnBegin=false;

adapter.refresh([component],new Set(),1100);
assert.equal(adapter.status().active,0);
assert.equal(component.gizmo.isHandleVisible(),false);

// Genuine Scene teardown is different from an Inspector visibility refresh:
// it MUST cancel and restore the value, even while the mouse is held.
adapter.refresh([component],new Set(['v3-target']),1500);
const beforeSceneClose={...component.position};
component.gizmo.onNotGizmoMouseDown({x:80,y:80});
component.gizmo.onNotGizmoMouseMove({x:165,y:80});
assert.equal(adapter.status().draggingPosition,1);
adapter.clear();
assert.deepEqual({ ...component.position },beforeSceneClose,
    'Scene teardown must roll back a captured edit');
assert.equal(adapter.status().active,0);
assert.equal(component.gizmo,null);

assert.equal(component.gizmo,null);
adapter.dispose();
assert.equal(typeDefs.MyV3Component,undefined,'Disposed adapter unregisters its class');
assert.equal(typeDefs['cc.Camera'],BuiltInCameraGizmo);
assert.equal(adapter.status().reason,'disposed');
// Real Creator 3.8.8's manager.createGizmo() may be absent or may not
// expose the instance through Component.gizmo. The pointer bridge still
// needs a real SelectGizmo object to host the command lifecycle.
const previousCreate=manager.createGizmo;
const previousShow=manager.showComponentGizmo;
manager.createGizmo=()=>null;
manager.showComponentGizmo=()=>{};
const standalone=createV3HandleAdapter(()=>true,layout);
standalone.refresh([component],new Set(['v3-target']),2000);
assert.equal(standalone.status().active,1,
    'Standalone SelectGizmo fallback must activate without Editor pool factory');
assert.ok(standalone.status().positionHandles>0);
assert.equal(bridgePort.down({x:80,y:80,button:0,buttons:1}),true,
    'Direct input bridge must still pick a handle with no Component.gizmo');
bridgePort.move({x:175,y:80,button:0,buttons:1});
bridgePort.up({x:175,y:80,button:0,buttons:0});
assert.equal(component.position.x,175);
standalone.dispose();
manager.createGizmo=previousCreate;
manager.showComponentGizmo=previousShow;

// A Creator patch release may expose no private component Gizmo pool at all.
// Drawing and native pointer interactions should remain available, with
// diagnostics explicitly showing that native Undo was not registered.
const previousPool=manager._gizmoPool;
manager._gizmoPool={_getPool(){return null;}};
const unpooled=createV3HandleAdapter(()=>true,layout);
unpooled.refresh([component],new Set(['v3-target']),2500);
assert.equal(unpooled.status().reason,'ready-direct-input-no-native-undo');
assert.equal(unpooled.status().active,1);
assert.equal(bridgePort.down({x:80,y:80,button:0,buttons:1}),true);
bridgePort.move({x:145,y:80,button:0,buttons:1});
bridgePort.up({x:145,y:80,button:0,buttons:0});
assert.equal(component.position.x,145);
unpooled.dispose();
manager._gizmoPool=previousPool;

// A preexisting gizmo registration must not block the independent screen
// picking adapter for another extension's Component.
class ForeignComponentGizmo extends SelectGizmo {}
typeDefs.MyV3Component=ForeignComponentGizmo;
component.gizmo=null;
const occupied=createV3HandleAdapter(()=>true,layout);
occupied.refresh([component],new Set(['v3-target']),3000);
assert.equal(occupied.status().active,1,
    'Occupied Gizmo pool class cannot disable our Scene/HUD input port');
assert.equal(occupied.status().positionHandles,1);
assert.equal(typeDefs.MyV3Component,ForeignComponentGizmo,
    'Existing registered component Gizmo must never be overwritten');
assert.equal(bridgePort.down({x:80,y:80,button:0,buttons:1}),true);
bridgePort.up({x:80,y:80,button:0,buttons:0});
occupied.dispose();
delete typeDefs.MyV3Component;

// Integrated Editor 3.8.8 dispatcher: priority 100 must intercept the
// mouse before the built-in GizmoOperation (99) or Camera (98) handlers.
// This regression is deliberately exercised through createV3HandleAdapter,
// not just the isolated SceneOperationInput unit test.
class NativeOperation {
    listeners=new Map();
    on(name,fn,priority=0){
        const listeners=this.listeners.get(name)||[];
        listeners.push({fn,priority});
        listeners.sort((a,b)=>b.priority-a.priority);
        this.listeners.set(name,listeners);
    }
    removeListener(name,fn){
        this.listeners.set(name,(this.listeners.get(name)||[])
            .filter(entry=>entry.fn!==fn));
    }
    emit(name,event){
        for(const entry of this.listeners.get(name)||[]){
            if(entry.fn(event)===false)return false;
        }
    }
}
const nativeOperation=new NativeOperation();
const nativeSelectionCalls=[];
nativeOperation.on('mousedown',()=>nativeSelectionCalls.push('node'),99);
nativeOperation.on('mousedown',()=>nativeSelectionCalls.push('camera'),98);
cce.Operation=nativeOperation;
component.gizmo=null;
const operationAdapter=createV3HandleAdapter(()=>true,layout);
operationAdapter.refresh([component],new Set(['v3-target']),3500);
assert.equal(operationAdapter.status().operationInput.active,true);
assert.equal(operationAdapter.status().operationInput.priority,100);
assert.equal(operationAdapter.status().active,1);

const mouse=(x,y,fields={})=>({x,y,button:0,buttons:1,...fields});
const hoverStart=events.length;
nativeOperation.emit('mousemove',mouse(80,80));
assert.ok(events.slice(hoverStart).some(e=>e[0]==='hover'&&
    e[1]==='position:position:single'),
    'Native Operation route restores hover without raycast proxies');
const previousEnds=events.filter(e=>e[0]==='handle'&&e[2]==='end').length;
const previousCancels=events.filter(e=>e[0]==='handle'&&e[2]==='cancel').length;
assert.equal(nativeOperation.emit('mousedown',mouse(80,80)),false);
nativeOperation.emit('mousemove',mouse(110,80));
nativeOperation.emit('mousemove',mouse(140,80));
assert.equal(operationAdapter.status().draggingPosition,1);
assert.equal(component.position.x,140);
assert.equal(events.filter(e=>e[0]==='handle'&&e[2]==='cancel').length,
    previousCancels,'Native Editor selection cannot cancel an in-progress drag');
assert.equal(nativeOperation.emit('mouseup',mouse(140,80)),false);
assert.equal(operationAdapter.status().draggingPosition,0);
assert.equal(events.filter(e=>e[0]==='handle'&&e[2]==='end').length,
    previousEnds+1,'Native Operation mouse-up commits exactly once');
assert.deepEqual(nativeSelectionCalls,[],'Owning a handle blocks built-in picker');

const prevActions=events.filter(e=>e[0]==='button').length;
assert.equal(nativeOperation.emit('mousedown',mouse(740,80)),false);
assert.equal(nativeOperation.emit('mouseup',mouse(740,80)),false);
assert.equal(events.filter(e=>e[0]==='button').length,prevActions+1,
    'HUD Button runs through priority 100 Scene Operation');
assert.deepEqual(nativeSelectionCalls,[],
    'HUD Button never unselects the node in the native dispatcher');

const cancelBefore=events.filter(e=>e[0]==='hud'&&e[2]==='cancel').length;
assert.equal(nativeOperation.emit('mousedown',mouse(440,80)),false);
nativeOperation.emit('mousemove',mouse(465,80));
nativeOperation.emit('mousemove',mouse(490,80));
assert.equal(operationAdapter.status().draggingSlider,1);
assert.equal(events.filter(e=>e[0]==='hud'&&e[2]==='cancel').length,
    cancelBefore,'Slider stays open between native Scene frames');
assert.equal(nativeOperation.emit('mouseup',mouse(490,80)),false);
assert.equal(component.radius,90);
assert.equal(events.filter(e=>e[0]==='hud'&&e[2]==='cancel').length,
    cancelBefore,'Slider end is not converted into cancel');

assert.equal(nativeOperation.emit('mousedown',mouse(650,250)),undefined);
assert.deepEqual(nativeSelectionCalls,['node','camera'],
    'Plain Scene click still goes to built-in selection and camera');
operationAdapter.dispose();
assert.equal(nativeOperation.listeners.get('mousedown').length,2,
    'Unload removes only extension listeners and never the Editor handlers');
delete cce.Operation;

// Regression: the Editor initializes cce.Operation in the middle of a
// WebView/engine fallback drag. Swapping ports must never emit cancel.
component.gizmo=null;
const switching=createV3HandleAdapter(()=>true,layout);
switching.refresh([component],new Set(['v3-target']),4000);
assert.equal(bridgePort.down({x:80,y:80,button:0,buttons:1}),true);
const detachBeforeSwitch=bridgeDetaches;
cce.Operation=nativeOperation;
switching.refresh([component],new Set(['v3-target']),4100);
assert.equal(switching.status().operationInput.active,true);
assert.equal(bridgeDetaches,detachBeforeSwitch,
    'Do not detach fallback listeners during their captured pointer gesture');
const transitionCancels=events.filter(e=>e[0]==='handle'&&e[2]==='cancel').length;
bridgePort.move({x:175,y:80,button:0,buttons:1});
bridgePort.up({x:175,y:80,button:0,buttons:0});
assert.equal(events.filter(e=>e[0]==='handle'&&e[2]==='cancel').length,
    transitionCancels,'Enabling native Operation mid-drag must commit normally');
switching.refresh([component],new Set(['v3-target']),4400);
assert.ok(bridgeDetaches>detachBeforeSwitch,
    'Fallback detaches after its gesture has finished');
switching.dispose();
delete cce.Operation;

console.log('[editor-handle-adapter-v3] native Operation priorities, hover, HUD, multiframe commands and teardown OK');
