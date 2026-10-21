import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {stripBuild, detectAndStrip} = require('../build/strip.js');
const builder = require('../builder.js');
const hooks = require('../build/hooks.js');
assert.equal(builder.configs['*'].hooks, './build/hooks.js');
assert.equal(hooks.throwError, true);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cocos-gizmos-editor-only-'));
const put = (relative, contents) => {
    const file = path.join(scratch, relative);
    mkdirSync(path.dirname(file), {recursive:true});
    writeFileSync(file, contents);
    return file;
};
try {
    // Simulated Cocos System.register output with callbacks and nested braces.
    const file = put('src/chunks/game.js',
        "System.register([],function(exports) { class Player { " +
        "update(t){return t+1} onDrawGizmos(){if(true){Gizmos2D.drawCircle(this.node,{x:0,y:0},1)}} " +
        "onDrawGizmosSelected(){Gizmos3D.drawSphere(this.node,[0,0,0],1)} " +
        "onSelectedGizmsos(){return 'debug'} onSelectedGizmos(){return 'alias'} " +
        "fixed(){return 'Gizmos2D onDrawGizmos harmless string'} } exports('Player',Player); });");
    const runtime = [
        put('src/extensions/cocos-gizmos/dist/Gizmos.js','Object.assign(globalThis,{Gizmos2D,Gizmos3D})'),
        put('src/extensions/cocos-gizmos/dist/Gizmos2D.js','class GizmosDebugDraw {}'),
        put('src/extensions/cocos-gizmos/dist/Gizmos3D.js','class GizmosDebugDraw {}'),
        put('src/extensions/cocos-gizmos/dist/Define.js','export const Editor=true'),
    ];
    const stats = stripBuild(scratch);
    assert.equal(stats.removedFiles, 4);
    assert.equal(stats.removedMethods, 4);
    assert.equal(stats.changedFiles, 1);
    for (const p of runtime) assert.equal(existsSync(p), false);
    const cleaned = readFileSync(file, 'utf8');
    assert.match(cleaned, /update\(t\)/);
    assert.match(cleaned, /fixed\(\)/);
    assert.doesNotMatch(cleaned, /Gizmos2D\.drawCircle/);
    assert.doesNotMatch(cleaned, /Gizmos3D\.drawSphere/);
    assert.equal(stripBuild(scratch).removedMethods, 0, 'idempotent');

    const result = detectAndStrip('class Player { onDrawGizmos(){ Gizmos2D.drawCircle() } keep(){return 42} }','file.js');
    assert.equal(result.removed, 1);
    assert.match(result.text, /keep\(\)/);

    // Unsupported merged runtime must fail WITHOUT changing output.
    const bad = put('src/chunks/shared.js','class GizmosDebugDraw {} class Enemy { onDrawGizmos(){Gizmos2D.drawCircle()} keep(){} }');
    const before = readFileSync(bad, 'utf8');
    assert.throws(() => stripBuild(scratch), /Cannot remove safely/);
    assert.equal(readFileSync(bad, 'utf8'), before);
    rmSync(bad);
    const misplaced = put('src/chunks/other.js','class Enemy { update(){ Gizmos2D.drawLine() } }');
    assert.throws(() => stripBuild(scratch), /Cannot remove safely/);
    rmSync(misplaced);
    await hooks.onAfterBuild({dest: scratch}, {dest: scratch});
    assert.ok(existsSync(file));
    console.log('[editor-only] AST stripping, file removal, fail-closed shared chunks, Cocos build hook OK');
} finally {
    rmSync(scratch, {recursive:true, force:true});
}
