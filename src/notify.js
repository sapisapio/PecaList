// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// 通知ポップアップの窓。メインの窓から届いた通知の一覧を表示する。
// ボタンが押されたら、メインの窓に知らせる（再生などはメインの窓が行う）。

import { applyFavCss } from './fav-color.js';

const tauri = window.__TAURI__;
const MAX_CARDS = 5;
let layout = { corner: 'br', hideFromCapture: true };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function send(action, key) {
  tauri.event.emitTo('main', 'notify:action', { action, key });
}

function pill(cls, text, action, key, title) {
  const b = el('button', 'pill' + (cls ? ' ' + cls : ''), text);
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); send(action, key); });
  return b;
}

// 録画の通知：始めた（停止・見る）／終わった（再生・フォルダ）
function recCard(it) {
  const start = it.kind === 'rec-start';
  const card = el('div', 'card rec' + (start ? '' : ' done'));
  const top = el('div', 'top');
  const ttl = el('div', 'ttl');
  ttl.append(document.createTextNode(start ? '録画を始めました：' : '録画が終わりました：'), el('b', '', it.name));
  const x = el('button', 'x', '✕');
  x.title = '閉じる';
  x.addEventListener('click', (e) => { e.stopPropagation(); send('dismiss', it.key); });
  top.append(el('span', 'live'), ttl, x);
  const acts = el('div', 'acts');
  if (start) acts.append(pill('', '■ 停止', 'rec-stop', it.key), pill('', '▶ 見る', 'play', it.key, 'プレイヤーで見る'));
  else acts.append(pill('play', '▶ 再生', 'rec-open', it.key), pill('', 'フォルダ', 'rec-reveal', it.key));
  card.append(top, el('div', 'desc', it.detail), acts);
  card.addEventListener('click', () => send('select', it.key));
  return card;
}

function render(items) {
  const box = document.getElementById('cards');
  const shown = items.slice(0, MAX_CARDS);
  box.replaceChildren(...shown.map((it) => {
    if (it.kind === 'rec-start' || it.kind === 'rec-done') return recCard(it);
    const card = el('div', 'card' + (it.fav ? '' : ' plain'));
    const top = el('div', 'top');
    const ttl = el('div', 'ttl');
    ttl.append(el('b', '', it.name), document.createTextNode(it.sticky ? ' が配信中です' : ' が配信を始めました'));
    const x = el('button', 'x', '✕');
    x.title = it.sticky ? '確認した（閉じる）' : '閉じる';
    x.addEventListener('click', (e) => { e.stopPropagation(); send('dismiss', it.key); });
    top.append(el('span', 'live'), ttl, x);
    const desc = el('div', 'desc', it.detail);
    const acts = el('div', 'acts');
    const play = el('button', 'pill play', '▶');
    play.title = '再生';
    play.addEventListener('click', (e) => { e.stopPropagation(); send('play', it.key); });
    const bbs = el('button', 'pill', '掲示板');
    bbs.addEventListener('click', (e) => { e.stopPropagation(); send('bbs', it.key); });
    acts.append(play, bbs, el('span', 'meta', [it.ypName, it.listeners >= 0 ? `リスナー ${it.listeners}` : ''].filter(Boolean).join('・')));
    card.append(top, desc, acts);
    // カードのどこかを押したら、メインの窓でそのチャンネルを選ぶ
    card.addEventListener('click', () => send('select', it.key));
    return card;
  }));
  const more = document.getElementById('more');
  more.hidden = items.length <= MAX_CARDS;
  more.textContent = `ほか ${items.length - MAX_CARDS} 件`;
  // 中身に合わせて窓の大きさを変える（0 なら隠す）
  requestAnimationFrame(() => {
    const h = items.length ? document.body.scrollHeight : 0;
    tauri.core.invoke('notify_layout', { height: h, corner: layout.corner, hideFromCapture: layout.hideFromCapture });
  });
}

if (tauri) {
  tauri.event.listen('notify:list', (e) => {
    const theme = e.payload.theme;
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    if (e.payload.fav) applyFavCss(document, e.payload.fav);
    else delete document.documentElement.dataset.theme;
    layout = { corner: e.payload.corner, hideFromCapture: e.payload.hideFromCapture };
    render(e.payload.items);
  });
  // 準備ができたことをメインの窓に知らせる（メインが先に送っていた分を受け取るため）
  tauri.event.emitTo('main', 'notify:ready', {});
}

// 通知の窓でも、右クリックでブラウザの標準メニューを出さない
document.addEventListener('contextmenu', (e) => e.preventDefault());
