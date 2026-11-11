// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

import { initP2pUI } from './p2p-ui.js';
import { mergeP2P } from './p2p-channels.js';
import { artworkAllowed } from './p2p-safety.js';
import { DEFAULT_YPS, activeYps, isValidYpUrl, parseIndexTxt, streamUrl, playlistUrl, composeDetail, cleanDescription, mergeSameChannels } from './yp.js';
import { PLACEHOLDER_HELP, buildArgs, findPlayer, bbsMatches } from './launcher.js';
import { newFilter, compileFilter, filterMatches, evaluate, escapeRegex } from './filters.js';
import { initFilterUI, ask } from './filter-ui.js';
import { loadStore, saveStoreSoon, setStoreErrorHandler } from './store.js';
import { initRecUI } from './rec-ui.js';
import { initNotifyLog } from './notify-log.js';
import { FAV_DEFAULT, favColor, applyFavCss } from './fav-color.js';
import { initNarrowUI } from './narrow-ui.js';
import { canRecord, cleanDir } from './recording.js';
import { initMigrateUI } from './migrate-ui.js';
import { initYpErrorsUI } from './yp-errors-ui.js';
import { initUpdateCheck } from './update-check.js';
import { updateEnded, pruneEnded, playingRows, ENDED_KEEPS, DEFAULT_ENDED_KEEP, endedKeepOf, endedKeepLabel } from './ended.js';
import { linkify } from './links.js';
import { channelMedia, mediaButtons, artworkImage } from './channel-media.js';
import { eventSchedule, eventPriority, japanDay } from './events.js';
import { initActivityUI } from './activity-ui.js';
import { initRankingUI } from './ranking-ui.js';
import { longHours, longColor } from './yp.js';
import { BLOCK_OPS, newBlock, compileBlock, blockInvalid, blockNameMatches, blockNeedsHost, blockHostMatches, tipIp } from './blocks.js';

const tauri = window.__TAURI__;
const $ = (id) => document.getElementById(id);

// ---- 設定（%APPDATA% の settings.json に保存） ----
const LEGACY_SETTINGS_KEY = 'nexus.settings.v1'; // 0.1.0 の初期の版は localStorage に保存していた
const defaults = {
  fontSize: 13,
  theme: 'system',
  colWidths: {},
  rankColWidths: {}, // ランキング・勢いの表の列幅（rank-cols.js）
  sort: { key: 'listeners', desc: true },
  autoOn: true,
  autoSec: 60,
  peercast: 'localhost:7144',
  peercastPath: '',  // ペカステの実行ファイル。起動時に動いていなければ起動する（ペカレコと同じ）
  closeToTray: true, // 閉じるボタンでタスクトレイにしまう（終了はトレイのアイコンの右クリック）
  timeoutMs: 10000,
  // プレイヤー：{ enabled, path, args, type }
  players: [],
  p2pEnabled: false,
  p2pAutoActions: false,
  p2pArtworkEnabled: false,
  p2pHideListeners: false, // P2P の掲載でリスナー数・リレー数を非表示（-1）にする
  p2pBlocked: [],
  rankingEnabled: false,  // ランキング：ONの間だけ集計
  endedKeep: DEFAULT_ENDED_KEEP, // 終了タブに出しておく時間（分。'refresh' は次の更新まで）
  activityEnabled: false, // 掲示板の勢い：ONの間だけ計測
  updateCheck: true,       // 新しい版が出ていないか、GitHub の配布ページを見る
  activityMinutes: 15,     // 勢いの取得間隔（15・30・60分）。利用者が増えると同じ掲示板に皆が取りに行くので、短くても15分
  bbs: { path: '', urlRegex: '.*' },
  dblAction: 'play',
  detailOpen: true,
  listLayout: 'single',
  showMediaLinks: true,
  showListArtwork: false,
  showDetailArtwork: true,
  splitGenre: false,     // ジャンルを別の列に出す
  showOpenFree: false,   // 概要の <Open> / <Free> を表示する
  colOrder: [],          // 列の並び（空なら初期の並び）
  hiddenCols: [],        // 隠している列
  notifyFav: true,       // お気に入りが配信を始めたら通知
  notifyAllNew: false,   // 新着チャンネルをすべて通知
  notifyMode: 'auto',    // 'auto' 数秒で消える / 'sticky' 配信が終わるか確認するまで出し続ける
  notifySeconds: 8,
  notifyCorner: 'br',    // 通知を出す場所（br 右下 / tr 右上 / bl 左下 / tl 左上）
  notifyHideCapture: true, // 通知を配信ソフトの画面取り込みに映さない
  notifyWindows: false,  // Windows の通知も出す（インストールした版のみ）
  notifyFlash: true,     // タスクバーのアイコンを点滅
  soundOn: false,        // 通知音を鳴らす
  soundPath: '',         // 通知音のファイル（wav / mp3 / ogg）
  recDir: '',            // 録画の保存先（空なら初回にビデオ フォルダの中を使う）
  recSubFolder: true,    // チャンネルごとにフォルダを作る
  recWaitMin: 10,        // 切れたとき、戻ってくるのを待つ時間（分）
  recNotify: true,       // 録画を始めたとき・終わったときに通知する
  // YP：{ enabled, name, url }（上から順に取得して並べる）
  yps: DEFAULT_YPS.map((y) => ({ ...y })),
  midAction: 'none',     // 中クリックの動作
  favbarOpen: true,      // 配信中のお気に入りの帯を開いておく
  favColorLight: '',     // お気に入りの色（ライト）。空なら初めの色
  favColorDark: '',      // お気に入りの色（ダーク）
  favRowBg: true,        // お気に入りの行に背景の色を付ける
  docked: false,         // 画面の右端に張り付けている
  dockWidth: 160,        // 張り付けたときの幅（見た目の大きさ）。初めはいちばん細い幅
  dockLayer: 'bottom',   // 張り付けたときの重なり方：top 常に手前 / normal ふつう / bottom 最下面（初めは最下面）
  dockLayerSet: false,   // 重なり方を自分で選んだか（選んでいなければ、初めの値に合わせる）
  dockRestore: null,     // 張り付ける前の窓の位置と大きさ（元に戻すため）
  winRect: null,         // 窓の位置と大きさ（次の起動で戻す）
  winMax: false,         // 最大化していたか
  tools: [],             // ツール：{ enabled, name, path, args, browser }
  blocks: [],            // ブロックリスト（blocks.js）
};
const settings = structuredClone(defaults);
async function loadSettings() {
  let s = await loadStore('settings');
  if (!s) {
    // 前の版の設定を引き継ぐ
    try { s = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY) || 'null'); } catch { s = null; }
    if (s) saveSettings();
  }
  if (s) Object.assign(settings, s);
  // 0.2.8〜0.2.9 の初期の幅（340）のままなら、新しい初期の幅（いちばん細い）にする
  if (settings.dockWidth === 340) settings.dockWidth = defaults.dockWidth;
  // 重なり方を自分で選んでいなければ、初めの値（最下面）にする（0.2.9〜0.2.11 の初めの値は「常に手前」だった）
  if (!settings.dockLayerSet) settings.dockLayer = defaults.dockLayer;
  // 0.2.8 で「常に手前」を自分でオフにしていたら、「ふつう」として引き継ぐ
  if (s && 'dockTopmost' in s) {
    if (!s.dockLayer && s.dockTopmost === false) { settings.dockLayer = 'normal'; settings.dockLayerSet = true; }
    delete settings.dockTopmost;
  }
  applyTheme();
  applyFav();
  applyYps();
  applyBlocks();
}

// ---- ブロックリスト ----
let compiledBlocks = [];
const hostCache = new Map(); // IP → ホスト名（設定を変えるか、終了するまで覚えておく。ペカレコと同じ）
function applyBlocks() {
  compiledBlocks = settings.blocks.map(compileBlock);
  hostCache.clear();
}
function hostOf(ch) {
  const ip = tipIp(ch.tip);
  if (!ip || !tauri) return Promise.resolve('');
  if (!hostCache.has(ip)) hostCache.set(ip, tauri.core.invoke('resolve_host', { ip }).catch(() => ''));
  return hostCache.get(ip);
}
// op：manualRecord / autoRecord / manualPlay / autoPlay。当たったブロックを返す
async function blockedBy(ch, op) {
  for (const cb of compiledBlocks) {
    if (!blockNameMatches(cb, ch, op)) continue;
    if (!blockNeedsHost(cb) || blockHostMatches(cb, await hostOf(ch))) return cb.b;
  }
  return null;
}
const blockLabel = (b) => [b.name, b.host].filter(Boolean).join(' / ');
// 設定の YP 一覧から、取得に使う一覧を作る。外した YP のチャンネルは消す
function applyYps() {
  state.yps = activeYps(settings.yps);
  const names = new Set(state.yps.map((y) => y.name));
  for (const n of [...state.byYp.keys()]) if (!names.has(n)) { state.byYp.delete(n); state.ypStatus.delete(n); }
}
function saveSettings() {
  saveStoreSoon('settings', () => settings);
}

// ---- 統計URL（YP4G の getgmt.php） ----
// SP のように統計ページのある YP だけで出す。YP ごとに1回だけ、統計ページが開けるか確かめて覚える
const statsBase = new Map(); // YP の index.txt のURL → 統計ページの元のURL（なければ null）
const ypBase = (url) => url.replace(/index\.txt(\?.*)?$/i, '');
async function probeStats() {
  for (const yp of state.yps) {
    if (yp.event || statsBase.has(yp.url)) continue;
    statsBase.set(yp.url, null);
    try {
      const text = await fetchText(ypBase(yp.url) + 'getgmt.php?cn=');
      if (/Statistics/i.test(text)) statsBase.set(yp.url, ypBase(yp.url));
    } catch { /* 統計ページのない YP */ }
  }
}
function statsUrl(ch) {
  if (ch.p2pOnly || ch.info || ch.event) return '';
  for (const name of [ch.ypName, ...(ch.alsoYps || [])]) {
    const base = statsBase.get(state.yps.find((y) => y.name === name)?.url);
    if (base) return base + 'getgmt.php?cn=' + encodeURIComponent(ch.name);
  }
  return '';
}

// ---- 列の定義 ----
const COLUMNS = [
  { key: 'mark', label: '', w: 26, sortable: false },
  { key: 'name', label: 'チャンネル名', w: 160 },
  { key: 'genre', label: 'ジャンル', w: 110 },
  { key: 'detail', label: '詳細', w: 430 },
  { key: 'listeners', label: 'リスナー/リレー', w: 118, num: true, desc: true },
  { key: 'bitrate', label: 'kbps', w: 60, num: true, desc: true },
  { key: 'uptime', label: '時間', w: 62, num: true, desc: true },
  { key: 'ended', label: '終了', w: 56, num: true, desc: true }, // 「終了」タブだけに出す
  { key: 'type', label: '形式', w: 52 },
  { key: 'filter', label: 'フィルタ', w: 100 },
  { key: 'yp', label: 'YP', w: 76 },
  { key: 'tip', label: 'TIP', w: 150 },
];
const widthKey = (c) => c.key === 'name' && settings.listLayout === 'two' ? 'nameTwo' : c.key;
const colWidth = (c) => settings.colWidths[widthKey(c)] || (widthKey(c) === 'nameTwo' ? 590 : c.w);
// 並び替え・非表示ができない列（左端の印とチャンネル名）
const FIXED_COLS = ['mark', 'name'];
function orderedColumns() {
  const byKey = new Map(COLUMNS.map((c) => [c.key, c]));
  const keys = settings.colOrder.filter((k) => byKey.has(k) && !FIXED_COLS.includes(k));
  for (const c of COLUMNS) if (!FIXED_COLS.includes(c.key) && !keys.includes(c.key)) keys.push(c.key);
  return [...FIXED_COLS, ...keys].map((k) => byKey.get(k));
}
const columnAvailable = (c) => c.key === 'ended' ? state.tab === 'ended' : settings.listLayout === 'two'
  ? !['genre', 'detail'].includes(c.key)
  : c.key !== 'genre' || settings.splitGenre;
const visibleColumns = () => orderedColumns().filter((c) => columnAvailable(c) && !settings.hiddenCols.includes(c.key));

