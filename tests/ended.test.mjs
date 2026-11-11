import assert from 'node:assert/strict';
import { updateEnded, playingRows, ENDED_MAX, endedKeepOf, endedKeepLabel } from '../src/ended.js';

const id = (n) => String(n).padStart(32, 'A');
const ch = (key, n, extra = {}) => ({ key, id: id(n), name: key, ypName: 'SP', listeners: 3, ...extra });
const H = 60 * 60 * 1000;
const ended = new Map();
const a = ch('SP/a', 1), b = ch('SP/b', 2), info = ch('SP/info', 3, { info: true });
updateEnded(ended, [a, b, info], [a], 1000);
assert.deepEqual([...ended.keys()], ['SP/b'], '消えた配信だけ（お知らせは除く）');
assert.equal(ended.get('SP/b').ended, 1000);
updateEnded(ended, [a], [a, b], 2000);
assert.equal(ended.size, 0, 'また見えたら外す');
// 別の YP の行として残っていれば終わっていない
updateEnded(ended, [a], [ch('p@/a', 1, { ypName: 'p@' })], 3000);
assert.equal(ended.size, 0);
// 3時間で消える・多すぎたら古いものから
updateEnded(ended, [b], [], 0);
updateEnded(ended, [], [], 3 * H);
assert.equal(ended.size, 1, '3時間ちょうどはまだ残る');
updateEnded(ended, [], [], 3 * H + 1);
assert.equal(ended.size, 0, '3時間たったら消える');
// 出しておく時間を選べる
updateEnded(ended, [b], [], 0, 1440);
updateEnded(ended, [], [], 23 * H, 1440);
assert.equal(ended.size, 1, '24時間なら23時間後も残る');
updateEnded(ended, [], [], 2 * H, 60);
assert.equal(ended.size, 0, '1時間に変えたら消える');
updateEnded(ended, [a, b], [], 0, 'refresh');
assert.equal(ended.size, 2);
updateEnded(ended, [], [], 1, 'refresh');
assert.equal(ended.size, 0, '次の更新までなら次の更新で消える');
assert.equal(endedKeepOf('x'), 180);
assert.equal(endedKeepLabel(1440), '24時間');
// 同じ配信者名：チャンネルIDが変わって再開したら外す・終わった配信は新しいもの1つだけ
const n1 = ch('SP/1/名前', 21, { name: '名前' }), n2 = ch('SP/2/名前', 22, { name: '名前' });
updateEnded(ended, [n1], [], 10);
updateEnded(ended, [n2], [], 20);
assert.deepEqual([...ended.keys()], ['SP/2/名前'], '同じ名前は新しいものだけ');
updateEnded(ended, [], [ch('SP/3/ＮＡＭＥ', 23, { name: '名前' })], 30);
assert.equal(ended.size, 0, '別のIDで再開したら外す');
updateEnded(ended, [n1], [{ ...n2, info: true }], 40);
assert.equal(ended.size, 1, 'お知らせの行は配信中とみなさない');
ended.clear();
const many = Array.from({ length: ENDED_MAX + 5 }, (_, i) => ch('SP/' + i, i + 10));
for (let i = 0; i < many.length; i++) updateEnded(ended, [many[i]], [], 100 + i);
assert.equal(ended.size, ENDED_MAX);
assert.ok(!ended.has('SP/0') && ended.has('SP/' + (many.length - 1)), '古いものから消す');

// 再生中：YP の行 → 終わった配信の行 → ペカステの情報の順に使う
const live = [ch('SP/x', 7)], gone = [{ ...ch('SP/y', 8), ended: 5 }];
const rows = playingRows([
  { channelId: id(7) }, { channelId: id(8) },
  { channelId: id(9), name: 'ローカル', genre: 'g', desc: 'd', contentType: 'FLV', bitrate: 1000, uptime: 3725, listeners: 2, relays: 1 },
], live, gone);
assert.equal(rows[0].key, 'SP/x');
assert.equal(rows[1].key, 'SP/y');
assert.equal(rows[2].key, 'local/' + id(9));
assert.equal(rows[2].uptime, '1:02');
assert.equal(rows[2].ypName, 'ペカステ');
console.log('ended and playing tests ok');
