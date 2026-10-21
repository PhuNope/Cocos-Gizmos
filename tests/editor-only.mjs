import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {stripBuild, detectAndStrip, isStandaloneRuntime} = require('../build/strip.js');
const builder = require('../builder.js');
const hooks = require('../build/hooks.js');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(builder.configs['*'].hooks, './build/hooks.js');
assert.equal(hooks.throwError, true);
assert.equal(pkg.contributions.scene.script, './scene.js');
assert.equal(pkg.contributions['asset-db'], undefined, 'runtime assets must not be mounted into the project');

const scene = readFileSync(path.join(root, 'scene.js'), 'utf8');
assert.match(scene, /exports\.load\s*=\s*function/);
assert.match(scene, /exports\.unload\s*=\s*function/);
assert.match(scene, /editor-runtime\/Gizmos2D\.js/);
assert.match(scene, /editor-runtime\/Gizmos3D\.js/);
assert.doesNotMatch(scene, /dist\/Gizmos/);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cocos-gizmos-scene-only-'));
const put = (relative, contents) => {
    const file = path.join(scratch, relative);
    mkdirSync(path.dirname(file), {recursive:true});
    writeFileSync(file, contents);
    return file;
};
try {
    const file = put('src/chunks/game.js',
        "System.register([],function(exports) { class Player { " +
        "update(t){return t+1} a(){Gizmos2D.drawLine(this.node,0,0)} " +
        "onDrawGizmos(){this.a()} onDrawGizmosSelected(){Gizmos3D.drawSphere(this.node,[0,0,0],1)} " +
        "onSelectedGizmsos(){return 'other callback'} onSelectedGizmos(){return 'other alias'} " +
        "fixed(){return 'Gizmos2D onDrawGizmos harmless string'} } " +
        "if (EDITOR) {Gizmos2D.drawCircle()} exports('Player',Player); });");
    const runtime = [
        put('src/extensions/cocos-gizmos/dist/Gizmos.js', 'Object.assign(globalThis,{Gizmos2D,Gizmos3D})'),
        put('src/extensions/cocos-gizmos/dist/Gizmos2D.js', 'class GizmosDebugDraw {}'),
    ];
    const stats = stripBuild(scratch);
    assert.equal(stats.removedFiles, 2);
    assert.equal(stats.removedMethods, 2);
    assert.equal(stats.changedFiles, 1);
    for (const p of runtime) assert.equal(existsSync(p), false);
    const cleaned = readFileSync(file, 'utf8');
    assert.match(cleaned, /update\(t\)/);
    assert.match(cleaned, /a\(\)\{Gizmos2D\.drawLine/);
    assert.match(cleaned, /if \(EDITOR\) \{Gizmos2D\.drawCircle/);
    assert.match(cleaned, /onSelectedGizmsos/);
    assert.match(cleaned, /onSelectedGizmos/);
    assert.doesNotMatch(cleaned, /onDrawGizmos\(\)\{/);
    assert.doesNotMatch(cleaned, /onDrawGizmosSelected\(\)\{/);
    assert.equal(stripBuild(scratch).removedMethods, 0, 'idempotent');
    assert.equal(isStandaloneRuntime('src/chunks/shared.js'), false);

    const result = detectAndStrip(
        'class Player { onDrawGizmos(){ Gizmos2D.drawCircle() } keep(){return Gizmos3D} }',
        'file.js',
    );
    assert.equal(result.removed, 1);
    assert.match(result.text, /keep\(\)/);
    // A bundled chunk containing unrelated Gizmos code must NOT stop the build.
    const mixed = put('src/chunks/shared.js',
        'class GizmosDebugDraw {} class Enemy { onDrawGizmos(){Gizmos2D.drawCircle()} a(){ Gizmos2D.drawLine() } }');
    const mixedStats = stripBuild(scratch);
    assert.equal(mixedStats.removedMethods, 1);
    assert.match(readFileSync(mixed, 'utf8'), /class GizmosDebugDraw/);
    assert.match(readFileSync(mixed, 'utf8'), /a\(\)\{ Gizmos2D\.drawLine\(\)/);
    await hooks.onAfterBuild({dest: scratch}, {dest: scratch});
    console.log('[editor-only] only two callbacks stripped; helpers retained; residual Gizmos calls do not block build; runtime is Scene-only');
} finally {
    rmSync(scratch, {recursive:true, force:true});
}