// ---- 状態 ----
const NEW_KEEP_MS = 15 * 60 * 1000;   // 新着として表示しておく時間
const GONE_KEEP_MS = 60 * 60 * 1000;  // 消えたチャンネルを覚えておく時間（この間に戻っても新着にしない）
const state = {
  p2pChannels: [],
  yps: [],                  // 使う YP（設定から作る：{ name, url, event }）
  byYp: new Map(),          // YP名 → チャンネルの配列
  ypStatus: new Map(),      // YP名 → { ok, count, error }
  firstSeen: new Map(),     // key → 初めて見た時刻（起動直後の分は 0）
  ended: new Map(),         // 終わった配信（key → 最後に見えたときの中身＋終わった時刻）。「終了」タブ
  playing: [],              // ペカステで再生中のチャンネル。「再生中」タブ
  lastSeen: new Map(),      // key → 最後に見た時刻
  loadedOnce: false,
  loading: false,
  lastUpdate: null,
  tab: 'all',
  search: '',
  selectedKey: null,
  nextRefreshAt: 0,
  filters: [],              // フィルタ（上にあるものが優先）
  compiled: [],
  evals: new Map(),         // key → { favorite, ignore, first }
  deltas: new Map(),        // key → 前回の更新からのリスナー数の増減
  justReturned: [],
  justNew: [],              // 今回の更新で新しく現れたチャンネルの key
  popups: [],               // 通知ポップアップ：{ key, sticky, expires }
};

// ---- フィルタ ----
async function loadFilters() {
  const s = await loadStore('filters');
  state.filters = (s?.filters || []).map((f) => newFilter(f));
}
function setFilters(list) {
  state.filters = list;
  saveStoreSoon('filters', () => ({ version: 1, filters: state.filters }));
  applyFilters();
  render();
}
function applyFilters() {
  state.compiled = state.filters.map(compileFilter);
  state.evals = new Map();
  for (const ch of allChannels()) {
    state.evals.set(ch.key, evaluate(state.compiled, ch, { isNew: isNew(ch) }));
  }
}
const NO_MATCH = { favorite: null, ignore: null, record: null, first: null };
const evalOf = (ch) => state.evals.get(ch.key) || NO_MATCH;
function matchCount(f) {
  const cf = compileFilter(f);
  return allChannels().filter((ch) => filterMatches(cf, ch, { isNew: isNew(ch) })).length;
}

// ---- 取得 ----
async function fetchText(url) {
  if (tauri) return tauri.core.invoke('fetch_text', { url, timeoutMs: settings.timeoutMs });
  // ブラウザで画面だけ確認するとき用
  const res = await fetch(url);
  if (!res.ok) throw new Error('サーバーの応答: ' + res.status);
  return res.text();
}

// 手で更新するときの最短の間隔（YP に負担をかけないように、連打しても30秒に1回まで）
const MANUAL_GAP_MS = 30_000;
const manualWait = () => Math.max(0, (state.fetchedAt || 0) + MANUAL_GAP_MS - Date.now());

function manualRefresh() {
  const wait = manualWait();
  if (wait > 0) { toast(`あと${Math.ceil(wait / 1000)}秒で更新できます`); return; }
  refresh();
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  state.fetchedAt = Date.now();
  $('refresh').disabled = true;
  $('st-time').textContent = '更新中…';
  const observed = settings.p2pAutoActions ? state.p2pChannels.slice() : [];
  const before = allChannels();
  const prev = new Map(before.map((c) => [c.key, c.listeners]));
  await Promise.all(state.yps.map(async (yp) => {
    try {
      const text = await fetchText(yp.url);
      if (!state.yps.some((y) => y.name === yp.name && y.url === yp.url)) return;
      const list = parseIndexTxt(text, yp);
      observed.push(...list);
      state.byYp.set(yp.name, list);
      state.ypStatus.set(yp.name, { ok: true, count: list.filter((c) => !c.info).length });
    } catch (e) {
      if (!state.yps.some((y) => y.name === yp.name && y.url === yp.url)) return;
      // 失敗したYPは前回の内容を残す
      state.ypStatus.set(yp.name, { ok: false, error: String(e) });
    }
  }));
  updateEnded(state.ended, before, allChannels(), Date.now(), settings.endedKeep);
  void probeStats();
  rankingUI.observe(observed);
  activityUI.sync();
  markNew();
  state.deltas = new Map();
  for (const c of allChannels()) {
    const p = prev.get(c.key);
    if (p !== undefined && p >= 0 && c.listeners >= 0 && c.listeners !== p) state.deltas.set(c.key, c.listeners - p);
  }
  applyFilters();
  syncPopups();
  notifyNew();
  recUI.onRefresh();
  state.loadedOnce = true;
  state.loading = false;
  state.lastUpdate = new Date();
  state.nextRefreshAt = Date.now() + settings.autoSec * 1000;
  syncRefreshButton();
  render();
}

// 更新ボタンは、取得中と、前の取得から30秒たつまでは押せない
function syncRefreshButton() {
  const wait = manualWait();
  $('refresh').disabled = state.loading || wait > 0;
  $('refresh').title = state.loading ? '更新中' : wait > 0 ? `あと${Math.ceil(wait / 1000)}秒で更新できます` : '更新';
}

function allChannels() {
  return mergeP2P(mergeSameChannels(state.yps.flatMap((yp) => state.byYp.get(yp.name) || [])), state.p2pChannels);
}

function markNew() {
  const now = Date.now();
  state.justNew = [];
  state.justReturned = []; // いったん消えて、1時間以内に戻ってきた配信（通知ログ用）
  for (const ch of allChannels()) {
    if (ch.info || ch.event) continue;
    const last = state.lastSeen.get(ch.key);
    if (!state.loadedOnce) {
      state.firstSeen.set(ch.key, 0);
    } else if (last === undefined || now - last > GONE_KEEP_MS) {
      state.firstSeen.set(ch.key, now);
      state.justNew.push(ch.key);
    } else if (now - last > Math.max(settings.autoSec * 1500, 90_000)) {
      state.justReturned.push(ch.key);
    }
    state.lastSeen.set(ch.key, now);
  }
}

function isNew(ch) {
  const t = state.firstSeen.get(ch.key);
  return !!t && Date.now() - t < NEW_KEEP_MS;
}

// ---- 表示 ----
function detailText(ch) {
  return composeDetail(ch, { showOpenFree: settings.showOpenFree, splitGenre: settings.listLayout !== 'two' && settings.splitGenre });
}

function matchesSearch(ch) {
  if (!state.search) return true;
  const q = state.search.toLowerCase();
  return [ch.name, ch.genre, ch.detail, ch.comment].some((s) => (s || '').toLowerCase().includes(q));
}

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
function sortValue(ch, key) {
  switch (key) {
    case 'listeners': return ch.listeners;
    case 'bitrate': return ch.bitrate;
    case 'uptime': return ch.uptimeMin;
    case 'detail': return detailText(ch);
    case 'yp': return ch.ypName;
    case 'filter': return evalOf(ch).first?.name ?? '';
    case 'ended': return ch.ended || 0;
    default: return ch[key] ?? '';
  }
}
function sorted(list) {
  const { key, desc } = settings.sort;
  return list.slice().sort((a, b) => {
    const priority = eventPriority(a) - eventPriority(b);
    if (priority) return priority; // 当日のイベントは先頭、その他のイベントは末尾
    if (a.info !== b.info) return a.info ? 1 : -1;
    const va = sortValue(a, key), vb = sortValue(b, key);
    const r = typeof va === 'number' ? va - vb : collator.compare(String(va), String(vb));
    return desc ? -r : r;
  });
}

function visibleChannels() {
  // NG に当たったチャンネルはどのタブにも出さない
  // YP のお知らせ行は一覧に出さず、「YPからのお知らせ」にまとめる
  const base = state.tab === 'ended' ? [...state.ended.values()]
    : state.tab === 'playing' ? playingChannels()
    : allChannels();
  let list = base.filter((c) => !c.info && !evalOf(c).ignore);
  if (state.tab === 'new') list = list.filter((c) => isNew(c));
  if (state.tab === 'fav') list = list.filter((c) => evalOf(c).favorite);
  return sorted(list.filter(matchesSearch));
}

function renderHead() {
  $('table').classList.toggle('two-line', settings.listLayout === 'two');
  const two = settings.listLayout === 'two';
  setBtn('layout-toggle', two ? '▤' : '☰', two ? '2行' : '1行', `表示：${two ? '2行' : '1行'}（クリックで${two ? '1行' : '2行'}）`);
  $('layout-toggle').setAttribute('aria-pressed', String(settings.listLayout === 'two'));
  const cols = $('cols'), head = $('head');
  cols.replaceChildren();
  head.replaceChildren();
  let total = 0;
  for (const c of visibleColumns()) {
    const col = document.createElement('col');
    col.style.width = colWidth(c) + 'px';
    total += colWidth(c);
    cols.appendChild(col);
    const th = document.createElement('th');
    th.textContent = c.key === 'name' && settings.listLayout === 'two' ? 'チャンネル / 配信詳細' : c.label;
    if (c.num) th.classList.add('num');
    if (settings.sort.key === c.key) {
      th.classList.add('sorted');
      const a = document.createElement('span');
      a.className = 'arrow';
      a.textContent = settings.sort.desc ? '▼' : '▲';
      th.appendChild(a);
    }
    th.dataset.key = c.key;
    th.addEventListener('contextmenu', (e) => { e.preventDefault(); openColumnMenu(e.clientX, e.clientY, c); });
    if (!FIXED_COLS.includes(c.key)) th.addEventListener('mousedown', (e) => startColumnDrag(e, c, th));
    if (c.sortable !== false) {
      th.addEventListener('click', () => {
        if (resizing) return; // 列幅を変えた・列を動かした直後のクリックでは並べ替えない
        if (settings.sort.key === c.key) settings.sort.desc = !settings.sort.desc;
        else settings.sort = { key: c.key, desc: !!c.desc };
        saveSettings();
        render();
      });
    }
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.addEventListener('mousedown', (e) => startResize(e, c, col));
    grip.addEventListener('click', (e) => e.stopPropagation());
    th.appendChild(grip);
    head.appendChild(th);
  }
  $('table').style.width = total + 'px';
}

function mediaLinkGroup(media) {
  const span = document.createElement('span');
  span.className = 'media-links';
  span.tabIndex = 0;
  span.setAttribute('aria-label', '関連URL（横にスクロールできます）');
  span.appendChild(mediaButtons(media));
  return span;
}

function cell(text, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text;
  return td;
}

// 列ごとのセルの作り方
// 一覧の左端の印（1つだけ出す）。優先する順：お知らせ・イベントYP → 録画中 → 新（新着） → 長（12時間以上）
// 札を名前や詳細の前に入れると字下げになるので、左端の列にまとめる
function markEl(ch) {
  const span = (cls, text, title) => {
    const m = document.createElement('span');
    m.className = cls;
    if (text) m.textContent = text;
    if (title) m.title = title;
    return m;
  };
  if (ch.info) return span('mk info');
  if (ch.event) return span('mk event');
  if (recUI.isRecording(ch)) return span('mk rec', '', '録画中');
  if (ch.ended) return null; // 終わった配信には「新」「長」を付けない
  if (isNew(ch)) return span('mbadge new', '新', '新着');
  const h = longHours(ch);
  if (h) {
    const m = span('mbadge long', '長', `長時間の配信（${ch.uptime}）`);
    m.style.setProperty('--lc', longColor(h));
    return m;
  }
  return null;
}

const CELLS = {
  mark(ch) {
    const td = cell('', 'mark');
    const m = markEl(ch);
    if (m) td.appendChild(m);
    return td;
  },
  name(ch) {
    const td = cell('', 'c-name');
    if (ch.event) {
      const schedule = eventSchedule(ch);
      const badge = document.createElement('span');
      badge.className = 'badge event-countdown';
      badge.textContent = schedule.label;
      td.append(badge);
    }
    td.append(document.createTextNode(ch.name));
    if (ch.event) td.title = eventSchedule(ch).label + ' ' + ch.name;
    return td;
  },
  genre: (ch) => cell(ch.genre, 'c-genre'),
  detail(ch) {
    const td = cell('', 'c-detail');
    const text = document.createElement('span');
    text.className = 'detail-copy';
    text.appendChild(linkify(detailText(ch)));
    td.appendChild(text);
    td.title = detailText(ch);
    return td;
  },
  listeners(ch) {
    const td = cell(ch.listeners < 0 ? '−' : `${ch.listeners} / ${Math.max(ch.relays, 0)}`, 'num');
    td.appendChild(deltaEl(state.deltas.get(ch.key)));
    return td;
  },
  bitrate: (ch) => cell(String(ch.bitrate), 'num'),
  uptime: (ch) => cell(ch.uptime, 'num'),
  type: (ch) => cell(ch.type, 'c-type'),
  filter: (ch, ev) => cell(ev.first?.name ?? '', 'c-filter'),
  yp: (ch) => { const td=cell(ch.sourceLabel || ch.ypName, 'c-yp'); if(ch.p2pConflict) td.title='同じチャンネルIDを複数の掲載者が共有しています。掲載者の本人性は確認されていません。'; return td; },
  tip: (ch) => cell(ch.tip, 'c-tip'),
  ended: (ch) => cell(ch.ended ? new Date(ch.ended).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '', 'num'),
};

