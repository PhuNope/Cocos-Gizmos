import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(path.join(root, name), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const workflow = read('.github/workflows/release.yml');
const docs = read('README.md');
const changelog = read('CHANGELOG.md');
assert.equal(pkg.version, '3.0.0');
assert.equal(pkg.package_version, 2,
    'Creator manifest package_version is schema version 2, not the extension major');
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
assert.match(workflow, /branches:\s*\[dev, master, v3\]/);
assert.match(workflow, /github\.ref == 'refs\/heads\/v3'/);
assert.match(workflow, /name: Cocos-Gizmos-v3-\$\{\{ github\.sha \}\}/);
assert.doesNotMatch(workflow, /refs\/heads\/v2|branches:\s*\[[^\]]*v2/);
assert.match(docs, /Cocos-Gizmos-v3\.0\.0\.zip/);
assert.match(docs, /Pushes to .*v3/);
assert.match(changelog, /^## \[3\.0\.0\]/m);
console.log('[version-branch] v3 branch and 3.0.0 release version synchronized');
