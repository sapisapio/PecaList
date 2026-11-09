import assert from 'node:assert';
import { newBlock, compileBlock, blockNameMatches, blockNeedsHost, blockHostMatches, blockInvalid, tipIp } from '../src/blocks.js';

const ch = (name) => ({ name, tip: '192.0.2.1:7144' });

// チャンネル名（大文字小文字・全角半角を区別しない）
const a = compileBlock(newBlock({ name: 'テスト|ＡＢＣ' }));
assert.ok(blockNameMatches(a, ch('abcの配信'), 'manualPlay'));
assert.ok(blockNameMatches(a, ch('テスト'), 'autoRecord'));
assert.ok(!blockNameMatches(a, ch('ほか'), 'manualPlay'));
assert.ok(!blockNeedsHost(a));

// 止める操作を選べる
const b = compileBlock(newBlock({ name: 'x', manualPlay: false }));
assert.ok(!blockNameMatches(b, ch('x'), 'manualPlay'));
assert.ok(blockNameMatches(b, ch('x'), 'manualRecord'));

// ホスト名：チャンネル名が空ならすべてのチャンネルが対象で、ホスト名で決める
const h = compileBlock(newBlock({ host: '\\.example\\.jp$' }));
assert.ok(blockNameMatches(h, ch('なんでも'), 'manualPlay'));
assert.ok(blockNeedsHost(h));
assert.ok(blockHostMatches(h, 'p1234.example.jp'));
assert.ok(!blockHostMatches(h, 'other.example.com'));
assert.ok(!blockHostMatches(h, ''), 'ホスト名が分からなければ止めない');

// 両方空・無効・正しくない正規表現は何も止めない
assert.ok(!blockNameMatches(compileBlock(newBlock()), ch('x'), 'manualPlay'));
assert.ok(!blockNameMatches(compileBlock(newBlock({ name: 'x', enabled: false })), ch('x'), 'manualPlay'));
const bad = compileBlock(newBlock({ name: '(' }));
assert.ok(blockInvalid(bad));
assert.ok(!blockNameMatches(bad, ch('('), 'manualPlay'));

assert.strictEqual(tipIp('192.0.2.1:7144'), '192.0.2.1');
assert.strictEqual(tipIp('[2001:db8::1]:7144'), '2001:db8::1');
assert.strictEqual(tipIp(''), '');
console.log('blocks tests ok');
