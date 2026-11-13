import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const manifest = JSON.parse(read('package.json'));
const packer = read('scripts/pack.mjs');
const config = read('tsconfig.assets.json');

assert.equal(manifest.contributions['asset-db'].mount.path, './editor-assets');
assert.equal(manifest.contributions['asset-db'].mount.readonly, true,
    'Extension examples should be read-only and must not modify project assets');
assert.match(config, /editor-assets\/Examples\/\*\*\/\*\.ts/,
    'Mounted demo Components must be compiled by the sample type check');

const samples = [
    {
        src: 'assets/Gizmos2DApiTest.ts',
        oldName: 'Gizmos2DApiTest',
        name: 'CocosGizmos2DDemo',
        uuid: '79b61d2e-c131-4ae7-8be4-54aa7becc30a',
    },
    {
        src: 'assets/Gizmos3DApiTest.ts',
        oldName: 'Gizmos3DApiTest',
        name: 'CocosGizmos3DDemo',
        uuid: '1f0a6e38-ffb9-4f95-9f39-ef443ba2e6d8',
    },
    {
        src: 'assets/GizmoSmokeProbe.ts',
        oldName: 'GizmoSmokeProbe',
        name: 'CocosGizmosSmokeDemo',
        uuid: 'c9f57ebd-36ce-4b24-a7bf-47a350c2d9db',
    },
    {
        src: 'assets/GizmosDecoratorTest.ts',
        oldName: 'GizmosDecoratorTest',
        name: 'CocosGizmosDecoratorDemo',
        uuid: '5c7b9b5e-3c33-42cd-b09d-5de039e8cbee',
    },
];
const seenUuids = new Set();
const directory = JSON.parse(read('editor-assets/Examples.meta'));
assert.equal(directory.importer, 'directory');
assert.equal(directory.uuid, '63279dc1-4860-421a-9514-8f7a056f8c2c');
seenUuids.add(directory.uuid);
assert.match(packer, /'Examples\.meta'/);

for (const { src, oldName, name, uuid } of samples) {
    const relative = 'editor-assets/Examples/' + name + '.ts';
    const mounted = read(relative);
    const original = read(src);
    const expected = original.replace("@ccclass('" + oldName + "')",
        "@ccclass('" + name + "')").replace('class ' + oldName + ' extends Component',
        'class ' + name + ' extends Component')
        .replace("from '../dist/RegisterGizmos'", "from '../RegisterGizmos'");
    assert.equal(mounted.endsWith(expected), true,
        name + ' must stay in sync with its corresponding project example');
    assert.match(mounted, /import\s*{[^}]*Component[^}]*}\s*from\s*['"]cc['"]/s);
    assert.match(mounted, /onGizmoHudControls\(\)/);
    assert.match(mounted, /onGizmoHandles\(\)/);
    assert.match(mounted, /onGizmoChanged\(/);
    assert.doesNotMatch(mounted, new RegExp("@ccclass\\('" + oldName + "'\\)"),
        'Mounted Component needs a distinct class name if project already copied examples');

    const ast = ts.createSourceFile(relative, mounted, ts.ScriptTarget.ES2017, true, ts.ScriptKind.TS);
    assert.equal(ast.parseDiagnostics.length, 0, name + ' must parse as TypeScript');
    const classes = ast.statements.filter(ts.isClassDeclaration);
    const componentClasses = classes.filter(type => type.name?.text === name);
    assert.equal(componentClasses.length, 1, 'One Cocos Component class per asset');
    assert.ok(classes.length <= 2, 'One ordinary TypeScript drawer class is allowed');

    const meta = JSON.parse(read(relative + '.meta'));
    assert.equal(meta.importer, 'typescript');
    assert.equal(meta.imported, true);
    assert.equal(meta.uuid, uuid, 'Stable asset UUIDs preserve Scene and Prefab references');
    assert.match(meta.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(Array.isArray(meta.files), true);
    assert.equal(typeof meta.userData, 'object');
    assert.equal(seenUuids.has(meta.uuid), false, 'Meta UUIDs must not collide');
    seenUuids.add(meta.uuid);

    assert.ok(packer.includes("'" + 'Examples/' + name + '.ts' + "'"),
        'Script must ship inside the mounted editor-assets directory');
    assert.ok(packer.includes("'" + 'Examples/' + name + '.ts.meta' + "'"),
        'Mounted script metadata must ship in the extension ZIP');
}
assert.equal(seenUuids.size, 5);

console.log('[mounted-examples] 4 drag-and-drop Components, distinct classes and stable Cocos UUIDs OK');
