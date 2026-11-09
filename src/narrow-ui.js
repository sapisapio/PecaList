// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// 細い表示（右に張り付けたとき、または窓を細くしたとき）の一覧と、マウスを乗せたときに出すカード。
// 一覧は「お気に入りの印・チャンネル名・リスナー数」だけ。詳細はカードで見る。
// YP から来る文字は信用しないので、画面に出すときは textContent だけを使う。

const HOVER_DELAY = 300; // マウスを乗せてからカードを出すまで（ミリ秒）
const LEAVE_DELAY = 200; // 離れてからカードを消すまで

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ctx：findChannel, evalOf, rowColors, markEl, select, selectedKey, play, openBbs, toggleFav,
//      openMenu, clickAction, settings, linkify, cleanDescription
export function initNarrowUI(ctx) {
  const $ = (id) => document.getElementById(id);
  const list = $('dlist');
  const card = $('hcard');
  let cardKey = null;   // カードを出しているチャンネル
  let pinned = false;   // クリックで固定しているか
  let showTimer = 0, hideTimer = 0;

  function renderList(channels) {
    const frag = document.createDocumentFragment();
    for (const ch of channels) {
      const ev = ctx.evalOf(ch);
      const row = el('div', 'drow');
      row.dataset.key = ch.key;
      if (ch.key === ctx.selectedKey()) row.classList.add('sel');
      if (ev.favorite) row.classList.add('fav');
      if (ch.event) row.classList.add('event');
      const colors = ctx.rowColors(ch);
      if (colors.text) { row.style.setProperty('--row-text', colors.text); row.classList.add('has-text'); }
      if (colors.bg) { row.style.setProperty('--row-bg', colors.bg); row.classList.add('has-bg'); }
      // 左端の印（録画中・新・長など。ふつうの一覧と同じ）
      const mcell = el('span', 'mcell');
      const mark = ctx.markEl(ch);
      if (mark) mcell.appendChild(mark);
      row.appendChild(mcell);
      const nm = el('span', 'nm', ch.name);
      row.append(nm, el('span', 'lis', ch.listeners < 0 ? '−' : String(ch.listeners)));
      frag.appendChild(row);
    }
    list.replaceChildren(frag);
    // 一覧を描き直しても、出しているカードはそのまま（中身だけ新しくする）
    if (cardKey) {
      const row = rowOf(cardKey);
      if (row) showCard(cardKey, row); else hideCard(true);
    }
  }

  const rowOf = (key) => [...list.children].find((r) => r.dataset.key === key) || null;

  function fillCard(ch) {
    const ev = ctx.evalOf(ch);
    card.classList.toggle('fav', !!ev.favorite);
    const t = el('div', 't');
    t.appendChild(el('b', '', ch.name));
    if (pinned) {
      // 細い窓では外をクリックしにくいので、閉じるボタンを付ける（同じ行をもう一度クリックしても閉じる）
      const x = el('button', 'x', '✕');
      x.title = '閉じる';
      x.addEventListener('click', () => hideCard(true));
      t.appendChild(x);
    } else {
      t.appendChild(el('span', 'pin', 'クリックで固定'));
    }
    const tags = el('div', 'tags');
    if (ev.favorite) tags.appendChild(el('span', 'tag fav', '★ ' + ev.favorite.name));
    for (const x of [ch.genre, ch.ypName, ch.type]) if (x) tags.appendChild(el('span', 'tag', x));
    const desc = el('div', 'desc');
    desc.appendChild(ctx.linkify(ctx.cleanDescription(ch.detail, ctx.settings.showOpenFree)));
    const parts = [t, tags, desc];
    if (ch.comment) {
      const c = el('div', 'cmt');
      c.append('「', ctx.linkify(ch.comment), '」');
      parts.push(c);
    }
    if (ch.contactUrl) {
      const u = el('div', 'url');
      const a = el('a', 'lnk', ch.contactUrl);
      a.dataset.bbs = '1';
      u.appendChild(a);
      parts.push(u);
    }
    const bar = el('div', 'hbar');
    const play = el('button', 'pill play', '▶ 再生');
    play.addEventListener('click', () => ctx.play(ch));
    const bbs = el('button', 'pill', '掲示板');
    bbs.disabled = !ch.contactUrl;
    bbs.addEventListener('click', () => ctx.openBbs(ch));
    const fav = el('button', 'pill' + (ev.favorite ? ' on' : ''), ev.favorite ? '★' : '☆');
    fav.title = ev.favorite ? 'お気に入りから外す' : 'お気に入りに追加';
    fav.addEventListener('click', () => ctx.toggleFav(ch));
    bar.append(play, bbs, fav);
    // 数字は1行の小さな文字にまとめる（細い窓でカードが長くならないように）
    const meta = el('div', 'meta', [`リスナー ${ch.listeners < 0 ? '−' : ch.listeners}`, ch.uptime || '−', `${ch.bitrate}kbps`].join('・'));
    parts.push(meta, bar);
    card.replaceChildren(...parts);
  }

  // カードを行のすぐ下に出す。下に入りきらなければ、行の上に出す
  function showCard(key, row) {
    const ch = ctx.findChannel(key);
    if (!ch) { hideCard(true); return; }
    cardKey = key;
    fillCard(ch);
    card.hidden = false;
    const box = $('list');
    const below = row.offsetTop + row.offsetHeight + 2;
    const h = card.offsetHeight;
    const bottom = box.scrollTop + box.clientHeight;
    card.style.top = (below + h > bottom && row.offsetTop - h - 2 >= box.scrollTop ? row.offsetTop - h - 2 : below) + 'px';
  }

  function hideCard(force = false) {
    if (pinned && !force) return;
    pinned = false;
    cardKey = null;
    card.hidden = true;
  }

  list.addEventListener('mouseover', (e) => {
    const row = e.target.closest('.drow');
    if (!row || pinned) return;
    clearTimeout(hideTimer);
    if (row.dataset.key === cardKey) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => showCard(row.dataset.key, row), HOVER_DELAY);
  });
  list.addEventListener('mouseleave', () => {
    clearTimeout(showTimer);
    if (!pinned) hideTimer = setTimeout(() => hideCard(), LEAVE_DELAY);
  });
  card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  card.addEventListener('mouseleave', () => { if (!pinned) hideTimer = setTimeout(() => hideCard(), LEAVE_DELAY); });

  // クリックで選んでカードを固定。ダブルクリック・中クリック・右クリックはふつうの一覧と同じ
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.drow');
    if (!row) return;
    clearTimeout(showTimer);
    ctx.select(row.dataset.key);
    // 固定しているカードの行をもう一度クリックしたら閉じる
    if (pinned && cardKey === row.dataset.key) { hideCard(true); return; }
    pinned = true;
    showCard(row.dataset.key, row);
  });
  list.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.drow');
    if (row) ctx.clickAction(ctx.settings.dblAction, ctx.findChannel(row.dataset.key));
  });
  list.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  list.addEventListener('auxclick', (e) => {
    const row = e.target.closest('.drow');
    if (!row || e.button !== 1) return;
    e.preventDefault();
    ctx.clickAction(ctx.settings.midAction, ctx.findChannel(row.dataset.key));
  });
  list.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.drow');
    if (!row) return;
    e.preventDefault();
    ctx.select(row.dataset.key);
    const ch = ctx.findChannel(row.dataset.key);
    if (ch) ctx.openMenu(e.clientX, e.clientY, ch);
  });
  // 固定したカードは、カードと一覧の行以外をクリックしたら閉じる
  document.addEventListener('mousedown', (e) => {
    if (!pinned || e.target.closest('#hcard') || e.target.closest('.drow') || e.target.closest('#menu')) return;
    hideCard(true);
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCard(true); });

  return {
    renderList,
    hideCard: () => hideCard(true),
    markSelected(key) { for (const r of list.children) r.classList.toggle('sel', r.dataset.key === key); },
  };
}
