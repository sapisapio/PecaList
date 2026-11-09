// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// 録画タブ：録画の開始・停止、録画中の様子、録画したものの一覧、自動録画、録画の通知。
// 実際の受け取りと保存は Rust 側（recorder.rs）が行う。

import {
  recFileBase, formatDuration, formatHours, formatBytes, formatSpan,
  inRange, groupByDay, weeklyByFilter, isHeavy, daysLeft, canRecord,
} from './recording.js';
import { loadStore, saveStoreSoon } from './store.js';

const tauri = window.__TAURI__;
const $ = (id) => document.getElementById(id);
const MAX_HISTORY = 3000;
// YP から消えたまま、これだけ更新が続いたら、戻ってくるのを待つのをやめる（ペカレコと同じ3回）
const GONE_REFRESHES = 3;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(cls, text, onClick, title) {
  const b = el('button', cls, text);
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

// ctx：settings, getFilters, allChannels, findChannel, evalOf, detailText, toast, ask,
//      play, select, showTab, isShown, addPopup, removePopup, onChange
export function initRecUI(ctx) {
  const { settings } = ctx;
  const active = new Map();      // 録画の番号 → 録画中の様子
  const starting = new Set();    // 録画を始めようとしているチャンネルID
  const userStopped = new Set(); // 手で止めたチャンネルID（その配信の間は自動録画しない）
  const selected = new Set();    // 一覧で選んでいる録画
  const missing = new Set();     // ファイルが見つからない録画
  const popupInfo = new Map();   // 通知のカード → 中身
  let history = [];
  let range = 'today';
  let disk = null;
  let diskAt = 0;
  let saveAt = 0;

  const invoke = (cmd, args) => (tauri ? tauri.core.invoke(cmd, args) : Promise.reject(new Error('アプリの中でのみ使えます')));
  const save = () => { saveAt = Date.now(); saveStoreSoon('recordings', () => ({ version: 1, items: history })); };
  const recOf = (channelId) => [...active.values()].find((r) => r.channelId === channelId.toUpperCase());

  async function load() {
    const s = await loadStore('recordings');
    history = s?.items || [];
    // 前回、録画中にアプリが落ちた：ファイルから実際の長さと大きさを読み直す
    const stale = history.filter((x) => x.live);
    for (const x of stale) {
      x.live = false;
      try { Object.assign(x, await invoke('rec_probe', { path: x.path })); } catch { /* ファイルがなければそのまま */ }
    }
    if (stale.length) save();
    if (!settings.recDir && tauri) {
      settings.recDir = await invoke('rec_default_dir');
      ctx.saveSettings();
    }
  }

  // ---- 開始・停止 ----
  async function start(ch, auto = null) {
    if (!ch) { ctx.toast('チャンネルタブで録画するチャンネルを選んでください'); return; }
    if (!canRecord(ch)) { ctx.toast(`${ch.type || 'この形式'} の配信はまだ録画できません（FLV のみ）`); return; }
    const cid = ch.id.toUpperCase();
    if (recOf(cid) || starting.has(cid)) { if (!auto) ctx.toast(`「${ch.name}」はもう録画しています`); return; }
    if (!settings.recDir) { ctx.toast('録画の保存先を決めてください（⚙ 設定）'); return; }
    starting.add(cid);
    try {
      const blocked = await ctx.checkBlock(ch, !!auto);
      if (blocked) {
        if (!auto) ctx.toast(`「${ch.name}」はブロックリスト（${ctx.blockLabel(blocked)}）に当たるので録画しません`);
        return;
      }
      const id = await invoke('rec_start', {
        req: {
          peercast: settings.peercast, channelId: cid, tip: ch.tip || '',
          dir: settings.recDir, sub: settings.recSubFolder ? ch.name : '',
          base: recFileBase(ch.name, new Date()), waitSec: settings.recWaitMin * 60,
        },
      });
      userStopped.delete(cid);
      active.set(id, {
        id, channelId: cid, key: ch.key, name: ch.name, detail: ctx.detailText(ch), auto,
        state: 'connecting', ms: 0, bytes: 0, seams: 0, waitLeft: 0, error: '', gone: 0,
        files: [], item: null,
      });
      if (settings.recNotify) {
        popup(id, { kind: 'rec-start', name: ch.name, detail: (auto ? `自動録画（${auto}）・` : '') + ctx.detailText(ch), chKey: ch.key });
      }
      changed();
    } catch (e) {
      ctx.toast('録画を始められませんでした：' + e);
    } finally {
      starting.delete(cid);
    }
  }

  function stop(id) {
    const r = active.get(id);
    if (!r) return;
    userStopped.add(r.channelId);
    invoke('rec_stop', { id }).catch(() => {});
  }
  function stopChannel(ch) {
    const r = ch && recOf(ch.id || '');
    if (r) stop(r.id);
  }

  function popup(id, info) {
    const key = `rec:${id}`;
    popupInfo.set(key, info);
    ctx.addPopup(key, info);
  }

  // ---- Rust 側からの知らせ ----
  function onStatus(s) {
    const r = active.get(s.id);
    if (!r) return;
    Object.assign(r, { state: s.state, ms: s.ms, bytes: s.bytes, seams: s.seams, waitLeft: s.waitLeft, error: s.error });
    if (s.path) {
      // 新しいファイルを書き始めたら、一覧に「録画中」の行を作っておく（アプリが落ちても残るように）
      if (!r.item || r.item.path !== s.path) {
        r.item = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, path: s.path, name: r.name, channelId: r.channelId,
          detail: r.detail, auto: r.auto, start: Date.now() - s.ms, end: Date.now(), ms: s.ms, bytes: s.bytes, seams: s.seams, live: true,
        };
        history.push(r.item);
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        save();
      }
      Object.assign(r.item, { ms: s.ms, bytes: s.bytes, seams: s.seams, end: Date.now() });
      if (Date.now() - saveAt > 30000) save();
    }
    if (s.state === 'done') {
      if (s.relayError) ctx.toast(s.relayError);
      finish(r, s.reason);
    }
    else renderLive();
    renderCount();
  }

  function onFile(f) {
    const r = active.get(f.id);
    let item = history.find((x) => x.path === f.path);
    if (!item) {
      item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, path: f.path, name: r?.name || '', channelId: r?.channelId || '', detail: r?.detail || '', auto: r?.auto || null, start: Date.now() - f.ms };
      history.push(item);
    }
    Object.assign(item, { ms: f.ms, bytes: f.bytes, seams: f.seams, end: Date.now(), live: false });
    if (r) r.files.push(item);
    save();
  }

  function finish(r, reason) {
    active.delete(r.id);
    const files = r.files;
    if (files.length === 0) {
      ctx.removePopup(`rec:${r.id}`);
      if (reason === 'error') ctx.toast(`「${r.name}」の録画が止まりました：${r.error}`);
      else if (reason === 'gone') ctx.toast(`「${r.name}」は録画できませんでした（配信が届きませんでした）`);
    } else {
      if (reason === 'error') ctx.toast(`「${r.name}」の録画が途中で止まりました：${r.error}`);
      if (settings.recNotify) {
        const ms = files.reduce((s, x) => s + x.ms, 0);
        const bytes = files.reduce((s, x) => s + x.bytes, 0);
        popup(r.id, {
          kind: 'rec-done', name: r.name, path: files[files.length - 1].path, chKey: r.key,
          detail: `${formatDuration(ms)}・${formatBytes(bytes)}` + (files.length > 1 ? `（${files.length}ファイル）` : ''),
        });
      }
    }
    changed();
  }

  if (tauri) {
    tauri.event.listen('rec:status', (e) => onStatus(e.payload));
    tauri.event.listen('rec:file', (e) => onFile(e.payload));
  }

  // ---- 一覧の更新ごと：自動録画と、終わった配信の見切り ----
  function onRefresh(options = {}) {
    const chans = ctx.allChannels();
    const present = new Set(chans.filter((c) => c.id).map((c) => c.id.toUpperCase()));
    for (const id of [...userStopped]) if (!present.has(id)) userStopped.delete(id);
    for (const r of active.values()) {
      if(options.p2pEvent) continue; // 通常YPの更新周期で終了待ち回数を数える
      if (present.has(r.channelId)) { r.gone = 0; continue; }
      r.gone++;
      // 中身が届かず、YP からも消えた：配信が終わったとみなして待つのをやめる
      if (r.gone >= GONE_REFRESHES && r.state !== 'recording') invoke('rec_stop', { id: r.id }).catch(() => {});
    }
    if (!settings.recDir) return;
    for (const ch of chans) {
      if(ch.p2pOnly && !settings.p2pAutoActions) continue;
      const ev = ctx.evalOf(ch);
      if (!ev.record || ev.ignore || !canRecord(ch)) continue;
      const cid = ch.id.toUpperCase();
      if (userStopped.has(cid) || recOf(cid) || starting.has(cid)) continue;
      start(ch, ev.record.name);
    }
  }

  // ---- 表示 ----
  function changed() {
    renderCount();
    if (ctx.isShown()) render();
    ctx.onChange();
  }
  function renderCount() {
    $('n-rec').textContent = active.size;
  }

  function stateText(r) {
    if (r.state === 'recording') return ['録画中', 'on'];
    if (r.state === 'waiting') {
      const m = Math.floor(r.waitLeft / 60), s = r.waitLeft % 60;
      return [`待機中（あと ${m}:${String(s).padStart(2, '0')}）`, 'wait'];
    }
    return ['配信を待っています…', 'wait'];
  }

  function renderLive() {
    if (!ctx.isShown()) return;
    const box = $('rec-live');
    $('rec-live-n').textContent = active.size ? `${active.size}件` : '';
    if (active.size === 0) {
      box.replaceChildren(el('div', 'rec-empty', '録画中のものはありません。'));
      return;
    }
    box.replaceChildren(...[...active.values()].map((r) => {
      const card = el('div', 'rec-card' + (r.state === 'recording' ? '' : ' wait'));
      const nm = el('div', 'nm', r.name);
      nm.appendChild(el('small', '', r.detail));
      nm.title = r.detail;
      const big1 = el('div', 'big', formatDuration(r.ms));
      big1.appendChild(el('small', '', '録画時間'));
      const big2 = el('div', 'big', formatBytes(r.bytes));
      big2.appendChild(el('small', '', '大きさ'));
      const why = el('div', 'why');
      const [st, cls] = stateText(r);
      why.append(el('span', 'state ' + cls, st), el('span', r.auto ? 'tag auto' : 'tag', r.auto ? `自動：${r.auto}` : '手動'));
      if (r.seams > 0) why.appendChild(el('span', '', `${r.seams}回つなぎ直し`));
      if (r.files.length > 0) why.appendChild(el('span', '', `配信の形式が変わったので、${r.files.length + 1}つ目のファイルです`));
      if (r.error && r.state !== 'recording') why.appendChild(el('span', 'err', r.error));
      card.append(el('span', 'rec-dot'), nm, big1, big2, btn('btn sm', '■ 停止', () => stop(r.id)), why);
      return card;
    }));
  }

  function visibleItems() {
    const now = Date.now();
    return history.filter((x) => !x.live && inRange(x, range, now));
  }

  function renderDone() {
    const items = visibleItems();
    for (const s of $('rec-range').children) s.classList.toggle('on', s.dataset.range === range);
    // 見えていない行の選択は外す
    const ids = new Set(items.map((x) => x.id));
    for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
    const n = selected.size;
    $('rec-sel-n').textContent = n ? `${n}件を選択中` : '';
    $('rec-forget').disabled = n === 0;
    $('rec-trash').disabled = n === 0;
    $('rec-all').checked = items.length > 0 && n === items.length;

    const box = $('rec-done');
    if (items.length === 0) {
      const label = { today: '今日', yesterday: '昨日', week: 'この1週間', all: '' }[range];
      box.replaceChildren(el('div', 'rec-empty', `${label ? label + 'の' : ''}録画はまだありません`));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const g of groupByDay(items, Date.now())) {
      const day = el('div', 'day');
      day.append(el('b', '', g.label), el('span', '', `${g.items.length}件・${formatHours(g.ms)}・${formatBytes(g.bytes)}`));
      frag.appendChild(day);
      const table = el('table', 'done');
      const cols = el('colgroup');
      for (const w of [34, 150, 0, 110, 70, 76, 200]) {
        const c = el('col');
        if (w) c.style.width = w + 'px';
        cols.appendChild(c);
      }
      const tb = el('tbody');
      for (const it of g.items) tb.appendChild(doneRow(it));
      table.append(cols, tb);
      frag.appendChild(table);
    }
    box.replaceChildren(frag);
  }

  function doneRow(it) {
    const gone = missing.has(it.id);
    const tr = el('tr', (selected.has(it.id) ? 'sel' : '') + (gone ? ' missing' : ''));
    const ck = el('input');
    ck.type = 'checkbox';
    ck.checked = selected.has(it.id);
    ck.addEventListener('change', () => {
      if (ck.checked) selected.add(it.id); else selected.delete(it.id);
      renderDone();
    });
    const tdc = el('td', 'mark');
    tdc.appendChild(ck);
    const note = el('td', 'c-note', it.detail || '');
    note.title = (it.detail || '') + '\n' + it.path;
    note.appendChild(el('span', it.auto ? 'tag auto' : 'tag', it.auto ? `自動：${it.auto}` : '手動'));
    if (gone) note.appendChild(el('span', 'gone', 'ファイルがありません'));
    else if (it.seams > 0) note.appendChild(el('span', 'ok', `${it.seams}回切れたけど1つのファイル`));
    const acts = el('div', 'acts');
    const play = btn('ib play', '▶ 再生', () => openFile(it));
    play.disabled = gone;
    acts.append(play, btn('ib', 'フォルダ', () => reveal(it.path)), btn('ib del', 'ごみ箱', () => trash([it])));
    const tda = el('td');
    tda.appendChild(acts);
    tr.append(tdc, el('td', 'c-name', it.name), note, el('td', 'c-time', formatSpan(it.start, it.end)), el('td', 'num', formatDuration(it.ms)), el('td', 'num', formatBytes(it.bytes)), tda);
    tr.addEventListener('dblclick', () => { if (!gone) openFile(it); });
    return tr;
  }

  function renderSide() {
    $('rec-disk-h').textContent = settings.recDir ? `保存先（${settings.recDir}）` : '保存先';
    $('rec-disk-h').title = settings.recDir;
    const d = $('rec-disk');
    if (!disk) {
      d.replaceChildren(el('div', 'k', settings.recDir ? '空き容量を調べています…' : '保存先がまだ決まっていません（⚙ 設定）'));
    } else {
      const v = el('div', 'v', formatBytes(disk.free));
      v.appendChild(el('small', '', '空き'));
      const meter = el('div', 'meter');
      const i = el('i');
      i.style.width = Math.round((1 - disk.free / disk.total) * 100) + '%';
      meter.appendChild(i);
      const left = daysLeft(disk.free, history, Date.now());
      const k = el('div', 'k');
      if (left === null) k.textContent = 'この1週間はまだ録画がありません';
      else {
        k.append('この1週間のペースだと、あと ');
        k.appendChild(el('b', '', left > 365 ? '1年以上' : `約${left}日分`));
        k.append(' 録画できます');
      }
      d.replaceChildren(v, meter, k);
    }
    const week = weeklyByFilter(history, Date.now());
    const box = $('rec-weekly');
    if (week.length === 0) {
      box.replaceChildren(el('div', 'none', 'この1週間、自動録画はありません'));
      return;
    }
    const max = Math.max(...week.map((s) => s.bytes), 1);
    const filters = ctx.getFilters();
    box.replaceChildren(...week.map((s) => {
      const heavy = isHeavy(s);
      const row = el('div', 'fl' + (heavy ? ' warn' : ''));
      const top = el('div', 'top');
      top.append(el('b', '', s.name), el('span', '', `${s.count}回・${formatHours(s.ms)}・${formatBytes(s.bytes)}`));
      const f = filters.find((x) => x.name === s.name);
      const kwText = f ? `キーワード「${f.base.search}」` : '（今はないフィルタ）';
      const kw = el('div', 'kw', heavy ? `${kwText} ― 多めです。広すぎないか確かめてください` : kwText);
      kw.title = kwText;
      const bar = el('div', 'bar');
      const i = el('i');
      i.style.width = Math.max(2, Math.round((s.bytes / max) * 100)) + '%';
      bar.appendChild(i);
      row.append(top, kw, bar);
      return row;
    }));
  }

  async function refreshDisk(force) {
    if (!tauri || !settings.recDir) { disk = null; return; }
    if (!force && Date.now() - diskAt < 60000) return;
    diskAt = Date.now();
    try { disk = await invoke('rec_disk', { dir: settings.recDir }); } catch { disk = null; }
    if (ctx.isShown()) renderSide();
  }

  async function checkMissing() {
    if (!tauri) return;
    const items = visibleItems();
    if (items.length === 0) return;
    try {
      const ok = await invoke('rec_exists', { paths: items.map((x) => x.path) });
      let diff = false;
      items.forEach((x, i) => {
        const was = missing.has(x.id);
        if (ok[i]) missing.delete(x.id); else missing.add(x.id);
        if (was === ok[i]) diff = true;
      });
      if (diff && ctx.isShown()) renderDone();
    } catch { /* 調べられなければそのまま */ }
  }

  function render() {
    renderLive();
    renderDone();
    renderSide();
  }

  // タブを開いたとき
  function show() {
    render();
    refreshDisk(true);
    checkMissing();
  }

  // ---- ファイルの操作 ----
  async function openFile(it) {
    try { await invoke('rec_open', { path: it.path }); } catch (e) { ctx.toast(String(e)); checkMissing(); }
  }
  async function reveal(path) {
    try { await invoke('rec_reveal', { path }); } catch (e) { ctx.toast(String(e)); }
  }
  async function trash(items) {
    if (items.length > 1) {
      const ok = await ctx.ask('ごみ箱へ', `${items.length}件の録画をごみ箱に入れます。ごみ箱から元に戻せます。`, [
        { label: 'キャンセル', value: false },
        { label: 'ごみ箱へ', value: true, primary: true },
      ]);
      if (!ok) return;
    }
    try {
      await invoke('rec_trash', { paths: items.map((x) => x.path) });
    } catch (e) {
      ctx.toast(String(e));
      return;
    }
    forget(items);
    ctx.toast(items.length > 1 ? `${items.length}件をごみ箱に入れました` : `「${items[0].name}」の録画をごみ箱に入れました`);
    refreshDisk(true);
  }
  function forget(items) {
    const ids = new Set(items.map((x) => x.id));
    history = history.filter((x) => !ids.has(x.id));
    for (const id of ids) { selected.delete(id); missing.delete(id); }
    save();
    if (ctx.isShown()) render();
  }
  const selectedItems = () => history.filter((x) => selected.has(x.id));

  $('rec-range').addEventListener('click', (e) => {
    const s = e.target.closest('[data-range]');
    if (!s) return;
    range = s.dataset.range;
    selected.clear();
    renderDone();
    checkMissing();
  });
  $('rec-all').addEventListener('change', (e) => {
    selected.clear();
    if (e.target.checked) for (const x of visibleItems()) selected.add(x.id);
    renderDone();
  });
  $('rec-forget').addEventListener('click', () => forget(selectedItems()));
  $('rec-trash').addEventListener('click', () => trash(selectedItems()));
  $('rec-folder').addEventListener('click', () => reveal(settings.recDir));
  $('rec-add').addEventListener('click', () => start(ctx.selectedChannel()));

  // 1秒ごとに、待っている残り時間などを進める
  setInterval(() => {
    for (const r of active.values()) if (r.state === 'waiting' && r.waitLeft > 0) r.waitLeft--;
    renderLive();
  }, 1000);

  // ---- 通知のカードのボタン ----
  function handleAction(action, key) {
    const info = popupInfo.get(key);
    const id = Number(key.split(':')[1]);
    if (action === 'dismiss') { ctx.removePopup(key); return; }
    if (action === 'rec-stop') { stop(id); return; }
    if (action === 'play' && info?.chKey) { ctx.play(ctx.findChannel(info.chKey)); return; }
    if (action === 'rec-open' && info?.path) { openFile({ path: info.path }); ctx.removePopup(key); return; }
    if (action === 'rec-reveal' && info?.path) { reveal(info.path); return; }
    if (action === 'select') ctx.showTab('rec');
  }

  return {
    load,
    start,
    stopChannel,
    onRefresh,
    show,
    render,
    renderCount,
    handleAction,
    isRecording: (ch) => !!(ch?.id && recOf(ch.id)),
    refreshDisk,
  };
}
