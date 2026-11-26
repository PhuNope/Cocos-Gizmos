import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const extension=require('../main.js');
const {installExample,EXAMPLE_FILES}=require('../example-installer.js');
const pkg=require('../package.json');
assert.ok(pkg.contributions.menu.some(v=>v.path==='Gizmos' &&
    v.label==='Install Example' && v.message==='install-example'));
assert.deepEqual(pkg.contributions.messages['install-example'].methods,['installExample']);
const original=globalThis.Editor;
const makeProject=()=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'gizmos-install-test-'));
    mkdirSync(path.join(root,'assets'));
    return root;
};
const roots=[];
try {
    const root=makeProject();roots.push(root);
    const calls=[],messages=[];
    globalThis.Editor={
        Project:{path:root},
        Message:{async request(...args){calls.push(args);return true;}},
        log:v=>messages.push(v),
        warn:v=>messages.push(v),
    };
    assert.equal(existsSync(path.join(root,'assets','Example')),false,
        'Loading or enabling the extension cannot install sample assets');
    extension.load();
    assert.equal(existsSync(path.join(root,'assets','Example')),false,
        'Extension load must be read-only for project assets');
    const installed=await extension.methods.installExample();
    assert.equal(installed.status,'installed');
    assert.equal(installed.url,'db://assets/Example');
    assert.equal(installed.refresh,'completed');
    assert.deepEqual(calls,[['asset-db','refresh-asset','db://assets']]);
    const dir=path.join(root,'assets','Example');
    assert.deepEqual(readdirSync(dir).sort(),[...EXAMPLE_FILES].sort(),
        'Only the four demos and local decorator helper are installed');
    assert.equal(existsSync(path.join(root,'assets','Example.meta')),true);
    const two=JSON.parse(readFileSync(path.join(dir,'CocosGizmos2DDemo.ts.meta')));
    assert.equal(two.uuid,'79b61d2e-c131-4ae7-8be4-54aa7becc30a');
    const projectHelper=JSON.parse(readFileSync(path.join(dir,'RegisterGizmos.ts.meta')));
    const mountedHelper=require('node:fs').readFileSync(
        new URL('../editor-assets/RegisterGizmos.ts.meta',import.meta.url),'utf8');
    assert.notEqual(projectHelper.uuid,JSON.parse(mountedHelper).uuid,
        'Installed local decorator helper and extension-mounted helper must have different UUIDs');
    assert.match(readFileSync(path.join(dir,'CocosGizmosDecoratorDemo.ts'),'utf8'),
        /from '\.\/RegisterGizmos'/);
    const userFile=path.join(dir,'CocosGizmos2DDemo.ts');
    writeFileSync(userFile,'// my edited project code\n');
    const repeat=await extension.methods.installExample();
    assert.equal(repeat.status,'already-exists');
    assert.equal(readFileSync(userFile,'utf8'),'// my edited project code\n',
        'Re-install never overwrites user changes');
    assert.equal(calls.length,1,'No AssetDB refresh when installation was skipped');

    const missingProject=makeProject();roots.push(missingProject);
    globalThis.Editor.Project.path=missingProject;
    globalThis.Editor.Message.request=async()=>{throw new Error('Asset DB still loading');};
    const deferred=await extension.methods.installExample();
    assert.equal(deferred.status,'installed');
    assert.equal(deferred.refresh,'pending',
        'Installed files survive Asset DB refresh failure');
    assert.ok(existsSync(path.join(missingProject,'assets','Example','RegisterGizmos.ts')));

    const colliding=makeProject();roots.push(colliding);
    writeFileSync(path.join(colliding,'assets','Example.meta'),'// user-owned metadata');
    globalThis.Editor.Project.path=colliding;
    await assert.rejects(extension.methods.installExample(),/Example.meta already exists/);
    assert.equal(existsSync(path.join(colliding,'assets','Example')),false);
    assert.equal(readFileSync(path.join(colliding,'assets','Example.meta'),'utf8'),
        '// user-owned metadata');

    const badTemplateProject=makeProject();roots.push(badTemplateProject);
    await assert.rejects(installExample({Project:{path:badTemplateProject}},
        path.join(badTemplateProject,'extension-not-installed')),/ENOENT|template/i);
    assert.equal(existsSync(path.join(badTemplateProject,'assets','Example')),false,
        'Missing template must not create a partial Example directory');

    await assert.rejects(installExample({Project:{path:''}}),/no Cocos Creator project/);
    await assert.rejects(installExample({Project:{path:root+'/nonexistent'}}),
        /assets directory is missing/);
    console.log('[install-example] opt-in, local meta UUIDs, refresh, no-overwrite, rollback and absent project OK');
} finally {
    if(original===undefined)delete globalThis.Editor;
    else globalThis.Editor=original;
    for(const root of roots)rmSync(root,{recursive:true,force:true});
}
