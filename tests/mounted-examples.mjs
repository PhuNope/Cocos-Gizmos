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
    'Only generic extension helpers are mounted read-only');
assert.match(config, /example-templates\/Example\/\*\*\/\*\.ts/,
    'Installed project demo templates must be compiled by the sample type check');

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
const directory = JSON.parse(read('example-templates/Example.meta'));
assert.equal(directory.importer, 'directory');
assert.equal(directory.uuid, '63279dc1-4860-421a-9514-8f7a056f8c2c');
seenUuids.add(directory.uuid);
assert.match(packer, /'Example\.meta'/);

for (const { src, oldName, name, uuid } of samples) {
    const relative = 'example-templates/Example/' + name + '.ts';
    const mounted = read(relative);
    const original = read(src);
    let expected = original.replace("@ccclass('" + oldName + "')",
        "@ccclass('" + name + "')").replace('class ' + oldName + ' extends Component',
        'class ' + name + ' extends Component')
        .replace("from '../dist/RegisterGizmos'", "from './RegisterGizmos'");
    // New builder actions capture their Component type, not just the class declaration.
    expected = expected.replaceAll(oldName, name);
    assert.equal(mounted.endsWith(expected), true,
        name + ' must stay in sync with its corresponding project example');
    assert.match(mounted, /import\s*{[^}]*Component[^}]*}\s*from\s*['"]cc['"]/s);
    assert.match(mounted, /onGizmoHUD\(\)/);
    assert.match(mounted, /GizmoHUD\.createHud\(/);
    assert.match(mounted, /\.build\(\)/);
    assert.match(mounted, /onGizmoHandles\(\)/);
    assert.match(mounted, /onGizmoChanged\(/);
    if (name === 'CocosGizmos2DDemo' || name === 'CocosGizmos3DDemo') {
        assert.match(mounted, /\.rotate\('rotationEuler'/,
            'Installed example must expose the interactive rotation ring');
    }
    assert.doesNotMatch(mounted, new RegExp("@ccclass\\('" + oldName + "'\\)"),
        'Installed Component needs a distinct class name if project already copied examples');

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

    assert.ok(packer.includes("'" + 'Example/' + name + '.ts' + "'"),
        'Script must ship inside the opt-in installation templates');
    assert.ok(packer.includes("'" + 'Example/' + name + '.ts.meta' + "'"),
        'Template metadata must ship in the extension ZIP');
}
const helperMeta=JSON.parse(read('example-templates/Example/RegisterGizmos.ts.meta'));
const mountedMeta=JSON.parse(read('editor-assets/RegisterGizmos.ts.meta'));
assert.notEqual(helperMeta.uuid,mountedMeta.uuid,
    'Project helper UUID cannot collide with the still-mounted generic decorator');
assert.ok(!seenUuids.has(helperMeta.uuid));
assert.equal(seenUuids.size, 5);
assert.match(read('example-templates/Example/CocosGizmosDecoratorDemo.ts'),
    /from '\.\/RegisterGizmos'/);
assert.doesNotMatch(packer,/\['editor-assets\/Examples/);
console.log('[example-templates] 4 opt-in Components and local decorator with stable UUIDs OK');
