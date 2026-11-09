import assert from 'node:assert/strict';
import { mergeSameChannels } from '../src/yp.js';
import { cleanDir } from '../src/recording.js';
import { p2pUptime, mergeP2P } from '../src/p2p-channels.js';

// 同じ配信が2つの YP に載っていたら1行にまとめ、YP の欄に両方を出す
const id = 'ABCDEF0123456789ABCDEF0123456789';
const ch = (yp, name, cid = id, extra = {}) => ({ key: `${yp}/${cid}/${name}`, name, id: cid, ypName: yp, listeners: 3, ...extra });
const merged = mergeSameChannels([ch('SP', 'スターマインch'), ch('平成YP', 'スターマインch'), ch('SP', '別の配信', '1'.repeat(32))]);
assert.equal(merged.length, 2);
assert.equal(merged[0].ypName, 'SP', '先の YP の行を残す');
assert.equal(merged[0].sourceLabel, 'SP / 平成YP');
// 同じ YP に同じ行が2回
assert.equal(mergeSameChannels([ch('SP', 'a'), ch('SP', 'a')]).length, 1);
// ID が空・0 のものはまとめない（別の配信かもしれない）
const zero = '0'.repeat(32);
assert.equal(mergeSameChannels([ch('SP', 'x', zero), ch('p@', 'y', zero)]).length, 2);
// お知らせ・イベントはまとめない
assert.equal(mergeSameChannels([ch('SP', 'お知らせ', id, { info: true }), ch('p@', 'お知らせ', id, { info: true })]).length, 2);
// P2P も同じ ID なら YP の行にまとまり、YP の並びを残す
const withP2P = mergeP2P(merged, [{ id, publisher: 'k', p2pOwn: false }]);
assert.equal(withP2P[0].sourceLabel, 'SP / 平成YP / P2P');

// 録画の保存先：ドライブ直下は「C:\」のまま
assert.equal(cleanDir('C:'), 'C:\\');
assert.equal(cleanDir('C:\\'), 'C:\\');
assert.equal(cleanDir(' d:/ '), 'd:\\');
assert.equal(cleanDir('D:\\配信録画\\'), 'D:\\配信録画');
assert.equal(cleanDir(''), '');

// P2P の経過時間：配信者のペカステの値＋掲載を出してからの時間
assert.deepEqual(p2pUptime({ uptime: 3725, ageSeconds: 40 }), { uptime: '1:02', uptimeMin: 62 });
assert.deepEqual(p2pUptime({ uptime: 0 }), { uptime: '0:00', uptimeMin: 0 });
assert.deepEqual(p2pUptime({}), { uptime: '', uptimeMin: -1 });
console.log('merge, folder and p2p uptime tests ok');

// 同じ YP の二重登録（http と https など）は、先のものだけ取得する
import { activeYps, ypKey } from '../src/yp.js';
assert.equal(ypKey('http://p-at.net/'), ypKey('https://P-AT.net/index.txt'));
assert.equal(ypKey('http://www.example.jp/yp/'), ypKey('https://example.jp/yp/index.txt'));
const yps = activeYps([
  { enabled: true, name: 'p@', url: 'http://p-at.net/' },
  { enabled: true, name: 'p@ (2)', url: 'https://p-at.net/' },
  { enabled: true, name: 'SP', url: 'http://bayonet.ddo.jp/sp/' },
]);
assert.deepEqual(yps.map((y) => y.name), ['p@', 'SP']);
console.log('duplicate yp tests ok');
