import assert from 'node:assert';
import { newFilter, compileFilter, filterMatches, evaluate, escapeRegex, colorrefToHex, hexToColorref } from '../src/filters.js';

const ch = (o) => ({ name: '', genre: '', detail: '', comment: '', listeners: 10, relays: 10, bitrate: 2000, uptimeMin: 60, type: 'FLV', info: false, ...o });
const f = (o) => compileFilter(newFilter(o));
const fields = (on) => Object.fromEntries(['channelName', 'genre', 'detail', 'comment'].map((k) => [k, on.includes(k)]));

// 正規表現の「|」で複数の名前
const fav = f({ name: '俺', favorite: true, base: { search: 'サピオch|sapio', fields: fields(['channelName']) } });
assert.ok(filterMatches(fav, ch({ name: 'サピオch' })));
assert.ok(filterMatches(fav, ch({ name: 'SAPIO放送' })), '大文字小文字を区別しない');
assert.ok(!filterMatches(fav, ch({ name: 'ほか', detail: 'sapio' })), 'チャンネル名だけが対象');

// 全角半角を区別しない
const w = f({ base: { search: 'ＡＢＣ', fields: fields(['channelName']) } });
assert.ok(filterMatches(w, ch({ name: 'abc配信' })));
// 全角のかっこは正規表現の記号として扱わない
const paren = f({ base: { search: 'みかん（仮）', fields: fields(['channelName']) } });
assert.ok(filterMatches(paren, ch({ name: 'みかん(仮)ch' })));
// エスケープ済みのかっこ（ペカレコのフィルタにある書き方）
const esc = f({ base: { search: 'ゆう\\(0501\\)', fields: fields(['channelName']) } });
assert.ok(filterMatches(esc, ch({ name: 'ゆう(0501)' })));

// 基本検索が空なら一致しない
assert.ok(!filterMatches(f({ base: { search: '', fields: fields(['channelName']) } }), ch({ name: 'x' })));
// 無効なフィルタ・正しくない正規表現は一致しない
assert.ok(!filterMatches(f({ enabled: false, base: { search: 'x', fields: fields(['channelName']) } }), ch({ name: 'x' })));
assert.ok(!filterMatches(f({ base: { search: '(', fields: fields(['channelName']) } }), ch({ name: '(' })));

// AND・NOT・範囲・新着
const cond = f({
  base: { search: 'game', fields: fields(['genre']) },
  and: { enabled: true, search: '初見', fields: fields(['detail']) },
  not: { enabled: true, search: 'NG語', fields: fields(['detail', 'comment']) },
  listener: { min: 5, max: null },
  newCond: { new: true, notNew: false },
});
const base = { genre: 'game', detail: '初見プレイ' };
assert.ok(filterMatches(cond, ch(base), { isNew: true }));
assert.ok(!filterMatches(cond, ch(base), { isNew: false }), '新着のみ');
assert.ok(!filterMatches(cond, ch({ ...base, comment: 'NG語' }), { isNew: true }), 'NOT');
assert.ok(!filterMatches(cond, ch({ ...base, detail: '2周目' }), { isNew: true }), 'AND');
assert.ok(!filterMatches(cond, ch({ ...base, listeners: 3 }), { isNew: true }), 'リスナー数の範囲');

// お知らせ行には当たらない
assert.ok(!filterMatches(fav, ch({ name: 'sapio', info: true })));

// 上にあるフィルタが優先
const ng = f({ name: 'NG', ignore: true, base: { search: 'sapio', fields: fields(['channelName']) } });
const r = evaluate([fav, ng], ch({ name: 'sapio' }), {});
assert.strictEqual(r.first.name, '俺');
assert.strictEqual(r.favorite.name, '俺');
assert.strictEqual(r.ignore.name, 'NG');
assert.strictEqual(r.record, null);
// 自動録画のフィルタ
const rec = f({ name: '録る', download: true, base: { search: 'sapio', fields: fields(['channelName']) } });
assert.strictEqual(evaluate([fav, rec], ch({ name: 'sapio' }), {}).record.name, '録る');
// ペカレコで「開始」がオフ（リストに入れるだけ）のものは、自動では録画しない
const listOnly = f({ name: 'リストだけ', download: true, downloadOpts: { execute: false, observe: true }, base: { search: 'sapio', fields: fields(['channelName']) } });
assert.strictEqual(evaluate([listOnly], ch({ name: 'sapio' }), {}).record, null);

assert.strictEqual(escapeRegex('a(b)|c'), 'a\\(b\\)\\|c');
assert.strictEqual(colorrefToHex(0x0000ff), '#ff0000');
assert.strictEqual(colorrefToHex(16777215), '#ffffff');
assert.strictEqual(hexToColorref('#ff0000'), 0x0000ff);
console.log('filters tests ok');
