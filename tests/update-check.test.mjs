import assert from 'node:assert/strict';
import { parseVersion, newerThan, pickUpdate } from '../src/update-check.js';

assert.deepEqual(parseVersion('v0.2.21'), [0, 2, 21]);
assert.deepEqual(parseVersion('0.10.0'), [0, 10, 0]);
assert.equal(parseVersion('v0.2'), null);
assert.equal(parseVersion('latest'), null);
assert.ok(newerThan([0, 10, 0], [0, 9, 99]), '数字として比べる（文字の順ではない）');
assert.ok(!newerThan([0, 2, 21], [0, 2, 21]));

const rel = (tag, extra = {}) => ({ tag_name: tag, html_url: `https://github.com/sapisapio/PecaList/releases/tag/${tag}`, draft: false, prerelease: true, ...extra });
const list = [rel('v0.2.21'), rel('v0.2.23'), rel('v0.2.22'), rel('v0.3.0', { draft: true })];
assert.deepEqual(pickUpdate(list, '0.2.21'), { version: '0.2.23', url: 'https://github.com/sapisapio/PecaList/releases/tag/v0.2.23' }, '一番新しいもの（下書きは除く）');
assert.equal(pickUpdate(list, '0.2.23'), null, '今の版が一番新しければ出さない');
assert.equal(pickUpdate(list, '0.2.30'), null, '手元のほうが新しくても出さない');
assert.equal(pickUpdate([rel('v9.9.9', { html_url: 'https://example.com/x' })], '0.2.21'), null, '配布ページ以外へのリンクは使わない');
assert.equal(pickUpdate({ message: 'API rate limit exceeded' }, '0.2.21'), null, '一覧でない返事');
assert.equal(pickUpdate(list, ''), null);
console.log('update check tests ok');