function twoLineCell(ch) {
  const td = cell('', 'c-name c-summary');
  const media = channelMedia(ch);
  const wrap = document.createElement('div');
  wrap.className = 'channel-summary';
  const art = settings.showListArtwork && artworkAllowed(ch, settings) ? artworkImage(media, ch.name) : null;
  if (art) wrap.appendChild(art);
  const copy = document.createElement('div');
  copy.className = 'channel-copy';
  const head = document.createElement('div');
  head.className = 'channel-heading';
  const name = document.createElement('span');
  name.className = 'channel-title';
  name.append(...CELLS.name(ch).childNodes);
  head.appendChild(name);
  if (settings.showMediaLinks && media.links.length) head.appendChild(mediaLinkGroup(media));
  const desc = document.createElement('div');
  desc.className = 'channel-description';
  const detail = CELLS.detail(ch);
  desc.append(...detail.childNodes);
  desc.title = detail.title;
  copy.append(head, desc);
  wrap.appendChild(copy);
  td.appendChild(wrap);
  return td;
}

function renderBody() {
  const body = $('body');
  const list = visibleChannels();
  if (isNarrow()) narrowUI.renderList(list);
  const frag = document.createDocumentFragment();
  for (const ch of list) {
    const tr = document.createElement('tr');
    tr.dataset.key = ch.key;
    if (ch.info) tr.classList.add('info');
    if (ch.event) {
      tr.classList.add('event');
      const schedule = eventSchedule(ch);
      if (schedule.soon) tr.classList.add('event-soon');
      if (schedule.today) tr.classList.add('event-today');
    }
    if (ch.key === state.selectedKey) tr.classList.add('sel');
    const ev = evalOf(ch);
    if (ev.favorite) tr.classList.add('fav');
    // フィルタで色を指定しているとき（上にあるフィルタが優先）
    const colored = state.compiled.find((cf) => (cf.f.color.text || cf.f.color.bg) && ev.first && filterMatches(cf, ch, { isNew: isNew(ch) }));
    if (colored) {
      if (colored.f.color.text) { tr.style.setProperty('--row-text', colored.f.color.text); tr.classList.add('has-text'); }
      if (colored.f.color.bg) { tr.style.setProperty('--row-bg', colored.f.color.bg); tr.classList.add('has-bg'); }
    }

    for (const c of visibleColumns()) {
      tr.appendChild(c.key === 'name' && settings.listLayout === 'two' ? twoLineCell(ch) : CELLS[c.key](ch, ev));
    }
    frag.appendChild(tr);
  }
  body.replaceChildren(frag);

  const empty = $('empty');
  if (list.length === 0) {
    empty.hidden = false;
    empty.textContent = !state.loadedOnce ? '読み込み中…'
      : state.search ? '検索に一致するチャンネルはありません'
      : state.tab === 'new' ? '新着のチャンネルはまだありません'
      : state.tab === 'ended' ? (endedKeepOf(settings.endedKeep) === 'refresh' ? '前回の更新から終わった配信はありません' : `この${endedKeepLabel(settings.endedKeep)}に終わった配信はありません`)
      : state.tab === 'playing' ? 'ペカステで再生しているチャンネルはありません'
      : state.tab === 'fav' ? (state.filters.length ? 'お気に入りのチャンネルは配信していません' : 'お気に入りはまだありません。チャンネルを右クリック →「お気に入りに追加」か、フィルタタブでペカレコの Filter.xml を読み込めます')
      : 'チャンネルを取得できませんでした';
  } else {
    empty.hidden = true;
  }
}

function renderCounts() {
  const all = allChannels().filter((c) => !c.info && !c.event && !evalOf(c).ignore);
  $('n-all').textContent = all.length;
  $('n-new').textContent = all.filter(isNew).length;
  $('n-fav').textContent = all.filter((c) => evalOf(c).favorite).length;
  $('n-ended').textContent = [...state.ended.values()].filter((c) => !evalOf(c).ignore).length;
  $('n-playing').textContent = state.playing.length;
  $('n-filter').textContent = state.filters.length;

  ypErrorsUI.render();
  if (state.lastUpdate) {
    $('st-time').textContent = '最終更新 ' + state.lastUpdate.toLocaleTimeString('ja-JP');
  }
}

function deltaEl(d) {
  const s = document.createElement('span');
  s.className = 'delta';
  if (d) {
    s.classList.add(d > 0 ? 'up' : 'down');
    s.textContent = (d > 0 ? '▲' : '▼') + Math.abs(d);
  }
  return s;
}

function tag(text, cls) {
  const t = document.createElement('span');
  t.className = 'tag' + (cls ? ' ' + cls : '');
  t.textContent = text;
  return t;
}

function statPill(el, label, value, d) {
  const i = document.createElement('i');
  i.textContent = label;
  el.replaceChildren(i, document.createTextNode(' ' + value));
  if (d) {
    const sm = document.createElement('span');
    sm.className = d > 0 ? 'up' : 'down';
    sm.textContent = (d > 0 ? '▲' : '▼') + Math.abs(d);
    el.appendChild(sm);
  }
}

function renderDetail() {
  const panel = $('detail');
  // 録画タブでは、チャンネルの詳細は出さない（録画の一覧を広く使う）
  const open = settings.detailOpen && state.tab !== 'p2p' && state.tab !== 'rec' && state.tab !== 'ranking' && state.tab !== 'activity';
  panel.hidden = !open;
  $('detail-toggle').hidden = state.tab === 'p2p' || state.tab === 'rec' || state.tab === 'ranking' || state.tab === 'activity';
  $('detail-toggle').textContent = settings.detailOpen ? '詳細 ▾' : '詳細 ▴';
  if (!open) return;
  const ch = findChannel(state.selectedKey);
  panel.classList.toggle('fav', !!(ch && evalOf(ch).favorite));
  $('dt-play').disabled = !ch;
  $('dt-fav').disabled = !ch;
  if (!ch) {
    $('dt-art').replaceChildren();
    $('dt-track').textContent = '';
    $('dt-name').textContent = '';
    $('dt-tags').replaceChildren();
    $('dt-desc').textContent = 'チャンネルを選ぶと、ここに詳細が出ます';
    $('dt-url').replaceChildren();
    for (const id of ['dt-lis', 'dt-time', 'dt-kbps']) $(id).replaceChildren();
    $('dt-fav').textContent = '☆';
    $('dt-fav').classList.remove('on');
    return;
  }
  $('dt-name').textContent = ch.name;
  const ev = evalOf(ch);
  const media = channelMedia(ch);
  const art = settings.showDetailArtwork && artworkAllowed(ch, settings) ? artworkImage(media, ch.name) : null;
  $('dt-art').replaceChildren(...(art ? [art] : []));
  $('dt-track').textContent = media.text;
  const tags = [];
  if (ev.favorite) tags.push(tag('★ ' + ev.favorite.name, 'fav'));
  if (isNew(ch)) tags.push(tag('新着'));
  if (longHours(ch)) tags.push(tag(`長時間（${ch.uptime}）`));
  if (ch.event) tags.push(tag(eventSchedule(ch).label));
  $('dt-tags').replaceChildren(...(settings.showMediaLinks ? [mediaButtons(media)] : []), ...tags);
  const desc = $('dt-desc');
  desc.replaceChildren(linkify(cleanDescription(ch.detail, settings.showOpenFree)));
  if (ch.comment) {
    const c = document.createElement('span');
    c.className = 'cmt';
    c.append(' 「', linkify(ch.comment), '」');
    desc.appendChild(c);
  }
  // コンタクトURL は掲示板なので、設定した掲示板ブラウザで開く
  const url = $('dt-url');
  url.replaceChildren();
  if (ch.contactUrl) {
    const a = document.createElement('a');
    a.className = 'lnk';
    a.dataset.bbs = '1';
    a.textContent = ch.contactUrl;
    url.appendChild(a);
  }
  statPill($('dt-lis'), 'リスナー', ch.listeners < 0 ? '−' : String(ch.listeners), state.deltas.get(ch.key));
  statPill($('dt-time'), '時間', ch.uptime || '−');
  statPill($('dt-kbps'), 'kbps', String(ch.bitrate));
  const player = findPlayer(settings.players, ch);
  $('dt-play').disabled = !player;
  $('dt-play').title = player ? fileName(player.path) + ' で再生' : `${ch.type || 'この形式'} のプレイヤーが未設定（⚙ 設定）`;
  $('dt-fav').textContent = ev.favorite ? '★' : '☆';
  $('dt-fav').title = ev.favorite ? 'お気に入りから外す' : 'お気に入りに追加';
  $('dt-fav').classList.toggle('on', !!ev.favorite);
}

function renderFavbar() {
  const favs = sorted(allChannels().filter((c) => !c.info && !evalOf(c).ignore && evalOf(c).favorite));
  $('favbar').hidden = favs.length === 0;
  $('favbar').classList.toggle('closed', !settings.favbarOpen);
  $('favbar-n').textContent = favs.length;
  $('favbar-arrow').textContent = settings.favbarOpen ? '▾' : '▸';
  const chips = favs.map((ch) => {
    const b = document.createElement('button');
    b.className = 'chip' + (ch.key === state.selectedKey ? ' sel' : '');
    b.dataset.key = ch.key;
    b.title = detailText(ch);
    const dot = document.createElement('span');
    dot.className = 'live';
    const name = document.createElement('b');
    name.textContent = ch.name;
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = ch.listeners < 0 ? '' : String(ch.listeners);
    b.append(dot, name, cnt);
    const d = state.deltas.get(ch.key);
    if (isNew(ch) || d > 0) {
      const up = document.createElement('span');
      up.className = 'up';
      up.textContent = isNew(ch) ? 'NEW' : '▲' + d;
      b.appendChild(up);
    }
    return b;
  });
  $('chips').replaceChildren(...chips);
}

function noticeChannels() {
  return allChannels().filter((c) => c.info);
}
function renderNotices() {
  const list = noticeChannels();
  $('notice-btn').hidden = list.length === 0;
  $('n-notice').textContent = list.length;
  const pop = $('notice-pop');
  pop.replaceChildren(...list.map((c) => {
    const it = document.createElement('div');
    it.className = 'it';
    const yp = document.createElement('span');
    yp.className = 'yp';
    yp.textContent = c.ypName;
    const b = document.createElement('b');
    b.textContent = c.name;
    const t = document.createElement('span');
    t.appendChild(linkify([c.genre, c.detail, c.comment].filter(Boolean).join(' ')));
    it.append(yp, b, t);
    // コンタクトURL（SP の帯域チェックなど）。クリックでブラウザで開く
    if (c.contactUrl) {
      const a = document.createElement('a');
      a.className = 'lnk url';
      a.dataset.url = c.contactUrl;
      a.textContent = c.contactUrl;
      it.append(a);
    }
    return it;
  }));
  if (list.length === 0) pop.hidden = true;
}

function renderStatusUrl() {
  renderDetail();
  for (const c of $('chips').children) c.classList.toggle('sel', c.dataset.key === state.selectedKey);
}

function render() {
  renderHead();
  renderBody();
  renderCounts();
  renderFavbar();
  renderNotices();
  renderStatusUrl();
  if (state.tab === 'p2p') p2pUI.render();
  if (state.tab === 'ranking') rankingUI.render();
  if (state.tab === 'activity') activityUI.render();
  if (state.tab === 'filter') filterUI.renderFilterView();
}

function findChannel(key) {
  if (!key) return null;
  return allChannels().find((c) => c.key === key) || state.ended.get(key) || playingChannels().find((c) => c.key === key) || null;
}

// 「再生中」タブの行：ペカステで再生中のチャンネルを、一覧の行（なければ終わった配信の行、それもなければペカステの情報）で出す
function playingChannels() {
  return playingRows(state.playing, allChannels(), [...state.ended.values()]);
}

