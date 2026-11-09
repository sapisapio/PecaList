import assert from 'node:assert/strict';
import { favCss, favColor, FAV_DEFAULT } from '../src/fav-color.js';

// 初めの色
const def = favCss();
assert.ok(def.includes(`--favc:${FAV_DEFAULT.light};--favc-bg:var(--fav-bg)`));
assert.ok(def.includes(`--favc:${FAV_DEFAULT.dark};--favc-bg:var(--fav-bg)`));
// 好きな色（ライトとダークを別に）
const c = favCss({ light: '#2266AA', dark: '#88ccff' });
assert.ok(c.includes('--favc:#2266aa;--favc-bg:color-mix(in srgb, #2266aa 10%, var(--panel))'));
assert.ok(c.includes('--favc:#88ccff'));
// 行の背景なし
assert.ok(favCss({ rowBg: false }).includes('--favc-bg:transparent'));
// 色でない文字は使わない（画面の見た目を壊す書き込みを防ぐ）
assert.equal(favColor('red;}body{display:none', 'light'), FAV_DEFAULT.light);
assert.equal(favColor('', 'dark'), FAV_DEFAULT.dark);
console.log('fav-color tests ok');
