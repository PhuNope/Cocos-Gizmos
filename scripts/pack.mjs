import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const distDir = path.join(ROOT, 'dist');
const expectedDist = ['Gizmos.d.ts', 'Gizmos.js'];
const actualDist = readdirSync(distDir).sort();
if (JSON.stringify(actualDist) !== JSON.stringify(expectedDist)) {
  throw new Error(`dist/ must contain only ${expectedDist.join(', ')}; found ${actualDist.join(', ')}`);
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
  throw new Error(`Invalid semantic version: ${pkg.version}`);
}

// This is a Cocos Creator Editor extension manifest, not the development npm package.
// The only contributed assets are the two generated files in ./dist.
const manifest = {
  package_version: 2,
  name: pkg.name,
  version: pkg.version,
  description: 'Global Gizmos2D and Gizmos3D for Cocos Creator',
  author: pkg.author,
  editor: pkg.editor,
  types: './dist/Gizmos.d.ts',
  main: './main.js',
  contributions: { 'asset-db': { mount: { path: './dist', readonly: true } } },
};
const usage = `# Cocos-Gizmos v${pkg.version}\n\nCocos Creator extension providing global Gizmos2D and Gizmos3D.\n\n## Install\n\n1. In Cocos Creator 3.8.2+, open Extensions > Extension Manager.\n2. Select the Project or Global tab, choose Import Extension (+), and select this ZIP.\n3. Enable the Cocos-Gizmos extension and allow the Asset Database to finish importing.\n\nThe extension mounts dist/ as read-only project assets. The JavaScript module must be evaluated before using the runtime globals. Use Gizmos2D and Gizmos3D inside lifecycle callbacks after startup; don't reference them in top-level initializers.\n\nTypes are in dist/Gizmos.d.ts. Cocos Creator's engine provides cc and cc/env.\n\nSource: https://github.com/PhuNope/Cocos-Gizmos\n`;

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
  ['main.js', readFileSync(path.join(ROOT, 'main.js'))],
  ['dist/Gizmos.js', readFileSync(path.join(distDir, 'Gizmos.js'))],
  ['dist/Gizmos.d.ts', readFileSync(path.join(distDir, 'Gizmos.d.ts'))],
];
const outDir = path.join(ROOT, 'release');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `Cocos-Gizmos-v${pkg.version}.zip`);
writeFileSync(outFile, toZip(entries));
console.log(`[pack] wrote ${path.relative(ROOT, outFile)}: ${entries.map(([p]) => p).join(', ')}`);