// ペカステに、今再生しているチャンネルを10秒ごとに聞く（ペカステが動いていなければ空）
async function pollPlaying() {
  if (!tauri) return;
  let list = [];
  try { list = await tauri.core.invoke('peercast_playing', { peercast: settings.peercast }); } catch { list = []; }
  if (JSON.stringify(list) === JSON.stringify(state.playing)) return;
  state.playing = list;
  renderCounts();
  if (state.tab === 'playing') render();
}
setInterval(pollPlaying, 10_000);
setTimeout(pollPlaying, 2_000);

// ---- 列幅の変更 ----
let resizing = false;
function startResize(e, c, col) {
  e.preventDefault();
  e.stopPropagation();
  resizing = true;
  const startX = e.clientX;
  const startW = colWidth(c);
  const table = $('table');
  const startTotal = visibleColumns().reduce((sum, v) => sum + colWidth(v), 0);
  const move = (ev) => {
    const w = Math.max(30, startW + ev.clientX - startX);
    col.style.width = w + 'px';
    table.style.width = (startTotal + w - startW) + 'px';
    settings.colWidths[widthKey(c)] = w;
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    saveSettings();
    // mouseup の直後に見出しの click が届くので、それが済んでから解除する
    setTimeout(() => { resizing = false; }, 0);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// ---- 選択と右クリックメニュー ----
function select(key) {
  state.selectedKey = key;
  for (const tr of $('body').children) tr.classList.toggle('sel', tr.dataset.key === key);
  narrowUI.markSelected(key);
  renderStatusUrl();
}

$('body').addEventListener('mousedown', (e) => {
  if (e.target.closest('a.lnk')) return;
  const tr = e.target.closest('tr');
  if (tr) select(tr.dataset.key);
});

$('body').addEventListener('contextmenu', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  e.preventDefault();
  select(tr.dataset.key);
  const ch = findChannel(tr.dataset.key);
  if (ch) openMenu(e.clientX, e.clientY, ch);
});

// 何もない所の右クリックで、ブラウザの標準メニュー（印刷・更新など）を出さない。
// 文字の入力欄と、文字を選んでいるとき（コピー用）だけは標準メニューを残す
document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return;
  if (e.target.closest('input, textarea, [contenteditable]') || String(window.getSelection())) return;
  e.preventDefault();
});

function menuItem(label, action, enabled = true) {
  const it = document.createElement('div');
  it.className = 'it' + (enabled ? '' : ' disabled');
  it.textContent = label;
  it.addEventListener('click', () => { closeMenu(); action(); });
  return it;
}

function showMenu(x, y) {
  const menu = $('menu');
  menu.classList.add('open');
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
}

// ---- 列の表示/非表示と並び替え ----
function setColumnHidden(key, hidden) {
  const set = new Set(settings.hiddenCols);
  if (hidden) set.add(key); else set.delete(key);
  settings.hiddenCols = [...set];
  saveSettings();
  render();
}
function columnChecklist(menu) {
  for (const c of orderedColumns()) {
    if (FIXED_COLS.includes(c.key) || !columnAvailable(c)) continue;
    const shown = !settings.hiddenCols.includes(c.key);
    const it = menuItem(c.label, () => setColumnHidden(c.key, shown));
    it.classList.add(shown ? 'check' : 'uncheck');
    menu.appendChild(it);
  }
  menu.appendChild(document.createElement('hr'));
  menu.appendChild(menuItem('列の並び・幅・表示を元に戻す', () => {
    settings.colOrder = [];
    settings.hiddenCols = [];
    settings.colWidths = {};
    saveSettings();
    render();
  }));
}
function openColumnMenu(x, y, c) {
  const menu = $('menu');
  menu.replaceChildren();
  if (!FIXED_COLS.includes(c.key)) {
    menu.appendChild(menuItem(`「${c.label}」を隠す`, () => setColumnHidden(c.key, true)));
    menu.appendChild(document.createElement('hr'));
  }
  const g = document.createElement('div');
  g.className = 'group';
  g.textContent = '表示する列';
  menu.appendChild(g);
  columnChecklist(menu);
  showMenu(x, y);
}
$('layout-toggle').addEventListener('click', () => {
  settings.listLayout = settings.listLayout === 'two' ? 'single' : 'two';
  saveSettings();
  render();
});
$('open-cols').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('menu');
  menu.replaceChildren();
  const g = document.createElement('div');
  g.className = 'group';
  g.textContent = '表示する列（見出しを左右にドラッグで並び替え）';
  menu.appendChild(g);
  columnChecklist(menu);
  const r = $('open-cols').getBoundingClientRect();
  showMenu(r.left, r.bottom + 4);
});
$('open-cols').addEventListener('mousedown', (e) => e.stopPropagation());

function startColumnDrag(e, c, th) {
  if (e.button !== 0 || e.target.closest('.grip')) return;
  const startX = e.clientX;
  let dragging = false;
  let mark = null;
  let target = null; // { key, after }
  const ths = () => [...$('head').children].filter((t) => t.dataset.key && !FIXED_COLS.includes(t.dataset.key));
  const move = (ev) => {
    if (!dragging) {
      if (Math.abs(ev.clientX - startX) < 6) return;
      dragging = true;
      resizing = true; // 離したときの click で並べ替えが動かないように
      th.classList.add('dragging');
      mark = document.createElement('div');
      mark.className = 'drop-mark';
      document.body.appendChild(mark);
    }
    // マウスの位置にいちばん近い列の境目を探す
    let best = null;
    for (const t of ths()) {
      const r = t.getBoundingClientRect();
      for (const [x, after] of [[r.left, false], [r.right, true]]) {
        const d = Math.abs(ev.clientX - x);
        if (!best || d < best.d) best = { d, x, key: t.dataset.key, after, r };
      }
    }
    if (best) {
      target = best;
      mark.style.left = (best.x - 1) + 'px';
      mark.style.top = best.r.top + 'px';
      mark.style.height = $('list').getBoundingClientRect().bottom - best.r.top + 'px';
    }
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (!dragging) return;
    th.classList.remove('dragging');
    mark?.remove();
    setTimeout(() => { resizing = false; }, 0);
    if (!target || target.key === c.key) return;
    const order = orderedColumns().map((x) => x.key).filter((k) => !FIXED_COLS.includes(k) && k !== c.key);
    let i = order.indexOf(target.key);
    if (target.after) i += 1;
    order.splice(i, 0, c.key);
    settings.colOrder = order;
    saveSettings();
    render();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function openMenu(x, y, ch) {
  const menu = $('menu');
  menu.replaceChildren();
  // プレイヤーが未設定なら、押したときに案内を出す（play の中）
  menu.appendChild(menuItem('再生する', () => play(ch), !ch.info));
  // BBSブラウザを登録していなければ押せない（ブラウザで開くのは「コンタクトURLを開く」）
  menu.appendChild(menuItem('BBSブラウザで掲示板を開く', () => openBbs(ch), !!settings.bbs.path && !!ch.contactUrl));
  menu.appendChild(menuItem('コンタクトURLを開く', () => openUrl(ch.contactUrl), !!ch.contactUrl));
  // 統計URL：SP など統計ページのある YP の配信だけ（P2P だけの配信には出さない）
  const stats = statsUrl(ch);
  if (stats) menu.appendChild(menuItem('統計URLを開く', () => openUrl(stats)));
  if (recUI.isRecording(ch)) menu.appendChild(menuItem('録画を止める', () => recUI.stopChannel(ch)));
  else menu.appendChild(menuItem(canRecord(ch) || ch.info ? '録画をする' : `録画をする（${ch.type || '不明な形式'} は未対応）`, () => recUI.start(ch), canRecord(ch)));
  const p2pPublishers=ch.p2pOnly?(ch.p2pOwn?[]:[ch.publisher]):(ch.p2pSources||[]).filter(k=>!(ch.p2pOwnKeys||[]).includes(k));
  for(const [index,key] of p2pPublishers.entries())menu.appendChild(menuItem('このP2P掲載者をブロック'+(p2pPublishers.length>1?`（${index+1}）`:''),()=>p2pUI.block(key,ch.name)));
  const tools = settings.tools.filter((t) => t.enabled && (t.path || t.browser));
  if (tools.length) {
    menu.appendChild(document.createElement('hr'));
    const gt = document.createElement('div');
    gt.className = 'group';
    gt.textContent = 'ツール';
    menu.appendChild(gt);
    for (const t of tools) menu.appendChild(menuItem(t.name || fileName(t.path), () => runTool(t, ch), !ch.info));
  }
  menu.appendChild(document.createElement('hr'));
  const ev = evalOf(ch);
  if (ev.favorite) {
    menu.appendChild(menuItem(`お気に入りから外す（${ev.favorite.name}）`, () => removeFromFilter(ev.favorite, ch)));
    const g2 = document.createElement('div');
    g2.className = 'group';
    g2.textContent = `通知のしかた（フィルタ「${ev.favorite.name}」）`;
    menu.appendChild(g2);
    const cur = favoriteNotifyStyle(ev.favorite);
    for (const [v, label] of NOTIFY_STYLES) {
      const it = menuItem(label, () => setFavoriteNotifyStyle(ev.favorite, v));
      it.classList.add(cur === v ? 'check' : 'uncheck');
      menu.appendChild(it);
    }
    const g3 = document.createElement('div');
    g3.className = 'group';
    g3.textContent = `再生（フィルタ「${ev.favorite.name}」）`;
    menu.appendChild(g3);
    const ap = menuItem('新着時に自動再生する', () => setFavoriteAutoPlay(ev.favorite, !ev.favorite.favoriteOpts?.player));
    ap.classList.add(ev.favorite.favoriteOpts?.player ? 'check' : 'uncheck');
    menu.appendChild(ap);
  } else {
    menu.appendChild(menuItem('お気に入りに追加', () => quickFilter(ch, { favorite: true }), !ch.info));
  }
  menu.appendChild(menuItem('NGにする', () => quickFilter(ch, { ignore: true }), !ch.info));
  menu.appendChild(menuItem('このチャンネルでフィルタを作る…', () => filterUI.openEditor(channelFilter(ch, { favorite: true }), addFilterTop), !ch.info));
  menu.appendChild(document.createElement('hr'));
  const g = document.createElement('div');
  g.className = 'group';
  g.textContent = 'コピー';
  menu.appendChild(g);
  menu.appendChild(menuItem('チャンネル名', () => copy(ch.name)));
  menu.appendChild(menuItem('詳細', () => copy(detailText(ch))));
  menu.appendChild(menuItem('コンタクトURL', () => copy(ch.contactUrl), !!ch.contactUrl));
  menu.appendChild(menuItem('ストリームURL', () => copy(streamUrl(ch, settings.peercast)), !ch.info));
  menu.appendChild(menuItem('プレイリストURL', () => copy(playlistUrl(ch, settings.peercast)), !ch.info));
  menu.appendChild(menuItem('TIP（配信者のIP:ポート）', () => copy(ch.tip), !!ch.tip));
  showMenu(x, y);
}
function closeMenu() { $('menu').classList.remove('open'); }
window.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) closeMenu(); });
window.addEventListener('blur', closeMenu);

// ---- リンク・お気に入りの札・お知らせ・詳細パネル ----
// 一覧や詳細パネルの中の URL：クリックでブラウザで開く（行の選択や再生はしない）
document.addEventListener('click', (e) => {
  const a = e.target.closest('a.lnk');
  if (!a) return;
  e.preventDefault();
  e.stopPropagation();
  if (a.dataset.bbs) openBbs(findChannel(state.selectedKey));
  else openUrl(a.dataset.url);
}, true);
document.addEventListener('dblclick', (e) => {
  if (e.target.closest('a.lnk')) { e.preventDefault(); e.stopPropagation(); }
}, true);

// 札：クリックで選択（詳細パネルに出る）、ダブルクリックで再生
$('favbar-toggle').addEventListener('click', () => {
  settings.favbarOpen = !settings.favbarOpen;
  saveSettings();
  renderFavbar();
});
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (b) select(b.dataset.key);
});
$('chips').addEventListener('dblclick', (e) => {
  const b = e.target.closest('.chip');
  if (b) play(findChannel(b.dataset.key));
});

$('notice-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const pop = $('notice-pop');
  pop.hidden = !pop.hidden;
  if (!pop.hidden) {
    const r = $('notice-btn').getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px';
  }
});
window.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#notice-pop') && !e.target.closest('#notice-btn')) $('notice-pop').hidden = true;
});

