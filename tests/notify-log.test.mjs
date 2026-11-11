import assert from 'node:assert/strict';
import { addEntries, resultText, formatTime, REASONS } from '../src/notify-log.js';

// 新しいものが先頭、300件まで
let list = addEntries([], [{ at: 1, name: 'a' }, { at: 2, name: 'b' }]);
assert.deepEqual(list.map((e) => e.name), ['b', 'a']);
list = addEntries(list, [{ at: 3, name: 'c' }]);
assert.deepEqual(list.map((e) => e.name), ['c', 'b', 'a']);
const many = addEntries([], Array.from({ length: 400 }, (_, i) => ({ at: i, name: String(i) })));
assert.equal(many.length, 300);
assert.equal(many[0].name, '399');

assert.equal(resultText({ shown: true, sticky: true }), '通知した（確認するまで出す）');
assert.equal(resultText({ shown: true, sticky: false }), '通知した（数秒で消える）');
assert.equal(resultText({ shown: false, reason: 'startup' }), '出さなかった：' + REASONS.startup);
assert.match(formatTime(new Date(2026, 10, 9, 7, 5, 3).getTime()), /^11\/9 07:05:03$/);
console.log('notify-log tests ok');
assert.equal(resultText({ shown: true, sticky: false, played: true }), '通知した（数秒で消える）・自動再生');
assert.equal(resultText({ shown: false, reason: 'favOff', played: true }), '出さなかった：お気に入りの通知がオフ・自動再生');
