import assert from 'node:assert';
import { recFileBase, formatDuration, formatHours, formatBytes, formatSpan, inRange, groupByDay, weeklyByFilter, isHeavy, daysLeft, canRecord } from '../src/recording.js';

const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

// ファイル名はペカレコと同じ並び
assert.strictEqual(recFileBase('みかん', new Date(at(2026, 11, 8, 13, 55, 20))), 'みかん_20261108_Sun_135520');

assert.strictEqual(formatDuration(5048000), '1:24:08');
assert.strictEqual(formatDuration(0), '0:00:00');
assert.strictEqual(formatHours(5 * 3600000 + 2 * 60000), '5時間02分');
assert.strictEqual(formatHours(42 * 60000), '42分');
assert.strictEqual(formatBytes(1_320_000_000), '1.32 GB');
assert.strictEqual(formatBytes(640_000_000), '640 MB');
assert.strictEqual(formatBytes(18_560), '19 KB');
assert.strictEqual(formatSpan(at(2026, 11, 8, 13, 55), at(2026, 11, 8, 15, 58)), '13:55〜15:58');

// 範囲と日ごとのまとめ
const now = at(2026, 11, 8, 16, 0);
const items = [
  { start: at(2026, 11, 8, 13, 55), ms: 7400000, bytes: 1.8e9, auto: 'しおさい' },
  { start: at(2026, 11, 8, 0, 5), ms: 3831000, bytes: 2.45e9, auto: 'RPG' },
  { start: at(2026, 11, 7, 22, 0), ms: 3600000, bytes: 1e9, auto: 'しおさい' },
  { start: at(2026, 10, 20, 22, 0), ms: 3600000, bytes: 1e9, auto: 'しおさい' },
];
assert.deepStrictEqual(items.filter((x) => inRange(x, 'today', now)).length, 2);
assert.deepStrictEqual(items.filter((x) => inRange(x, 'yesterday', now)).length, 1);
assert.deepStrictEqual(items.filter((x) => inRange(x, 'week', now)).length, 3);
assert.deepStrictEqual(items.filter((x) => inRange(x, 'all', now)).length, 4);
const g = groupByDay(items, now);
assert.deepStrictEqual(g.map((x) => x.label), ['今日 11/8（日）', '昨日 11/7（土）', '10/20（火）']);
assert.strictEqual(g[0].items[0].start, at(2026, 11, 8, 13, 55), '日の中は新しい順');
assert.strictEqual(g[0].bytes, 1.8e9 + 2.45e9);

// フィルタごとの1週間の集計（1週間より前は数えない）
const w = weeklyByFilter(items, now);
assert.deepStrictEqual(w.map((x) => [x.name, x.count]), [['しおさい', 2], ['RPG', 1]]);
assert.ok(!isHeavy(w[0]));
assert.ok(isHeavy({ count: 14, ms: 0 }));
assert.ok(isHeavy({ count: 1, ms: 21 * 3600000 }));

// 空きが何日分か
assert.strictEqual(daysLeft(5.25e9 * 2, items, now), Math.floor(5.25e9 * 2 / (5.25e9 / 7)));
assert.strictEqual(daysLeft(1e9, [], now), null);

// 録画できる形式
const id = '0123456789abcdef0123456789ABCDEF';
assert.ok(canRecord({ id, type: 'FLV' }));
assert.ok(!canRecord({ id, type: 'WMV' }));
assert.ok(!canRecord({ id, type: 'FLV', info: true }));
assert.ok(!canRecord({ id: '00', type: 'FLV' }));
console.log('recording tests ok');