$('detail-toggle').addEventListener('click', () => {
  settings.detailOpen = !settings.detailOpen;
  saveSettings();
  renderDetail();
});
$('dt-play').addEventListener('click', () => play(findChannel(state.selectedKey)));
function toggleFav(ch) {
  if (!ch) return;
  const ev = evalOf(ch);
  if (ev.favorite) removeFromFilter(ev.favorite, ch);
  else quickFilter(ch, { favorite: true });
}
$('dt-fav').addEventListener('click', () => toggleFav(findChannel(state.selectedKey)));

// ---- 通知 ----
// 新しく配信を始めたチャンネルのうち、通知するものを選んで Windows の通知と通知音を出す
function notifyNew() {
  const now = Date.now();
  // 通知ログ：お気に入り（と、新着すべてを通知する設定のときは通知したもの）について、出した・出さなかったを残す
  const log = [];
  const logOf = (ch, ev, extra) => log.push({ at: now, name: ch.name, yp: ch.ypName, filter: ev.favorite?.name || '', ...extra });
  if (!state.loadedOnce) {
    // 起動して最初の取得では通知しない
    for (const ch of allChannels()) {
      const ev = evalOf(ch);
      if (!ch.info && !ch.event && ev.favorite && !ev.ignore) logOf(ch, ev, { shown: false, reason: 'startup' });
    }
    notifyLog.add(log);
    return;
  }
  for (const key of state.justReturned) {
    const ch = findChannel(key);
    const ev = ch ? evalOf(ch) : null;
    if (ch && ev.favorite && !ev.ignore) logOf(ch, ev, { shown: false, reason: 'returned' });
  }
  const targets = [];
  const autoPlays = [];
  let alarm = null;
  for (const key of state.justNew) {
    const ch = findChannel(key);
    if (!ch || ch.info || ch.event) continue;
    const ev = evalOf(ch);
    if (ch.p2pOnly && !settings.p2pAutoActions) { if (ev.favorite) logOf(ch, ev, { shown: false, reason: 'p2p' }); continue; }
    if (ev.ignore) { if (ev.favorite) logOf(ch, ev, { shown: false, reason: 'ng' }); continue; }
    const style = ev.favorite ? favoriteNotifyStyle(ev.favorite) : null;
    const favNotify = ev.favorite && style !== 'none';
    // 「新着時に自動再生する」お気に入り（通知を出すかどうかとは別に決める）
    const played = !!ev.favorite?.favoriteOpts?.player;
    if (played) autoPlays.push(ch);
    if ((settings.notifyFav && favNotify) || (settings.notifyAllNew && style !== 'none')) {
      const sticky = (style && style !== 'default' ? style : settings.notifyMode) === 'sticky';
      targets.push({ ch, fav: !!ev.favorite, sticky });
      logOf(ch, ev, { shown: true, sticky, played });
      // ペカレコから引き継いだ、フィルタごとの通知音
      if (!alarm && ev.favorite?.notify?.alarm) alarm = ev.favorite.notify.alarm;
    } else if (ev.favorite) {
      logOf(ch, ev, { shown: false, reason: style === 'none' ? 'styleNone' : 'favOff', played });
    }
  }
  notifyLog.add(log);
  for (const ch of autoPlays) void play(ch, true);
  if (targets.length === 0) return;
  // お気に入りを先に
  targets.sort((a, b) => Number(b.fav) - Number(a.fav));
  let title, body;
  if (targets.length === 1) {
    title = `${targets[0].ch.name} が配信を始めました`;
    body = detailText(targets[0].ch);
  } else {
    title = `${targets.length} チャンネルが配信を始めました`;
    body = targets.slice(0, 5).map((t) => t.ch.name).join('、') + (targets.length > 5 ? ' ほか' : '');
  }
  for (const t of targets) addPopup(t.ch.key, t.sticky);
  if (settings.notifyWindows) showNotification(title, body);
  if (!tauri) toast(title);
  if (settings.notifyFlash && tauri) tauri.core.invoke('flash_taskbar').catch(() => {});
  if (alarm || settings.soundOn) playSound(alarm || settings.soundPath);
}

// ---- 通知ポップアップ（画面の隅に出す PecaList の通知） ----
// お気に入りの通知のしかた（ペカレコで「通知しない」にしていたものは 'none'）
function favoriteNotifyStyle(f) {
  if (f.notify?.notify === false && (f.notifyStyle || 'default') === 'default') return 'none';
  return f.notifyStyle || 'default';
}

function addPopup(key, sticky = settings.notifyMode === 'sticky') {
  state.popups = state.popups.filter((p) => p.key !== key);
  state.popups.unshift({ key, sticky, expires: sticky ? Infinity : Date.now() + settings.notifySeconds * 1000 });
  syncPopups();
}
function removePopup(key) {
  state.popups = state.popups.filter((p) => p.key !== key);
  syncPopups();
}
// 録画の通知など、チャンネルの配信開始ではないカード（中身をそのまま渡す）
function addCardPopup(key, card) {
  const sticky = settings.notifyMode === 'sticky';
  state.popups = state.popups.filter((p) => p.key !== key);
  state.popups.unshift({ key, sticky, card, expires: Date.now() + (sticky ? 3600_000 : settings.notifySeconds * 1000) });
  syncPopups();
  if (settings.notifyFlash && tauri) tauri.core.invoke('flash_taskbar').catch(() => {});
}
// 期限が来たもの・配信が終わったものを消して、通知の窓に一覧を送る
function syncPopups() {
  const now = Date.now();
  state.popups = state.popups.filter((p) => p.expires > now && (p.test || p.card || findChannel(p.key)));
  if (!tauri) return;
  const items = state.popups.map((p) => {
    if (p.card) return { key: p.key, sticky: p.sticky, ...p.card };
    const ch = p.test || findChannel(p.key);
    return {
      key: p.key, sticky: p.sticky, name: ch.name, detail: detailText(ch), ypName: ch.ypName,
      listeners: ch.listeners, fav: !!evalOf(ch).favorite || !!p.test,
    };
  });
  tauri.event.emitTo('notify', 'notify:list', {
    items, theme: settings.theme, fav: favOpts(), corner: settings.notifyCorner, hideFromCapture: settings.notifyHideCapture,
  }).catch(() => {});
}
setInterval(() => {
  const now = Date.now();
  if (state.popups.some((p) => p.expires <= now)) syncPopups();
}, 1000);

if (tauri) {
  tauri.event.listen('notify:ready', () => syncPopups());
  tauri.event.listen('notify:action', (e) => {
    const { action, key } = e.payload;
    if (key.startsWith('rec:')) { recUI.handleAction(action, key); return; }
    const ch = findChannel(key);
    if (action === 'dismiss') removePopup(key);
    else if (action === 'play' && ch) { play(ch); removePopup(key); }
    else if (action === 'bbs' && ch) openBbs(ch);
    else if (action === 'select' && ch) { select(key); tauri.core.invoke('show_if_hidden').catch(() => {}); }
  });
}

async function showNotification(title, body) {
  try {
    if (tauri) await tauri.core.invoke('show_notification', { title, body });
    else console.log('notify', title, body);
  } catch (e) {
    console.error(e);
  }
}

let soundUrl = { path: '', url: '' };
async function playSound(path) {
  if (!path) return;
  try {
    if (soundUrl.path !== path) {
      if (!tauri) { console.log('sound', path); return; }
      const buf = await tauri.core.invoke('read_sound_file', { path });
      if (soundUrl.url) URL.revokeObjectURL(soundUrl.url);
      soundUrl = { path, url: URL.createObjectURL(new Blob([buf])) };
    }
    await new Audio(soundUrl.url).play();
  } catch (e) {
    toast('通知音を鳴らせませんでした：' + e);
  }
}

const NOTIFY_STYLES = [
  ['sticky', '常時（配信が終わるか確認するまで出す）'],
  ['auto', '一瞬（数秒で消える）'],
  ['none', '通知しない'],
  ['default', '全体の設定に従う'],
];
function setFavoriteNotifyStyle(f, style) {
  const i = state.filters.indexOf(f);
  if (i < 0) return;
  const list = state.filters.slice();
  // ペカレコの「通知しない」設定も合わせて切り替える
  list[i] = { ...f, notifyStyle: style, notify: { ...f.notify, notify: style !== 'none' } };
  setFilters(list);
  toast(`「${f.name}」の通知：${NOTIFY_STYLES.find((x) => x[0] === style)[1]}`);
}

function setFavoriteAutoPlay(f, on) {
  const i = state.filters.indexOf(f);
  if (i < 0) return;
  const list = state.filters.slice();
  list[i] = { ...f, favoriteOpts: { ...f.favoriteOpts, player: on } };
  setFilters(list);
  toast(`「${f.name}」の新着時の自動再生：${on ? 'する' : 'しない'}`);
}

// ---- 右クリックからのフィルタ作成 ----
function channelFilter(ch, over) {
  const fields = { ...newFilter().base.fields };
  for (const k of Object.keys(fields)) fields[k] = k === 'channelName';
  // チャンネル名と完全に一致したときだけ当たるようにする
  return newFilter({ name: ch.name, base: { search: '^' + escapeRegex(ch.name) + '$', fields }, ...over });
}
function addFilterTop(f) {
  setFilters([f, ...state.filters]);
}
function quickFilter(ch, over) {
  addFilterTop(channelFilter(ch, over));
  toast(over.ignore ? `「${ch.name}」をNGにしました（フィルタタブで戻せます）` : `「${ch.name}」をお気に入りに追加しました`);
}
async function removeFromFilter(f, ch) {
  const simple = f.base.search === '^' + escapeRegex(ch.name) + '$';
  if (simple) {
    setFilters(state.filters.filter((x) => x !== f));
    toast(`「${ch.name}」をお気に入りから外しました`);
    return;
  }
  // 複数のチャンネルをまとめたフィルタ（ペカレコから読み込んだもの等）は、勝手に書き換えず確認する
  const r = await ask('お気に入りから外す', `「${ch.name}」はフィルタ「${f.name}」でお気に入りになっています。このフィルタには他のチャンネルも含まれている可能性があります。`, [
    { label: 'キャンセル', value: null },
    { label: 'フィルタを編集する', value: 'edit', primary: true },
  ]);
  if (r === 'edit') {
    const i = state.filters.indexOf(f);
    filterUI.openEditor(f, (nf) => { const list = state.filters.slice(); list[i] = nf; setFilters(list); });
  }
}

// ---- 再生・掲示板 ----
function fileName(path) {
  return (path || '').split(/[\\/]/).pop();
}


async function launch(path, args) {
  if (!tauri) { console.log('launch', path, args); toast('（画面確認用）起動：' + fileName(path)); return; }
  await tauri.core.invoke('launch', { path, args });
}

const argExtra = (ch) => ({ filterName: evalOf(ch).first?.name || '' });

// auto：お気に入りの新着の自動再生（ブロックリストの「自動の再生」で判定する）
async function play(ch, auto = false) {
  if (!ch || ch.info) return;
  const p = findPlayer(settings.players, ch);
  if (!p) {
    toast(`${ch.type || 'この形式'} に対応するプレイヤーが設定されていません（⚙ 設定）`);
    return;
  }
  const b = await blockedBy(ch, auto ? 'autoPlay' : 'manualPlay');
  if (b) { toast(`「${ch.name}」はブロックリスト（${blockLabel(b)}）に当たるので再生しません`); return; }
  try {
    await launch(p.path, buildArgs(p.args, ch, settings.peercast, argExtra(ch)));
  } catch (e) {
    toast(String(e));
  }
}

async function runTool(t, ch) {
  if (!ch || ch.info) return;
  const b = await blockedBy(ch, 'manualPlay');
  if (b) { toast(`「${ch.name}」はブロックリスト（${blockLabel(b)}）に当たるのでツールを起動しません`); return; }
  const args = buildArgs(t.args, ch, settings.peercast, argExtra(ch));
  try {
    if (t.browser) await openUrl(args.join(' '));
    else await launch(t.path, args);
  } catch (e) {
    toast(String(e));
  }
}

// ダブルクリック・中クリックの動作
function clickAction(action, ch) {
  if (!ch) return;
  if (action === 'play') play(ch);
  else if (action === 'bbs') openBbs(ch);
  else if (action === 'contact') openUrl(ch.contactUrl);
  else if (action === 'record') recUI.start(ch);
}

async function openBbs(ch) {
  if (!ch || !ch.contactUrl) return;
  if (bbsMatches(settings.bbs, ch.contactUrl)) {
    try {
      await launch(settings.bbs.path, [ch.contactUrl]);
      return;
    } catch (e) {
      toast(String(e));
      return;
    }
  }
  openUrl(ch.contactUrl);
}

