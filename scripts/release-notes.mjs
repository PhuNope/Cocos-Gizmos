import { readFileSync, writeFileSync } from 'node:fs';

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag || '')) {
    throw new Error('Usage: node scripts/release-notes.mjs v2.0.3');
}
const version = tag.slice(1);
const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const start = lines.findIndex(line => line.startsWith('## [' + version + ']'));
if (start < 0) throw new Error('Missing CHANGELOG.md section for ' + tag);
const next = lines.findIndex((line, index) => index > start && line.startsWith('## ['));
const notes = lines.slice(start, next < 0 ? undefined : next).join('\n').trim() + '\n';
writeFileSync('release-notes.md', notes, 'utf8');
console.log('[release] Prepared notes for ' + tag);
