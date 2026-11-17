import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const folder = `Cocos-Gizmos-v${version}`;
const stageRoot = path.join(root, 'release', 'dev-artifact');
const stage = path.join(stageRoot, folder);
const zip = readFileSync(path.join(root, 'release', folder + '.zip'));

// This path is passed *directly* to actions/upload-artifact. Its contents,
// not itself, become the root of the downloadable GitHub Actions ZIP.
assert.deepEqual(readdirSync(stageRoot), [folder],
    'Artifacts must contain exactly one versioned folder, not the plugin ZIP');
assert.ok(statSync(stage).isDirectory());
const expected = new Map();
let offset = 0;
while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    const dataStart = offset + 30 + nameLength + extraLength;
    if (name !== folder + '/') {
        assert.ok(name.startsWith(folder + '/'));
        const bytes = zip.subarray(dataStart, dataStart + size);
        expected.set(name.slice(folder.length + 1),
            method === 8 ? inflateRawSync(bytes) : bytes);
    }
    offset = dataStart + size;
}
function walk(directory, prefix = '') {
    const result = [];
    for (const name of readdirSync(directory)) {
        const relative = prefix ? prefix + '/' + name : name;
        const full = path.join(directory, name);
        if (statSync(full).isDirectory()) result.push(...walk(full, relative));
        else result.push(relative);
    }
    return result;
}
const files = walk(stage);
assert.ok(files.length > 20, 'Development artifact must include installable plugin');
assert.deepEqual(files.sort(), [...expected.keys()].sort(),
    'Staged artifact must be an exact copy of the installable ZIP contents');
assert.ok(files.every(name => !name.toLowerCase().endsWith('.zip')),
    'GitHub artifact must never contain another ZIP');
for (const name of files) {
    assert.ok(readFileSync(path.join(stage, name)).equals(expected.get(name)),
        'Contents must match packed plugin: ' + name);
}
assert.equal(JSON.parse(readFileSync(path.join(stage, 'package.json'), 'utf8')).version, version);
assert.ok(files.includes('scene.js') && files.includes('editor-runtime/EditorHandleAdapterV3.js'));
console.log('[staged-artifact] exact versioned folder, no nested archive, file list and bytes match ZIP');