$('body').addEventListener('dblclick', (e) => {
  const tr = e.target.closest('tr');
  clickAction(settings.dblAction, tr && findChannel(tr.dataset.key));
});
// 中クリック：ブラウザの自動スクロールを出さず、設定した動作をする
$('body').addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
$('body').addEventListener('auxclick', (e) => {
  if (e.target.closest('a.lnk')) return;
  if (e.button !== 1) return;
  const tr = e.target.closest('tr');
  if (!tr) return;
  e.preventDefault();
  select(tr.dataset.key);
  clickAction(settings.midAction, findChannel(tr.dataset.key));
});

async function openUrl(url) {
  if (!url) return;
  try {
    if (tauri) await tauri.core.invoke('plugin:opener|open_url', { url });
    else window.open(url, '_blank', 'noopener');
  } catch (e) {
    toast('URLを開けませんでした：' + e);
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('コピーしました');
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}

// ---- 上のボタン：入りきらないときは文字を隠して記号だけにする（内容はホバーで出る） ----
function setBtn(id, icon, label, title) {
  const b = $(id);
  b.querySelector('.ic').textContent = icon;
  b.querySelector('.lbl').textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  fitToolbar();
}
function fitToolbar() {
  const bar = document.querySelector('.toolbar');
  bar.classList.remove('compact');
  if (bar.scrollWidth > bar.clientWidth + 1) bar.classList.add('compact');
}
new ResizeObserver(fitToolbar).observe(document.querySelector('.toolbar'));

// ---- テーマ ----
const THEMES = ['system', 'light', 'dark'];
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  if (!THEMES.includes(settings.theme)) settings.theme = 'system';
  if (settings.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  const icons = { system: '◐', light: '☀', dark: '☾' };
  const labels = { system: '自動', light: 'ライト', dark: 'ダーク' };
  const next = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
  setBtn('theme-toggle', icons[settings.theme], labels[settings.theme], `テーマ：${labels[settings.theme]}（クリックで${labels[next]}）`);
  const resolved = settings.theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : settings.theme;
  if (tauri) tauri.core.invoke('set_titlebar_theme', { theme: resolved }).catch((e) => console.warn(e));
}
systemTheme.addEventListener('change', () => {
  if (settings.theme === 'system') { applyTheme(); syncPopups(); }
});
$('theme-toggle').addEventListener('click', () => {
  settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
  applyTheme();
  saveSettings();
  syncPopups();
});
// 自動更新を切っている間も、日本時間の日付が変わればイベントの位置と残り日数を更新する。
let calendarDay = japanDay();
setInterval(() => {
  const day = japanDay();
  if (calendarDay !== day) { calendarDay = day; render(); }
}, 30000);

// ---- タブ・検索・文字サイズ ----
function showTab(name) {
  state.tab = name;
  for (const t of $('tabs').children) t.classList.toggle('on', t.dataset.tab === name);
  const isP2p = name === 'p2p';
  $('p2p-view').hidden = !isP2p;
  const isFilter = name === 'filter', isRec = name === 'rec', isRank = name === 'ranking', isActivity = name === 'activity';
  $('list').hidden = isFilter || isRec || isRank || isActivity || isP2p;
  $('activity-view').hidden = !isActivity;
  $('ranking-view').hidden = !isRank;
  $('filter-view').hidden = !isFilter;
  $('rec-view').hidden = !isRec;
  renderDetail();
  if (isP2p) p2pUI.render();
  else if (isActivity) activityUI.render();
  else if (isRank) rankingUI.render();
  else if (isFilter) filterUI.renderFilterView();
  else if (isRec) recUI.show();
  else { renderHead(); renderBody(); } // 「終了」タブだけ「終了」の列があるので、見出しも作り直す
}
$('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) showTab(tab.dataset.tab);
});

$('search').addEventListener('input', (e) => {
  state.search = e.target.value.trim();
  renderBody();
});

function applyFont() {
  document.documentElement.style.setProperty('--font-size', settings.fontSize + 'px');
}
$('font-dec').addEventListener('click', () => { settings.fontSize = Math.max(10, settings.fontSize - 1); applyFont(); saveSettings(); });
$('font-inc').addEventListener('click', () => { settings.fontSize = Math.min(20, settings.fontSize + 1); applyFont(); saveSettings(); });

// ---- 更新ボタンと自動更新 ----
$('refresh').addEventListener('click', manualRefresh);
$('auto').addEventListener('click', () => {
  settings.autoOn = !settings.autoOn;
  state.nextRefreshAt = Date.now() + settings.autoSec * 1000;
  saveSettings();
  tickAuto();
});

function tickAuto() {
  syncRefreshButton();
  const auto = $('auto');
  auto.classList.toggle('off', !settings.autoOn);
  if (!settings.autoOn) {
    $('autotext').textContent = 'オフ';
    $('autobar').style.width = '0';
    return;
  }
  const left = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
  $('autotext').textContent = state.loading ? '更新中' : `あと ${left}秒`;
  $('autobar').style.width = (100 - (left / settings.autoSec) * 100) + '%';
  if (left === 0 && !state.loading && state.loadedOnce) refresh();
}
setInterval(tickAuto, 1000);

// ---- 設定画面 ----
let draftPlayers = [];

async function pickExe() {
  if (!tauri) return prompt('実行ファイルのパス（画面確認用）') || null;
  return tauri.core.invoke('plugin:dialog|open', {
    options: { multiple: false, directory: false, filters: [{ name: 'アプリ', extensions: ['exe'] }] },
  });
}

function iconBtn(label, title, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function renderPlayers() {
  const box = $('players');
  box.replaceChildren();
  if (draftPlayers.length === 0) {
    const n = document.createElement('div');
    n.className = 'none';
    n.textContent = 'プレイヤーがまだありません。「プレイヤーを追加」でお使いの実行ファイルを選ぶか、「ペカレコから引っ越す」で設定を取り込んでください。';
    box.appendChild(n);
    return;
  }
  const head = document.createElement('div');
  head.className = 'players-head';
  for (const t of ['', '実行ファイル', '', '引数', '形式', '', '', '']) {
    const s = document.createElement('span');
    s.textContent = t;
    head.appendChild(s);
  }
  box.appendChild(head);
  draftPlayers.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'player';
    const en = document.createElement('input');
    en.type = 'checkbox';
    en.checked = p.enabled;
    en.title = '使う';
    en.addEventListener('change', () => { p.enabled = en.checked; });
    const path = document.createElement('input');
    path.value = p.path;
    path.spellcheck = false;
    path.addEventListener('input', () => { p.path = path.value; });
    const browse = iconBtn('…', '参照', async () => {
      const f = await pickExe();
      if (f) { p.path = f; path.value = f; }
    });
    const args = document.createElement('input');
    args.value = p.args;
    args.spellcheck = false;
    args.addEventListener('input', () => { p.args = args.value; });
    const type = document.createElement('input');
    type.value = p.type;
    type.spellcheck = false;
    type.addEventListener('input', () => { p.type = type.value; });
    const up = iconBtn('↑', '上へ', () => { if (i > 0) { [draftPlayers[i - 1], draftPlayers[i]] = [draftPlayers[i], draftPlayers[i - 1]]; renderPlayers(); } });
    const down = iconBtn('↓', '下へ', () => { if (i < draftPlayers.length - 1) { [draftPlayers[i + 1], draftPlayers[i]] = [draftPlayers[i], draftPlayers[i + 1]]; renderPlayers(); } });
    const del = iconBtn('✕', '削除', () => { draftPlayers.splice(i, 1); renderPlayers(); });
    row.append(en, path, browse, args, type, up, down, del);
    box.appendChild(row);
  });
}

// ---- 設定画面：YP ----
let draftYps = [];
function renderYps() {
  const box = $('yps');
  box.replaceChildren();
  if (draftYps.length === 0) {
    const n = document.createElement('div');
    n.className = 'none';
    n.textContent = 'YP がありません。「初めからあるYPを足す」か「YPを追加」から足してください。';
    box.appendChild(n);
    return;
  }
  const head = document.createElement('div');
  head.className = 'players-head';
  for (const t of ['', '名前', 'アドレス', '', '', '']) {
    const s = document.createElement('span');
    s.textContent = t;
    head.appendChild(s);
  }
  box.appendChild(head);
  draftYps.forEach((y, i) => {
    const row = document.createElement('div');
    row.className = 'player' + (y.enabled ? '' : ' off');
    const en = document.createElement('input');
    en.type = 'checkbox';
    en.checked = y.enabled;
    en.title = '使う';
    en.addEventListener('change', () => { y.enabled = en.checked; row.classList.toggle('off', !y.enabled); });
    const name = document.createElement('input');
    name.value = y.name;
    name.spellcheck = false;
    name.addEventListener('input', () => { y.name = name.value; });
    const url = document.createElement('input');
    url.value = y.url;
    url.spellcheck = false;
    url.placeholder = 'http://…/';
    const markUrl = () => {
      const bad = ypUrlBad(y);
      url.classList.toggle('bad', bad);
      url.title = bad ? 'アドレスが正しくないので、このYPは取得しません（http:// か https:// で始めてください）' : '';
    };
    markUrl();
    url.addEventListener('input', () => { y.url = url.value; markUrl(); });
    const up = iconBtn('↑', '上へ', () => { if (i > 0) { [draftYps[i - 1], draftYps[i]] = [draftYps[i], draftYps[i - 1]]; renderYps(); } });
    const down = iconBtn('↓', '下へ', () => { if (i < draftYps.length - 1) { [draftYps[i + 1], draftYps[i]] = [draftYps[i], draftYps[i + 1]]; renderYps(); } });
    const del = iconBtn('✕', '削除', () => { draftYps.splice(i, 1); renderYps(); });
    row.append(en, name, url, up, down, del);
    box.appendChild(row);
  });
}
$('add-yp').addEventListener('click', () => {
  draftYps.push({ enabled: true, name: '', url: '' });
  renderYps();
  $('yps').lastElementChild?.querySelector('input:not([type=checkbox])')?.focus();
});
$('add-default-yps').addEventListener('click', () => {
  const have = new Set(draftYps.map((y) => y.name));
  const add = DEFAULT_YPS.filter((y) => !have.has(y.name)).map((y) => ({ ...y }));
  draftYps.push(...add);
  renderYps();
  if (add.length === 0) toast('初めからあるYPは、すべて入っています');
});
// 保存する前に確かめる：名前の重複、アドレスの書き方
function checkYps(list) {
  const seen = new Set();
  for (const y of list) {
    if (!y.name && !y.url) continue;
    if (!y.name) return 'YPの名前が空欄の行があります';
    if (seen.has(y.name)) return `YPの名前「${y.name}」が重なっています`;
    seen.add(y.name);
  }
  return '';
}
// アドレスが正しくない YP は、保存は止めずに取得しないだけにする（行を赤くして知らせる）
const ypUrlBad = (y) => !!(y.name || y.url) && !isValidYpUrl(y.url);

// ---- 設定画面：ツール・ブロックリスト（行の作り方は YP・プレイヤーと同じ） ----
function rowHead(box, labels) {
  const head = document.createElement('div');
  head.className = 'players-head';
  for (const t of labels) {
    const s = document.createElement('span');
    s.textContent = t;
    head.appendChild(s);
  }
  box.appendChild(head);
}
function textInput(obj, key, placeholder) {
  const i = document.createElement('input');
  i.value = obj[key] || '';
  i.spellcheck = false;
  if (placeholder) i.placeholder = placeholder;
  i.addEventListener('input', () => { obj[key] = i.value; });
  return i;
}
function checkInput(obj, key, title) {
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = !!obj[key];
  if (title) c.title = title;
  c.addEventListener('change', () => { obj[key] = c.checked; });
  return c;
}
function emptyNote(box, text) {
  const n = document.createElement('div');
  n.className = 'none';
  n.textContent = text;
  box.appendChild(n);
}
function moveBtns(list, i, rerender) {
  return [
    iconBtn('↑', '上へ', () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; rerender(); } }),
    iconBtn('↓', '下へ', () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; rerender(); } }),
    iconBtn('✕', '削除', () => { list.splice(i, 1); rerender(); }),
  ];
}

