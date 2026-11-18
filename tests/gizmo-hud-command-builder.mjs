import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(name, imports = {}) {
    const js = ts.transpileModule(
        readFileSync(new URL('../source/' + name + '.ts', import.meta.url), 'utf8'),
        { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } }
    ).outputText;
    const scope = { exports: {}, console, require(id) {
        if (!(id in imports)) throw Error('Unknown import ' + id);
        return imports[id];
    } };
    scope.globalThis = scope;
    vm.runInNewContext(js, scope);
    return { exports: scope.exports, scope };
}

const api=load('GizmoHUD');
const { GizmoHUD }=api.exports;
const calls=[];
const unsubscribe=GizmoHUD.commands.register({
    id:'gizmo.move',
    canExecute:owner=>owner.allowed===true,
    execute:owner=>calls.push(owner.id),
});
assert.equal(GizmoHUD.commands.canExecute('gizmo.move',{allowed:false}),false);
assert.equal(GizmoHUD.commands.execute('gizmo.move',{allowed:false,id:'x'}),false);
const owner={allowed:true,id:'shape',opacity:0.8,wireframe:false};
const hud=GizmoHUD.createHud('editor-tools')
    .title('Transform').position('bottom-left').theme('light')
    .size(280,'auto').gap(8)
    .row({gap:6},row=>row.button('Move',{command:'gizmo.move',icon:'M'}))
    .separator()
    .slider('Opacity',{property:'opacity',min:0,max:1,step:0.1})
    .toggle('Wireframe',{property:'wireframe'})
    .build();
assert.equal(hud.position,'bottom-left');
assert.equal(hud.theme,'light');
assert.equal(hud.root.width,280);
assert.equal(hud.root.children[1].kind,'row');
assert.equal(hud.root.children[2].kind,'separator');
assert.equal(hud.root.children[3].command.property,'opacity');
const mount=GizmoHUD.mount(hud,owner);
assert.equal(GizmoHUD.mounted().length,1);
mount.get('title-1').setText('Updated');
mount.get('button-1').setDisabled(true);
assert.equal(GizmoHUD.mounted()[0].definition.root.children[0].text,'Updated');
assert.equal(GizmoHUD.mounted()[0].definition.root.children[1].children[0].disabled,true);
mount.hide();
assert.equal(GizmoHUD.mounted().length,0);
mount.show();
assert.equal(GizmoHUD.mounted().length,1);
assert.equal(GizmoHUD.commands.execute('gizmo.move',owner),true);
assert.deepEqual(calls,['shape']);
unsubscribe();
assert.equal(GizmoHUD.commands.execute('gizmo.move',owner),false);
mount.destroy();
assert.equal(GizmoHUD.mounted().length,0);

const session=load('GizmoEditSession');
const controller=load('GizmoHUDController',{'./GizmoEditSession':session.exports});
const valueOwner={};
let value=0.5;
const slider=GizmoHUD.createHud('value-test')
    .slider('Size',{value:0.5,min:0,max:1,onChange:next=>{value=next;}})
    .build().root.children[0];
const dispatcher=new controller.exports.GizmoHudCommandController();
assert.equal(dispatcher.begin(valueOwner,slider),true);
assert.equal(dispatcher.update(0.9),true);
assert.equal(value,0.9);
assert.equal(dispatcher.finish(true),true);
assert.equal(value,0.5,'Cancel rolls back callback-backed state');
console.log('[gizmo-hud-command-builder] registry, fluent options, mounts and callback value commands OK');
