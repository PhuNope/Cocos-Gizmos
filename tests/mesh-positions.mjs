import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'source/Gizmos3D.ts'), 'utf8');
const begin = source.indexOf('// BEGIN MESH POSITION READER TEST SURFACE');
const end = source.indexOf('// END MESH POSITION READER TEST SURFACE');
assert.ok(begin >= 0 && end > begin, 'mesh reader test surface exists');
const snippet = source.slice(begin, end);
const compiled = ts.transpileModule(snippet, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
});
const syntaxErrors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.equal(syntaxErrors.length, 0,
    syntaxErrors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\\n')).join('\\n'));

const Format = {
    RGB16F: 1,
    RGB32F: 2,
    RGB16I: 3,
    RGB16UI: 4,
    RGBA32F: 5,
    1: 'RGB16F',
    2: 'RGB32F',
    3: 'RGB16I',
    4: 'RGB16UI',
    5: 'RGBA32F',
};
const warnings = [];
class Vec3 {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
}
const sandbox = {
    Vec3,
    gfx: { Format, AttributeName: { ATTR_POSITION: 'a_position' } },
    console: { warn: (...args) => warnings.push(args.join(' ')) },
};
vm.createContext(sandbox);
vm.runInContext(compiled.outputText + '\nthis.getMeshParts = getGizmosMeshParts;', sandbox);
const getMeshParts = sandbox.getMeshParts;

function fixture(format, values, indices = new Uint16Array([0, 1, 2])) {
    let reads = 0;
    const mesh = {
        name: 'fixture',
        data: new Uint8Array([1]),
        // Deliberate index mismatch: submesh 0 references vertexBundle 1.
        struct: {
            vertexBundles: [
                { attributes: [{ name: 'a_normal', format: Format.RGB32F }] },
                { attributes: [{ name: 'a_position', format }] },
            ],
            primitives: [{ vertexBundelIndices: [1] }],
        },
        readAttribute(index, name) {
            assert.equal(index, 0);
            assert.equal(name, 'a_position');
            reads++;
            return values;
        },
        readIndices(index) {
            assert.equal(index, 0);
            return indices;
        },
        get readCount() { return reads; },
    };
    return mesh;
}
function positions(parts) {
    return Array.from(parts, part => Array.from(part.vertices, v => [v.x, v.y, v.z])).flat();
}

// Half bits (1.0, 0.5, -0.5, 0, 2, -2, 0.25, 0.125, -0.125).
const half = fixture(Format.RGB16F, new Uint16Array([
    0x3c00, 0x3800, 0xb800,
    0x0000, 0x4000, 0xc000,
    0x3400, 0x3000, 0xb000,
]));
assert.deepEqual(positions(getMeshParts(half)), [
    [1, 0.5, -0.5], [0, 2, -2], [0.25, 0.125, -0.125],
]);
assert.deepEqual(Array.from(getMeshParts(half)[0].indices), [0, 1, 2]);
assert.equal(half.readCount, 1, 'static asset positions cached across draws');
half.data = new Uint8Array([2]);
getMeshParts(half);
assert.equal(half.readCount, 2, 'replace mesh.data to invalidate geometry cache');

assert.deepEqual(positions(getMeshParts(fixture(Format.RGB32F,
    new Float32Array([0.5, 1, -1, 2, 3, 4, 5, 6, 7])))), [
    [0.5, 1, -1], [2, 3, 4], [5, 6, 7],
]);
assert.deepEqual(positions(getMeshParts(fixture(Format.RGB16I,
    new Int16Array([-3, 2, 1, -10, 20, -30, 0, 0, 0])))), [
    [-3, 2, 1], [-10, 20, -30], [0, 0, 0],
]);
assert.deepEqual(positions(getMeshParts(fixture(Format.RGB16UI,
    new Uint16Array([1, 2, 3, 4, 5, 6, 7, 8, 9])))), [
    [1, 2, 3], [4, 5, 6], [7, 8, 9],
]);

const unsupported = fixture(Format.RGBA32F, new Float32Array(12));
assert.equal(getMeshParts(unsupported).length, 0);
assert.match(warnings.at(-1), /submesh 0: unsupported POSITION format RGBA32F/);

const raw = { vertices: [new Vec3(1, 2, 3), new Vec3(4, 5, 6), new Vec3(7, 8, 9)] };
assert.equal(getMeshParts(raw)[0].vertices.length, 3);
assert.equal(getMeshParts(raw)[0].indices, null);

console.log('[mesh-positions] RGB16F/RGB32F/RGB16I/RGB16UI, submesh bundle mapping, indices and cache OK');