let draftTools = [];
function renderTools() {
  const box = $('tools');
  box.replaceChildren();
  if (draftTools.length === 0) { emptyNote(box, 'ツールはまだありません。'); return; }
  rowHead(box, ['', '名前', '実行ファイル', '', '引数', 'URL', '', '', '']);
  draftTools.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'player';
    const path = textInput(t, 'path');
    const browse = iconBtn('…', '参照', async () => {
      const f = await pickExe();
      if (f) { t.path = f; path.value = f; }
    });
    row.append(checkInput(t, 'enabled', '使う'), textInput(t, 'name'), path, browse, textInput(t, 'args'),
      checkInput(t, 'browser', '引数をURLとしてWebブラウザで開く'), ...moveBtns(draftTools, i, renderTools));
    box.appendChild(row);
  });
}
$('add-tool').addEventListener('click', () => {
  draftTools.push({ enabled: true, name: '', path: '', args: '"$3"', browser: false });
  renderTools();
});

let draftBlocks = [];
function renderBlocks() {
  const box = $('blocks');
  box.replaceChildren();
  if (draftBlocks.length === 0) { emptyNote(box, 'ブロックはまだありません。'); return; }
  rowHead(box, ['', 'チャンネル名（正規表現）', 'ホスト名（正規表現）', '止める操作', '']);
  draftBlocks.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'player';
    const ops = document.createElement('div');
    ops.className = 'ops';
    for (const [k, label] of BLOCK_OPS) {
      const l = document.createElement('label');
      l.className = 'small-chk';
      l.append(checkInput(b, k), label);
      ops.appendChild(l);
    }
    row.append(checkInput(b, 'enabled', '使う'), textInput(b, 'name', '例：テスト配信'), textInput(b, 'host', '例：\\.example\\.jp$'), ops,
      iconBtn('✕', '削除', () => { draftBlocks.splice(i, 1); renderBlocks(); }));
    box.appendChild(row);
  });
}
$('add-block').addEventListener('click', () => {
  draftBlocks.push(newBlock());
  renderBlocks();
});

function renderPlaceholderHelp() {
  const grid = document.createElement('div');
  grid.className = 'ph-grid';
  for (const [k, v] of PLACEHOLDER_HELP) {
    const c = document.createElement('code');
    c.textContent = k;
    const s = document.createElement('span');
    s.textContent = v;
    grid.append(c, s);
  }
  $('ph-list').replaceChildren(grid);
}

const AUTO_SECS = [30, 60, 120, 180, 300, 600, 900, 1800]; // 自動更新の間隔の選択肢（秒）
$('opt-ended-keep').append(...ENDED_KEEPS.map(([v, label]) => new Option(label, String(v))));
function openSettings() {
  $('settings-err').textContent = '';
  draftPlayers = settings.players.map((p) => ({ ...p }));
  renderPlayers();
  draftYps = settings.yps.map((y) => ({ ...y }));
  renderYps();
  draftTools = settings.tools.map((t) => ({ ...t }));
  renderTools();
  draftBlocks = settings.blocks.map((b) => ({ ...b }));
  renderBlocks();
  $('mid-action').value = settings.midAction;
  renderPlaceholderHelp();
  $('bbs-path').value = settings.bbs.path;
  $('bbs-regex').value = settings.bbs.urlRegex;
  $('dbl-action').value = settings.dblAction;
  $('peercast').value = settings.peercast;
  $('peercast-path').value = settings.peercastPath;
  $('opt-close-tray').checked = settings.closeToTray;
  $('opt-split-genre').checked = settings.splitGenre;
  $('opt-open-free').checked = settings.showOpenFree;
  $('opt-fav-light').value = favColor(settings.favColorLight, 'light');
  $('opt-fav-dark').value = favColor(settings.favColorDark, 'dark');
  $('opt-fav-rowbg').checked = settings.favRowBg;
  $('opt-media-buttons').checked = settings.showMediaLinks;
  $('opt-list-artwork').checked = settings.showListArtwork;
  $('opt-detail-artwork').checked = settings.showDetailArtwork;
  $('opt-notify-fav').checked = settings.notifyFav;
  $('opt-notify-all').checked = settings.notifyAllNew;
  $('opt-sound-on').checked = settings.soundOn;
  $('opt-notify-mode').value = settings.notifyMode;
  $('opt-notify-sec').value = settings.notifySeconds;
  $('opt-notify-corner').value = settings.notifyCorner;
  $('opt-notify-hide').checked = settings.notifyHideCapture;
  $('opt-notify-win').checked = settings.notifyWindows;
  $('opt-notify-flash').checked = settings.notifyFlash;
  $('sound-path').value = settings.soundPath;
  $('rec-dir').value = settings.recDir;
  $('opt-rec-sub').checked = settings.recSubFolder;
  $('opt-rec-wait').value = settings.recWaitMin;
  $('opt-rec-notify').checked = settings.recNotify;
  $('opt-activity').checked = settings.activityEnabled;
  $('opt-ranking').checked = settings.rankingEnabled;
  $('opt-ended-keep').value = String(endedKeepOf(settings.endedKeep));
  // 自動更新の間隔：ペカレコから取り込んだ値が選択肢にないときは、その値も出す
  $('opt-auto-sec').replaceChildren(...[...new Set([...AUTO_SECS, settings.autoSec])].sort((a, b) => a - b)
    .map((s) => new Option(s < 60 ? `${s}秒` : `${s / 60}分`, String(s))));
  $('opt-auto-sec').value = String(settings.autoSec);
  $('opt-update').checked = settings.updateCheck !== false;
  $('settings').hidden = false;
}

// お気に入りの色を画面に反映する（設定画面で選んでいる途中は、その色を一時的に出す）
const favOpts = (o = settings) => ({ light: o.favColorLight, dark: o.favColorDark, rowBg: o.favRowBg });
function applyFav(o) { applyFavCss(document, favOpts(o)); }
function draftFav() {
  return { favColorLight: $('opt-fav-light').value, favColorDark: $('opt-fav-dark').value, favRowBg: $('opt-fav-rowbg').checked };
}
for (const id of ['opt-fav-light', 'opt-fav-dark', 'opt-fav-rowbg']) $(id).addEventListener('input', () => applyFav(draftFav()));
$('fav-color-reset').addEventListener('click', () => {
  $('opt-fav-light').value = FAV_DEFAULT.light;
  $('opt-fav-dark').value = FAV_DEFAULT.dark;
  $('opt-fav-rowbg').checked = true;
  applyFav(draftFav());
});

// 保存しないで閉じたときは、選んでいた色を元に戻す
function closeSettings() { $('settings').hidden = true; applyFav(); }

$('open-settings').addEventListener('click', openSettings);
$('settings-cancel').addEventListener('click', closeSettings);
$('settings-save').addEventListener('click', () => {
  const yps = draftYps.map((y) => ({ ...y, name: y.name.trim(), url: y.url.trim() }));
  const ypErr = checkYps(yps);
  if (ypErr) { $('settings-err').textContent = ypErr; return; }
  const badBlock = draftBlocks.find((b) => blockInvalid(compileBlock(b)));
  if (badBlock) { $('settings-err').textContent = `ブロック「${blockLabel(badBlock)}」の正規表現が正しくありません`; return; }
  $('settings-err').textContent = '';
  const badUrls = yps.filter((y) => y.enabled && ypUrlBad(y)).length;
  const ypsChanged = JSON.stringify(yps) !== JSON.stringify(settings.yps);
  settings.yps = yps.filter((y) => y.name || y.url);
  applyYps();
  settings.tools = draftTools.map((t) => ({ ...t, name: t.name.trim(), path: t.path.trim() })).filter((t) => t.name || t.path || t.args.trim());
  settings.blocks = draftBlocks.map((b) => ({ ...b, name: b.name.trim(), host: b.host.trim() })).filter((b) => b.name || b.host);
  applyBlocks();
  settings.midAction = $('mid-action').value;
  settings.players = draftPlayers.map((p) => ({ ...p, path: p.path.trim(), type: p.type.trim() }));
  settings.bbs = { path: $('bbs-path').value.trim(), urlRegex: $('bbs-regex').value.trim() || '.*' };
  settings.dblAction = $('dbl-action').value;
  settings.peercast = $('peercast').value.trim() || 'localhost:7144';
  settings.peercastPath = $('peercast-path').value.trim();
  settings.closeToTray = $('opt-close-tray').checked;
  applyCloseToTray();
  settings.splitGenre = $('opt-split-genre').checked;
  settings.showOpenFree = $('opt-open-free').checked;
  Object.assign(settings, draftFav());
  // 初めの色と同じなら空にしておく（将来、初めの色を変えたときに追いつけるように）
  if (settings.favColorLight === FAV_DEFAULT.light) settings.favColorLight = '';
  if (settings.favColorDark === FAV_DEFAULT.dark) settings.favColorDark = '';
  settings.showMediaLinks = $('opt-media-buttons').checked;
  settings.showListArtwork = $('opt-list-artwork').checked;
  settings.showDetailArtwork = $('opt-detail-artwork').checked;
  settings.notifyFav = $('opt-notify-fav').checked;
  settings.notifyAllNew = $('opt-notify-all').checked;
  settings.soundOn = $('opt-sound-on').checked;
  settings.notifyMode = $('opt-notify-mode').value;
  settings.notifySeconds = Math.min(120, Math.max(2, parseInt($('opt-notify-sec').value, 10) || 8));
  settings.notifyCorner = $('opt-notify-corner').value;
  settings.notifyHideCapture = $('opt-notify-hide').checked;
  settings.notifyWindows = $('opt-notify-win').checked;
  settings.notifyFlash = $('opt-notify-flash').checked;
  settings.soundPath = $('sound-path').value.trim();
  settings.recDir = cleanDir($('rec-dir').value);
  settings.recSubFolder = $('opt-rec-sub').checked;
  settings.recWaitMin = Math.min(360, Math.max(1, parseInt($('opt-rec-wait').value, 10) || 10));
  settings.recNotify = $('opt-rec-notify').checked;
  settings.activityEnabled = $('opt-activity').checked;
  settings.rankingEnabled = $('opt-ranking').checked;
  { const v = $('opt-ended-keep').value; settings.endedKeep = endedKeepOf(v === 'refresh' ? v : Number(v)); }
  pruneEnded(state.ended, Date.now(), settings.endedKeep);
  const autoSec = Number($('opt-auto-sec').value);
  if (autoSec >= 30 && autoSec !== settings.autoSec) {
    settings.autoSec = autoSec;
    state.nextRefreshAt = Date.now() + autoSec * 1000;
  }
  rankingUI.render();
  settings.updateCheck = $('opt-update').checked;
  activityUI.sync();
  saveSettings();
  closeSettings();
  render();
  recUI.refreshDisk(true);
  toast(badUrls ? `設定を保存しました（アドレスが正しくないYP ${badUrls}件は取得しません）` : '設定を保存しました');
  syncPopups(); // 通知の窓にも、お気に入りの色などを伝える
  if (ypsChanged) refresh();
});
$('add-player').addEventListener('click', async () => {
  const f = await pickExe();
  if (!f) return;
  const isPcr = /pcrplayer(64)?\.exe$/i.test(f);
  // PCRPlayer なら、説明書（Readme.txt）にあるペカレコ用の設定と同じにする
  draftPlayers.push({ enabled: true, path: f, args: isPcr ? '"$x" "$0" "$3"' : '"$x"', type: isPcr ? 'FLV|WMV' : 'FLV' });
  renderPlayers();
  // 同じフォルダの PCRBrowser を掲示板ブラウザの候補にする
  if (isPcr && !$('bbs-path').value.trim()) {
    $('bbs-path').value = f.replace(/[^\\/]+$/, 'PCRBrowser.exe');
  }
});
$('sound-browse').addEventListener('click', async () => {
  const f = tauri
    ? await tauri.core.invoke('plugin:dialog|open', { options: { multiple: false, directory: false, filters: [{ name: '音声', extensions: ['wav', 'mp3', 'ogg'] }] } })
    : prompt('通知音のファイル（画面確認用）');
  if (f) { $('sound-path').value = f; $('opt-sound-on').checked = true; }
});
$('notify-test').addEventListener('click', () => {
  // 今の画面の設定（保存前でも）で、テスト用の通知を出す
  const sticky = $('opt-notify-mode').value === 'sticky';
  const sec = parseInt($('opt-notify-sec').value, 10) || 8;
  const prev = { corner: settings.notifyCorner, hide: settings.notifyHideCapture };
  settings.notifyCorner = $('opt-notify-corner').value;
  settings.notifyHideCapture = $('opt-notify-hide').checked;
  state.popups.unshift({
    key: 'test:' + Date.now(), sticky, expires: sticky ? Date.now() + 60000 : Date.now() + sec * 1000,
    test: { name: 'テスト', detail: '通知のテストです（クリックや ✕ で動きを確かめられます）', ypName: 'PecaList', listeners: -1, info: false },
  });
  syncPopups();
  settings.notifyCorner = prev.corner;
  settings.notifyHideCapture = prev.hide;
  if ($('opt-notify-win').checked) showNotification('PecaList', '通知のテストです');
  const path = $('sound-path').value.trim();
  if ($('opt-sound-on').checked && path) playSound(path);
});
$('bbs-browse').addEventListener('click', async () => {
  const f = await pickExe();
  if (f) $('bbs-path').value = f;
});
$('peercast-browse').addEventListener('click', async () => {
  const f = await pickExe();
  if (f) $('peercast-path').value = f;
});

