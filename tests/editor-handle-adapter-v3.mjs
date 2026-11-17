import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const source=readFileSync(new URL('../source/EditorHandleAdapterV3.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS,
}}).outputText;
const events=[],paints=[];
let editorRebuildsOnUpdate=false;
let editorRebuildsOnBegin=false;
const component={
    node:{uuid:'v3-target',isValid:true,activeInHierarchy:true},
    isValid:true,enabled:true, __classname__:'MyV3Component',
    position:{x:0,y:0,z:0},visible:true,
    onGizmoHandles(){return [{property:'position',plane:'xy',visual:'point'}];},
    onGizmoHudControls(){return [{id:'visible',type:'checkbox',text:'Visible',
        property:'visible',color:'#ffffff',size:'normal'}];},
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
            normalizeHudControls(){return component.onGizmoHudControls();},
            hudSliderScreenTrack(){return {left:0,width:100};},
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
assert.equal(adapter.status().positionHandles,1);
assert.equal(adapter.status().hudControls,1);
assert.ok(paints.includes(component),'2D/3D rendering is a separate port');
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
assert.equal(component.gizmo.onNotGizmoMouseDown({x:600,y:250}),undefined,
    'Ordinary Scene clicks must remain available for Node selection');
assert.ok(events.some(e=>e[0]==='handle'&&e[2]==='end'));
assert.ok(events.some(e=>e[0]==='begin'&&e[1]==='serialized.position'));
assert.ok(events.some(e=>e[0]==='update'&&e[1]==='serialized.position'));
assert.ok(events.some(e=>e[0]==='end'&&e[1]==='serialized.position'),
    'Native Undo hooks receive the SelectGizmo serialized Component path');
assert.ok(events.some(e=>e[0]==='builder'&&e[1]==='move'),
    'The v3 adapter constructs domain commands through the fluent Builder');
component.gizmo.onNotGizmoMouseDown({x:90,y:80});
component.gizmo.onNotGizmoMouseMove({x:120,y:80});
component.gizmo.onKeyDown({key:'Escape'});
assert.equal(component.position.x,90,'Escape rolls back the edit command');
component.gizmo.onNotGizmoMouseDown({x:240,y:80});
component.gizmo.onNotGizmoMouseUp({x:240,y:80});
assert.equal(component.visible,false,'HUD checkbox uses the same undo-capable session');

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
editorRebuildsOnUpdate=false;
editorRebuildsOnBegin=false;

adapter.refresh([component],new Set(),1100);
assert.equal(adapter.status().active,0);
assert.equal(component.gizmo.isHandleVisible(),false);
adapter.clear();
assert.equal(component.gizmo,null);
adapter.dispose();
assert.equal(typeDefs.MyV3Component,undefined,'Disposed adapter unregisters its class');
assert.equal(typeDefs['cc.Camera'],BuiltInCameraGizmo);
assert.equal(adapter.status().reason,'disposed');
console.log('[editor-handle-adapter-v3] SelectGizmo discovery, command gestures, HUD, cancel, hide and cleanup OK');
