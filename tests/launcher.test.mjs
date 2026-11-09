import assert from 'node:assert';
import { splitArgs, buildArgs, findPlayer, bbsMatches } from '../src/launcher.js';
assert.deepStrictEqual(splitArgs('"$x" "$0" "$3"'), ['$x','$0','$3']);
assert.deepStrictEqual(splitArgs('-a "b c"  d'), ['-a','b c','d']);
assert.deepStrictEqual(splitArgs('""'), ['']);
const ch = { name:'みかん 亭', id:'ABC', tip:'192.0.2.1:7144', contactUrl:'https://x/', genre:'g', detail:'d', listeners:3, relays:4, bitrate:2000, type:'FLV' };
assert.deepStrictEqual(buildArgs('"$X" "$0" "$3"', ch, 'localhost:7144'), ['http://localhost:7144/pls/ABC?tip=192.0.2.1%3A7144','みかん 亭','https://x/']);
// 小文字はペカレコと同じく IP の形（localhost → 127.0.0.1）
assert.deepStrictEqual(buildArgs('"$x"', ch, 'localhost:7144'), ['http://127.0.0.1:7144/pls/ABC?tip=192.0.2.1%3A7144']);
assert.deepStrictEqual(buildArgs('"$y" "$9" $T', ch, 'localhost:7144'), ['http://127.0.0.1:7144/stream/ABC.flv?tip=192.0.2.1%3A7144','FLV','flv']);
assert.deepStrictEqual(buildArgs('$E $L $$ $z', ch, '192.0.2.9:7144', { filterName: '俺' }), ['%E3%81%BF%E3%81%8B%E3%82%93%20%E4%BA%AD','俺','$','192.0.2.9:7144']);
const ps=[{enabled:true,path:'a.exe',type:'wmv'},{enabled:true,path:'b.exe',type:'flv|wmv'},{enabled:true,path:'c.exe',type:'['}];
assert.strictEqual(findPlayer(ps, ch).path, 'b.exe');
assert.strictEqual(findPlayer(ps, {type:'OGG'}), null);
// 実行ファイルが未設定のプレイヤーは選ばない
assert.strictEqual(findPlayer([{enabled:true,path:'',type:'FLV|WMV'}], ch), null);
assert.ok(bbsMatches({path:'p.exe',urlRegex:'.*'}, 'https://jbbs'));
assert.ok(!bbsMatches({path:'',urlRegex:'.*'}, 'https://jbbs'));
console.log('launcher tests ok');