function applyCloseToTray() {
  if (tauri) tauri.core.invoke('set_close_to_tray', { on: Boolean(settings.closeToTray) }).catch(() => {});
}

// ペカステが動いていなければ起動する（ペカレコと同じく、PecaList の起動時だけ）
async function startPeercast() {
  if (!tauri || !settings.peercastPath) return;
  try {
    if (await tauri.core.invoke('peercast_start', { path: settings.peercastPath, peercast: settings.peercast }) === 'started') toast('ペカステを起動しました');
  } catch (e) {
    toast('ペカステを起動できませんでした：' + e);
  }
}
$('rec-dir-browse').addEventListener('click', async () => {
  const d = tauri
    ? await tauri.core.invoke('plugin:dialog|open', { options: { multiple: false, directory: true, defaultPath: $('rec-dir').value.trim() || undefined } })
    : prompt('録画の保存先（画面確認用）');
  if (d) $('rec-dir').value = d;
});

// ---- キー操作 ----
window.addEventListener('keydown', (e) => {
  // F5 や Ctrl+R で画面が再読み込みされないようにし、一覧の更新に割り当てる
  if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    manualRefresh();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('search').focus();
  } else if (e.key === 'Escape') {
    closeMenu();
    if (!$('nlog').hidden) $('nlog').hidden = true;
    else if (!$('mig').hidden) $('mig').hidden = true;
    else closeSettings();
    $('fe').hidden = true;
  } else if (e.key === 'Enter' && $('settings').hidden && $('fe').hidden && $('ask').hidden && $('mig').hidden
    && state.tab !== 'p2p' && state.tab !== 'filter' && state.tab !== 'rec' && state.tab !== 'ranking' && state.tab !== 'activity' && document.activeElement === document.body) {
    play(findChannel(state.selectedKey));
  }
});

// ---- 起動 ----
// 新しい版のお知らせ（下の帯）
const appVersion = async () => (tauri ? /PecaList (\S+)/.exec(await tauri.core.invoke('app_info'))?.[1] : '') || '';
initUpdateCheck({ settings, fetchText, openUrl, current: appVersion });
// 下の帯（新しい版のお知らせの横）に、今の版を出す
appVersion().then((v) => { if (v) $('app-version').textContent = 'v' + v; }).catch(() => {});
const ypErrorsUI = initYpErrorsUI({
  getYps: () => state.yps,
  getStatus: (name) => state.ypStatus.get(name),
  stop: (names) => {
    const selected = new Set(names);
    for (const y of settings.yps) if (selected.has(y.name)) y.enabled = false;
    for (const y of draftYps) if (selected.has(y.name)) y.enabled = false;
    applyYps();
    applyFilters();
    saveSettings();
    if (!$('settings').hidden) renderYps();
    render();
    toast(`${selected.size}件のYPの取得を停止しました。設定で再開できます`);
  },
});
const activityChannels = () => allChannels().filter((ch) => (ch.p2pOnly || state.ypStatus.get(ch.ypName)?.ok) && !evalOf(ch).ignore);
// 勢いの行（配信者名）から、今の配信を探す。勢いは記録を残さないので、終わった配信は見つからない
function activityChannel(name) {
  const ch = activityChannels().find((c) => c.name === name && !c.info);
  if (!ch) toast('この配信は今の一覧にありません');
  return ch;
}
const activityUI = initActivityUI({
  settings, saveSettings,
  channels: activityChannels,
  openMenu: (name, x, y) => { const ch = activityChannel(name); if (ch) openMenu(x, y, ch); },
  clickAction: (kind, name) => { const ch = activityChannel(name); if (ch) clickAction(kind === 'dbl' ? settings.dblAction : settings.midAction, ch); },
  fetch: async (url) => {
    if (tauri) return tauri.core.invoke('fetch_bbs_subject', {url});
    const res = await fetch(url);
    if (!res.ok) throw new Error('サーバーの応答: ' + res.status);
    return res.text();
  },
});
const p2pUI = initP2pUI({settings, saveSettings, toast, onArtworkChange:()=>render(), invoke: (cmd,args) => tauri ? tauri.core.invoke(cmd,args) : Promise.resolve({enabled:false}), onChannels: (channels) => {
  state.p2pChannels=channels;markNew();applyFilters();syncPopups();render();
  if(settings.p2pAutoActions) { notifyNew(); rankingUI.observe(channels); recUI.onRefresh({p2pEvent:true}); }
}});
const rankingUI = initRankingUI({isShown: () => state.tab === 'ranking', toast, settings, saveSettings});
const filterUI = initFilterUI({ getFilters: () => state.filters, setFilters, matchCount, toast, settings, saveSettings });
// ---- 細い表示と、右への張り付け ----
// 張り付けているとき、または窓をこの幅より細くしたときは、名前だけの細い一覧にする
const NARROW_WIDTH = 420;
const NARROW_HIDDEN_TABS = ['ended', 'playing', 'ranking', 'activity', 'p2p', 'filter'];
const isNarrow = () => document.body.classList.contains('narrow');
function rowColors(ch) {
  const ev = evalOf(ch);
  const c = ev.first && state.compiled.find((cf) => (cf.f.color.text || cf.f.color.bg) && filterMatches(cf, ch, { isNew: isNew(ch) }));
  return c ? { text: c.f.color.text, bg: c.f.color.bg } : {};
}
const narrowUI = initNarrowUI({
  findChannel, evalOf, rowColors, markEl, select, selectedKey: () => state.selectedKey, play, openBbs, toggleFav,
  openMenu, clickAction, settings, linkify, cleanDescription,
});
function applyNarrow() {
  const narrow = settings.docked || window.innerWidth <= NARROW_WIDTH;
  if (narrow === isNarrow()) return;
  document.body.classList.toggle('narrow', narrow);
  if (!narrow) narrowUI.hideCard();
  if (narrow && NARROW_HIDDEN_TABS.includes(state.tab)) showTab('all');
  else render();
}
function renderDockButtons() {
  $('dock-toggle').classList.toggle('on', settings.docked);
  $('dock-toggle').title = settings.docked ? '張り付けをやめて、元の大きさと位置に戻す' : '画面の右端に細く張り付ける';
  const layer = DOCK_LAYERS[settings.dockLayer] ? settings.dockLayer : 'bottom';
  const next = DOCK_LAYER_ORDER[(DOCK_LAYER_ORDER.indexOf(layer) + 1) % DOCK_LAYER_ORDER.length];
  $('topmost-toggle').hidden = !settings.docked;
  $('topmost-toggle').textContent = DOCK_LAYERS[layer].icon;
  $('topmost-toggle').classList.toggle('on', layer !== 'normal');
  $('topmost-toggle').title = `重なり方：${DOCK_LAYERS[layer].label}（クリックで${DOCK_LAYERS[next].label}）`;
}
// 張り付けているときの重なり方。ボタンを押すたびに 手前 → ふつう → 最下面 と切り替える
const DOCK_LAYERS = {
  top: { icon: '⧉', label: '常に手前' },
  normal: { icon: '▢', label: 'ふつう' },
  bottom: { icon: '⤓', label: '最下面（ほかの窓の後ろ。クリックしても前に出ない）' },
};
const DOCK_LAYER_ORDER = ['top', 'normal', 'bottom'];
async function dock(on) {
  if (!tauri) return;
  try {
    if (on) {
      const prev = await tauri.core.invoke('dock_right', { width: settings.dockWidth });
      if (!settings.docked || !settings.dockRestore) settings.dockRestore = prev;
      await tauri.core.invoke('set_layer', { layer: settings.dockLayer });
    } else {
      await tauri.core.invoke('set_layer', { layer: 'normal' });
      if (settings.dockRestore) await tauri.core.invoke('undock', { rect: settings.dockRestore });
      settings.dockRestore = null;
    }
    settings.docked = on;
    saveSettings();
  } catch (e) {
    toast('張り付けられませんでした：' + e);
  }
  renderDockButtons();
  applyNarrow();
}
$('dock-toggle').addEventListener('click', () => dock(!settings.docked));
$('topmost-toggle').addEventListener('click', () => {
  const cur = DOCK_LAYER_ORDER.includes(settings.dockLayer) ? settings.dockLayer : 'bottom';
  settings.dockLayer = DOCK_LAYER_ORDER[(DOCK_LAYER_ORDER.indexOf(cur) + 1) % DOCK_LAYER_ORDER.length];
  settings.dockLayerSet = true;
  saveSettings();
  renderDockButtons();
  if (tauri && settings.docked) tauri.core.invoke('set_layer', { layer: settings.dockLayer }).catch(() => {});
});
// 張り付けているときに幅を変えたら、その幅を覚えておく（次に張り付けるときも同じ幅）
let resizeTimer = 0;
window.addEventListener('resize', () => {
  applyNarrow();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (settings.docked && Math.abs(window.innerWidth - settings.dockWidth) > 4) { settings.dockWidth = window.innerWidth; saveSettings(); }
  }, 600);
});

// 窓の位置と大きさを覚えておく（次の起動で Rust 側が戻す。lib.rs の restore_window）。
// 張り付け中（dockRestore で別に覚えている）・最小化中は覚えない。最大化中は「最大化していた」だけ覚える
let winTimer = 0;
function rememberWindow() {
  clearTimeout(winTimer);
  winTimer = setTimeout(async () => {
    if (settings.docked) return;
    try {
      const st = await tauri.core.invoke('window_state');
      if (st.min || settings.docked) return;
      const same = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
      if (st.max === settings.winMax && (st.max || same(st.rect, settings.winRect))) return;
      settings.winMax = st.max;
      if (!st.max) settings.winRect = st.rect;
      saveSettings();
    } catch {}
  }, 800);
}
if (tauri?.window) {
  const w = tauri.window.getCurrentWindow();
  w.onMoved(rememberWindow).catch(() => {});
  w.onResized(rememberWindow).catch(() => {});
}

const notifyLog = initNotifyLog({ loadStore, saveStoreSoon });
const recUI = initRecUI({
  settings, saveSettings, getFilters: () => state.filters, allChannels, findChannel, evalOf, detailText, toast, ask, play, showTab,
  selectedChannel: () => findChannel(state.selectedKey),
  checkBlock: (ch, auto) => blockedBy(ch, auto ? 'autoRecord' : 'manualRecord'),
  blockLabel,
  isShown: () => state.tab === 'rec',
  addPopup: addCardPopup,
  removePopup,
  // 録画の始まり・終わりで、一覧の「録画中」の印を付け直す
  onChange: () => { if (state.tab !== 'rec' && state.tab !== 'filter') renderBody(); },
});
initMigrateUI({
  settings, saveSettings, getFilters: () => state.filters, setFilters, toast,
  // 取り込んだあと：設定画面を閉じ、YP・ブロックリスト・文字の大きさなどを反映して取り直す
  afterImport: () => {
    closeSettings();
    applyYps();
    applyBlocks();
    state.nextRefreshAt = Date.now() + settings.autoSec * 1000;
    render();
    tickAuto();
    refresh();
  },
});
setStoreErrorHandler((e) => toast('保存できませんでした：' + e));

(async () => {
  try {
    await loadSettings();
    await loadFilters();
    await rankingUI.load();
    await recUI.load();
    await notifyLog.load();
    await p2pUI.load();
  } catch (e) {
    toast('設定の読み込みに失敗しました：' + e);
  }
  applyCloseToTray();
  startPeercast();
  renderDockButtons();
  if (settings.docked) await dock(true); // 前回、張り付けたまま終わった
  applyNarrow();
  applyFont();
  render();
  tickAuto();
  refresh();
})();
