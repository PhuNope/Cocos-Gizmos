import { readFileSync, mkdirSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const distDir = path.join(ROOT, 'dist');
const globalTypesAsset = path.join(ROOT, 'editor-assets', 'GizmosGlobal.ts');
const expectedDist = ['Define.js', 'SceneUpdateScheduler.js', 'ExecuteGizmos.js', 'DrawCommandBuffer2D.js', 'Gizmos.d.ts', 'Gizmos.js', 'GizmoHandlePresets.js', 'Gizmos2D.js', 'Gizmos3D.js'].sort();
const actualDist = readdirSync(distDir).sort();
if (JSON.stringify(actualDist) !== JSON.stringify(expectedDist)) {
  throw new Error(`dist/ must contain only ${expectedDist.join(', ')}; found ${actualDist.join(', ')}`);
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
  throw new Error(`Invalid semantic version: ${pkg.version}`);
}

// This is a Cocos Creator Editor extension manifest, not the development npm package.
// The extension contributes one public entry, one .d.ts, and four internal runtime modules in ./dist.
const manifest = {
  package_version: 2,
  name: pkg.name,
  version: pkg.version,
  description: 'Global Gizmos2D and Gizmos3D for Cocos Creator',
  author: pkg.author,
  editor: pkg.editor,
  types: './dist/Gizmos.d.ts',
  main: './main.js',
  panels: {
    settings: { title: 'Gizmos Settings', type: 'dockable', main: './panels/settings/index.js' },
  },
  // The Scene Script is Editor-only: unlike asset-db mounts, it is never
  // included in the Cocos game script graph.
  contributions: {
    scene: { script: './scene.js' },
    builder: './builder.js',
    'asset-db': { mount: { path: './editor-assets', readonly: true } },
    menu: [
      { path: 'Gizmos', label: 'Reset Gizmos', message: 'reset-gizmos' },
      { path: 'Gizmos', label: 'Gizmos Settings', message: 'open-settings' },
    ],
    messages: {
      'reset-gizmos': { methods: ['resetGizmos'] },
      'open-settings': { methods: ['openSettings'] },
      'get-settings': { methods: ['getSettings'] },
      'set-settings': { methods: ['setSettings'] },
      'get-diagnostics': { methods: ['getDiagnostics'] },
      'get-example-assets': { methods: ['getExampleAssets'] },
      // Creator dispatches both events. Source package.json alone is not
      // installed; these must be preserved in the generated extension ZIP.
      'selection:select': { methods: ['onSelectionSelect'] },
      'selection:unselect': { methods: ['onSelectionUnselect'] },
    },
  },
};
const usage = `# Cocos-Gizmos v${pkg.version}\n\nCocos Creator extension providing global Gizmos2D and Gizmos3D.\n\n## Install\n\n1. In Cocos Creator 3.8.2+, open Extensions > Extension Manager.\n2. Select the Project or Global tab, choose Import Extension (+), and select this ZIP.\n3. Enable the Cocos-Gizmos extension and allow the Asset Database to finish importing.\n\nEditor-only Scene Script runs Gizmos outside the game Asset Database, so runtime JS is not imported into game builds. The build hook removes only onDrawGizmos and onDrawGizmosSelected from compiled game JS. Other calls are not checked or modified. The JavaScript module must be evaluated before using the runtime globals. Use Gizmos2D and Gizmos3D inside lifecycle callbacks after startup; don't reference them in top-level initializers.\n\n## Drag-and-drop demo Components\n\nAfter enabling the extension, open the Cocos Assets panel > cocos-gizmos > Examples. Select a Scene Node, then drag CocosGizmos2DDemo.ts, CocosGizmos3DDemo.ts or CocosGizmosSmokeDemo.ts onto the Node's Inspector. If the files do not appear, use Extensions > Gizmos Settings > Check example assets to inspect both Asset Database import status and Scene Component class registration. Both should show imported/registered before manual drag-and-drop testing. Re-selecting a 2D Node should restore all drag points. The HUD uses a fixed full-width textured Gizmo overlay at the bottom of the Scene View (not Canvas Labels), with 12-24px bounded text, screen-space controls and proper camera projection. Scene selection:select/unselect events restore drag handles when selection goes empty then returns to the same Node. Use the new top-level Gizmos > Reset Gizmos menu to rebuild editor-only controllers and HUD after a Scene failure, without touching Scene assets. Use Gizmos > Gizmos Settings for diagnostics if the Scene camera or Gizmo bridge is unavailable. These demo scripts are mounted read-only and use stable UUIDs. For editable copies, use the separate examples/ folder. Remove test Components before shipping; disabling the extension makes Scenes referencing them lose those scripts.\n\nTypes are in dist/Gizmos.d.ts. Cocos Creator's engine provides cc and cc/env.\n\nSource: https://github.com/PhuNope/Cocos-Gizmos\n`;

// Standards-compliant ZIP using only Node built-ins; no extra zip executable
// and no dependency required on Windows, macOS or Linux.
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
  }
  return (crc ^ -1) >>> 0;
}
function toZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, input] of entries) {
    if (name.includes('\\') || name.startsWith('/') || name.includes('..')) throw new Error(`Unsafe ZIP entry: ${name}`);
    const filename = Buffer.from(name, 'utf8');
    const content = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
    const compressed = deflateRawSync(content, { level: 9 });
    const crc = crc32(content);
    const zipTime = 0;
    const zipDate = 0x21; // Jan 1 1980
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(zipTime, 10);
    header.writeUInt16LE(zipDate, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(zipTime, 12);
    record.writeUInt16LE(zipDate, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(content.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const entries = [
  ['package.json', JSON.stringify(manifest, null, 2) + '\n'],
  ['README.md', usage],
  ['editor-assets/GizmosGlobal.ts', readFileSync(globalTypesAsset)],
  // These example Components belong to the mounted read-only Asset DB so the
  // user can drag a script straight from Assets > cocos-gizmos > Examples into
  // the Inspector. Checked-in .meta files give them stable UUIDs across builds.
  ...[
    'Examples.meta',
    'Examples/CocosGizmos2DDemo.ts',
    'Examples/CocosGizmos2DDemo.ts.meta',
    'Examples/CocosGizmos3DDemo.ts',
    'Examples/CocosGizmos3DDemo.ts.meta',
    'Examples/CocosGizmosSmokeDemo.ts',
    'Examples/CocosGizmosSmokeDemo.ts.meta',
  ].map(relative => ['editor-assets/' + relative,
    readFileSync(path.join(ROOT, 'editor-assets', relative))]),
  // Keep editable copies for users who prefer their own project assets.
  ['examples/GizmoSmokeProbe.ts', readFileSync(path.join(ROOT, 'assets', 'GizmoSmokeProbe.ts'))],
  ['examples/Gizmos2DApiTest.ts', readFileSync(path.join(ROOT, 'assets', 'Gizmos2DApiTest.ts'))],
  ['examples/Gizmos3DApiTest.ts', readFileSync(path.join(ROOT, 'assets', 'Gizmos3DApiTest.ts'))],
  ['docs/EDITOR_SMOKE_TEST.md', readFileSync(path.join(ROOT, 'docs', 'EDITOR_SMOKE_TEST.md'))],
  ['docs/MOVE_GIZMO.md', readFileSync(path.join(ROOT, 'docs', 'MOVE_GIZMO.md'))],
  ['main.js', readFileSync(path.join(ROOT, 'main.js'))],
  ['scene.js', readFileSync(path.join(ROOT, 'scene.js'))],
  ['panels/settings/index.js', readFileSync(path.join(ROOT, 'panels/settings/index.js'))],
  ...['Define.js', 'GizmoDiagnostics.js', 'GizmoExampleClassDiagnostics.js', 'SceneGizmoInput.js', 'GizmoEditSession.js', 'GizmoPresentation.js', 'GizmoHudControls.js', 'GizmoHudLayout.js', 'GizmoHudProjection.js', 'SceneCameraBridge.js', 'GizmoHudOverlay.js', 'GizmoPresentationService.js', 'GizmoMoveCommand.js', 'GizmoHandlePresets.js', 'PositionDragSolver.js', 'PlaneHandleGeometry.js', 'AxisHandleGeometry.js', 'PositionHandles.js', 'SceneUpdateScheduler.js', 'ExecuteGizmos.js', 'DrawCommandBuffer2D.js', 'GizmoHandlePresets.js', 'Gizmos2D.js', 'Gizmos3D.js']
    .map(name => ['editor-runtime/' + name, readFileSync(path.join(ROOT, 'editor-runtime', name))]),
  ['builder.js', readFileSync(path.join(ROOT, 'builder.js'))],
  ['build/hooks.js', readFileSync(path.join(ROOT, 'build', 'hooks.js'))],
  ['build/strip.js', readFileSync(path.join(ROOT, 'build', 'strip.js'))],
  // TypeScript AST parser is bundled into the extension ZIP because Cocos
  // installations may not expose require('typescript') to build workers.
  ['build/vendor/typescript.js', readFileSync(createRequire(import.meta.url).resolve('typescript'))],
  // Critical for Cocos 3.8: by default, *.js is treated as CJS. Cocos
  // detects ESM by the nearest package.json's "type": "module".
  // Put this marker *inside dist/*, not at the extension root: main.js
  // must remain CommonJS so the editor can call its load() hook.
  ['dist/package.json', JSON.stringify({ type: 'module', private: true }, null, 2) + '\n'],
  ['dist/Gizmos.js', readFileSync(path.join(distDir, 'Gizmos.js'))],
  ['dist/Gizmos.d.ts', readFileSync(path.join(distDir, 'Gizmos.d.ts'))],
  ...['Define.js', 'SceneUpdateScheduler.js', 'ExecuteGizmos.js', 'DrawCommandBuffer2D.js', 'Gizmos2D.js', 'Gizmos3D.js']
    .map(name => ['dist/' + name, readFileSync(path.join(distDir, name))]),
];
// Regression test: load the extracted directory structure in Node's own
// module-format resolver. This catches "Unexpected import statement in CJS
// module" before publishing an extension ZIP.
function verifyModuleFormats() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cocos-gizmos-module-format-'));
  try {
    const tempDist = path.join(tempRoot, 'dist');
    mkdirSync(tempDist);
    for (const [name, data] of entries) {
      if (name === 'main.js' || name === 'builder.js' || name === 'scene.js' || name === 'package.json' ||
          name.startsWith('editor-runtime/') || name.startsWith('panels/') ||
          name.startsWith('dist/') || (name.startsWith('build/') && !name.includes('/vendor/'))) {
        const destination = path.join(tempRoot, name);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, data);
      }
    }
    const jsEntries = entries.map(([name]) => name).filter(name => name.endsWith('.js') && !name.includes('/vendor/'));
    for (const relative of jsEntries) {
      const expectedFormat = (relative === 'main.js' || relative === 'builder.js' || relative === 'scene.js' || relative.startsWith('panels/') || relative.startsWith('editor-runtime/') || relative.startsWith('build/')) ? 'commonjs' : 'module';
      const target = path.join(tempRoot, relative);
      const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
      if (result.error || result.status !== 0) {
        throw new Error(`[pack] ${relative} should be ${expectedFormat}, syntax check failed:\n${result.stderr || result.error}`);
      }
    }
    // All ESM relative references must resolve to actual assets in this ZIP.
    for (const [name, data] of entries) {
      if (!name.startsWith('dist/') || !name.endsWith('.js')) continue;
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : data;
      for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g)) {
        const referenced = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
        if (!entries.some(([entry]) => entry === referenced)) {
          throw new Error('[pack] ' + name + ' imports a missing module ' + match[1]);
        }
      }
    }
    const nestedPackage = JSON.parse(readFileSync(path.join(tempDist, 'package.json'), 'utf8'));
    const topPackage = JSON.parse(readFileSync(path.join(tempRoot, 'package.json'), 'utf8'));
    if (nestedPackage.type !== 'module' || topPackage.type === 'module') {
      throw new Error('[pack] Invalid ESM boundary: dist/ must be ESM, extension main.js must be CJS');
    }
    console.log('[pack] verified Cocos-compatible ESM boundary (dist/) and CommonJS editor entry');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
verifyModuleFormats();

const outDir = path.join(ROOT, 'release');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `Cocos-Gizmos-v${pkg.version}.zip`);
// The installed manifest is generated here, not copied from package.json.
const installed = JSON.parse(String(entries.find(([name]) => name === 'package.json')?.[1] || '{}'));
for (const event of ['reset-gizmos', 'selection:select', 'selection:unselect']) {
  if (!installed.contributions?.messages?.[event]?.methods?.length) {
    throw new Error('[pack] Missing required Scene selection event in release ZIP: ' + event);
  }
}
writeFileSync(outFile, toZip(entries));
console.log(`[pack] wrote ${path.relative(ROOT, outFile)}: ${entries.map(([p]) => p).join(', ')}`);
