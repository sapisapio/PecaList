import assert from 'node:assert';
import { parseIndexTxt, unescapeHtml, ypIndexUrl, isEventYp, activeYps, cleanYpUrl, isValidYpUrl } from '../src/yp.js';

const yp = { name: 'SP', url: 'http://example.invalid/index.txt' };
const line = 'テスト&amp;ch<>0123456789ABCDEF0123456789ABCDEF<>192.0.2.1:7144<>https://jbbs.example/x/<>雑談<>まったり - &lt;Free&gt;<>12<>15<>2000<>FLV<><><><><>%E3%83%86<>1:05<>click<>初見歓迎<>1';
const info = 'SP ※お知らせ<>00000000000000000000000000000000<><>http://example.invalid/<><>お知らせ本文<>-9<>-9<>0<>RAW<><><><><><>0:00<>click<><>0';
const list = parseIndexTxt(line + '\r\n' + info + '\n\n壊れた行<>だけ', yp);
assert.strictEqual(list.length, 2);
const ch = list[0];
assert.strictEqual(ch.name, 'テスト&ch');
assert.strictEqual(ch.detail, 'まったり - <Free>');
assert.strictEqual(ch.listeners, 12);
assert.strictEqual(ch.relays, 15);
assert.strictEqual(ch.bitrate, 2000);
assert.strictEqual(ch.type, 'FLV');
assert.strictEqual(ch.uptimeMin, 65);
assert.strictEqual(ch.comment, '初見歓迎');
assert.strictEqual(ch.direct, true);
assert.strictEqual(ch.info, false);
assert.strictEqual(list[1].info, true);
assert.strictEqual(unescapeHtml('&quot;a&#039;'), '"a\'');
console.log('yp tests ok');

import { composeDetail, cleanDescription } from '../src/yp.js';
const c = (genre, detail, comment) => ({ genre, detail, comment });
assert.strictEqual(composeDetail(c('雑談', '寝る前のまったり雑談 - <Free>', '初見歓迎')), '雑談 - 寝る前のまったり雑談 - 「初見歓迎」');
assert.strictEqual(composeDetail(c('game', '<Free>', '')), 'game', '概要が<Free>だけでコメントなし');
assert.strictEqual(composeDetail(c('', '<Open>', '')), '');
assert.strictEqual(composeDetail(c('game', '<Free> - 2日目', '')), 'game - 2日目');
assert.strictEqual(composeDetail(c('', 'MMO バージョン7 - <Open>', 'OPP')), 'MMO バージョン7 - 「OPP」');
assert.strictEqual(composeDetail(c('雑談', 'まったり - <Free>', '初見'), { showOpenFree: true }), '雑談 - まったり - <Free> - 「初見」');
assert.strictEqual(composeDetail(c('雑談', 'まったり - <Free>', ''), { splitGenre: true }), 'まったり');
assert.strictEqual(cleanDescription('a-b - <free>', false), 'a-b', 'ハイフンを含む言葉はそのまま');
console.log('composeDetail tests ok');

// イベントYP の行はお知らせ扱いにしない
const ev = parseIndexTxt('ゲーム大会<>00000000000000000000000000000000<><>https://example.invalid/<><>11/10 開催<>-9<>-9<>0<>RAW<><><><><><>0:00<>click<><>0', { name: 'イベントYP', url: 'x', event: true });
assert.strictEqual(ev[0].info, false);
assert.strictEqual(ev[0].event, true);
console.log('event yp tests ok');

// YP のアドレス（ペカレコの「…/sp/」の形でも、index.txt まで書いた形でも）
assert.strictEqual(ypIndexUrl('http://bayonet.ddo.jp/sp/'), 'http://bayonet.ddo.jp/sp/index.txt');
assert.strictEqual(ypIndexUrl('http://bayonet.ddo.jp/sp'), 'http://bayonet.ddo.jp/sp/index.txt');
assert.strictEqual(ypIndexUrl('https://p-at.net/index.txt'), 'https://p-at.net/index.txt');
assert.ok(isEventYp('http://eventyp.xrea.jp/'));
assert.ok(!isEventYp('http://bayonet.ddo.jp/sp/'));
// 使わないもの・名前の重複・空欄は外す
const act = activeYps([
  { enabled: true, name: 'SP', url: 'http://bayonet.ddo.jp/sp/' },
  { enabled: false, name: 'TP', url: 'http://temp.orz.hm/yp/' },
  { enabled: true, name: 'SP', url: 'http://example.invalid/' },
  { enabled: true, name: '', url: 'http://example.invalid/' },
  { enabled: true, name: 'EYP', url: 'http://eventyp.xrea.jp/' },
]);
assert.deepStrictEqual(act.map((y) => [y.name, y.event]), [['SP', false], ['EYP', true]]);
// ペカレコの設定にある崩れたアドレス
assert.strictEqual(cleanYpUrl('http://myoujin06yp.oh.land.to/ /'), 'http://myoujin06yp.oh.land.to/');
assert.strictEqual(cleanYpUrl('ttp://www.geocities.jp/rizeria2992/'), 'http://www.geocities.jp/rizeria2992/');
assert.strictEqual(cleanYpUrl('　 '), '');
assert.ok(isValidYpUrl('http://koumei96.web.fc2.com/ /'));
assert.ok(!isValidYpUrl('example.com/'));
assert.ok(!isValidYpUrl(''));
assert.strictEqual(ypIndexUrl('http://koumei96.web.fc2.com/ /'), 'http://koumei96.web.fc2.com/index.txt');
assert.deepStrictEqual(activeYps([{ enabled: true, name: 'R', url: 'ttp://x.invalid/yp/' }]).map((y) => y.url), ['http://x.invalid/yp/index.txt']);
console.log('yp list tests ok');
