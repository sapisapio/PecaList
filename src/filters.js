// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// フィルタ（お気に入り・NG など）。
// ペカレコの Filter.xml（v0.63 以降の形式）を読み込めるよう、項目はペカレコに合わせている。

// 検索対象にできる項目（Filter.xml の normal / extra の属性名）
export const FIELD_LABELS = {
  channelName: 'チャンネル名', genre: 'ジャンル', detail: '詳細', comment: 'コメント',
  artist: 'アーティスト', title: 'タイトル', album: 'アルバム',
  ypName: 'YP名', ypUrl: 'YPのURL', contactUrl: 'コンタクトURL', trackContactUrl: '曲のURL',
  type: '形式', status: '状態', id: 'ID', tip: 'TIP',
};
const NORMAL_FIELDS = ['channelName', 'genre', 'detail', 'comment', 'artist', 'title', 'album'];
const EXTRA_FIELDS = ['ypName', 'ypUrl', 'contactUrl', 'trackContactUrl', 'type', 'status', 'id', 'tip'];

function fieldValue(ch, f) {
  switch (f) {
    case 'channelName': return ch.name;
    case 'artist': return ch.trackArtist;
    case 'title': return ch.trackTitle;
    case 'album': return ch.trackAlbum;
    case 'trackContactUrl': return '';
    default: return ch[f] ?? '';
  }
}

function emptyFields(on = []) {
  const o = {};
  for (const f of [...NORMAL_FIELDS, ...EXTRA_FIELDS]) o[f] = on.includes(f);
  return o;
}

export function newFilter(over = {}) {
  return {
    enabled: true,
    name: '',
    favorite: false,
    download: false,
    ignore: false,
    base: { search: '', fields: emptyFields(['channelName', 'genre', 'detail', 'comment']) },
    and: { enabled: false, search: '', fields: emptyFields(['genre', 'detail', 'comment']) },
    not: { enabled: false, search: '', fields: emptyFields() },
    icase: true,
    width: true,
    bitrate: { min: null, max: null },
    listener: { min: null, max: null },
    relay: { min: null, max: null },
    time: { min: null, max: null },
    newCond: { new: false, notNew: false },
    play: { play: false, notPlay: false, listener: false, notListener: false, relay: false, notRelay: false },
    color: { text: null, bg: null },
    sort: true,
    favoriteOpts: { tab: true, all: true, exclusive: true, player: false },
    downloadOpts: { execute: true, observe: true },
    ignoreShow: true,
    notify: { notify: true, alarm: null },
    // お気に入りごとの通知のしかた：'default' 全体の設定に従う / 'auto' 一瞬 / 'sticky' 常時 / 'none' 通知しない
    notifyStyle: 'default',
    ...over,
  };
}

// ---- Filter.xml の読み込み ----
const bool = (el, a) => el?.getAttribute(a) === 'true';
const int = (el, a) => { const n = parseInt(el?.getAttribute(a) ?? '', 10); return Number.isFinite(n) ? n : 0; };

// Windows の色の数値（0x00BBGGRR）を #rrggbb にする
export function colorrefToHex(v) {
  const r = v & 0xff, g = (v >> 8) & 0xff, b = (v >> 16) & 0xff;
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function hexToColorref(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return 0;
  return parseInt(m[1], 16) | (parseInt(m[2], 16) << 8) | (parseInt(m[3], 16) << 16);
}

function readCond(el) {
  const fields = emptyFields();
  const n = el?.querySelector(':scope > normal');
  const x = el?.querySelector(':scope > extra');
  for (const f of NORMAL_FIELDS) fields[f] = bool(n, f);
  for (const f of EXTRA_FIELDS) fields[f] = bool(x, f);
  return { search: el?.querySelector(':scope > search')?.textContent ?? '', fields };
}

function readRange(el) {
  return {
    min: bool(el, 'enableMin') ? int(el, 'min') : null,
    max: bool(el, 'enableMax') ? int(el, 'max') : null,
  };
}

export function parseFilterXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XMLとして読めませんでした');
  const root = doc.documentElement;
  if (root.tagName !== 'root') throw new Error('ペカレコの Filter.xml ではないようです');
  const filters = [];
  for (const it of root.querySelectorAll(':scope > item')) {
    const q = (s) => it.querySelector(':scope > ' + s);
    const and = q('and'), not = q('not'), common = q('common');
    const fav = q('favorite'), dl = q('download'), notify = q('notify'), nw = q('new'), pl = q('play');
    filters.push(newFilter({
      enabled: bool(it, 'enable'),
      name: it.getAttribute('name') ?? '',
      favorite: bool(it, 'favorite'),
      download: bool(it, 'download'),
      ignore: bool(it, 'ignore'),
      base: readCond(q('base')),
      and: { enabled: bool(and, 'enable'), ...readCond(and) },
      not: { enabled: bool(not, 'enable'), ...readCond(not) },
      icase: bool(q('option'), 'icase'),
      width: bool(q('option'), 'width'),
      bitrate: readRange(q('bitrate')),
      listener: readRange(q('listener')),
      relay: readRange(q('relay')),
      time: readRange(q('time')),
      newCond: { new: bool(nw, 'new'), notNew: bool(nw, 'notNew') },
      play: {
        play: bool(pl, 'play'), notPlay: bool(pl, 'notPlay'), listener: bool(pl, 'listener'),
        notListener: bool(pl, 'notListener'), relay: bool(pl, 'relay'), notRelay: bool(pl, 'notRelay'),
      },
      color: {
        text: bool(common, 'enableText') ? colorrefToHex(int(common, 'text')) : null,
        bg: bool(common, 'enableBg') ? colorrefToHex(int(common, 'bg')) : null,
      },
      sort: common ? bool(common, 'sort') : true,
      favoriteOpts: { tab: bool(fav, 'tab'), all: bool(fav, 'all'), exclusive: bool(fav, 'exclusive'), player: bool(fav, 'player') },
      downloadOpts: { execute: bool(dl, 'execute'), observe: bool(dl, 'observe') },
      ignoreShow: bool(q('ignore'), 'show'),
      notify: { notify: bool(notify, 'notify'), alarm: bool(notify, 'enableAlarm') ? notify.getAttribute('alarm') : null },
    }));
  }
  return filters;
}

// ---- 一致の判定 ----
const REGEX_SPECIAL = new Set('\\^$.*+?()[]{}|/'.split(''));

// 全角半角を区別しないとき：比べる文字を NFKC でそろえる。
// 検索文字列の側は、全角の（ や ｜ が正規表現の記号に化けないよう、変換で記号になった文字はエスケープする。
export function normalizePattern(p) {
  let out = '';
  for (const c of p) {
    const n = c.normalize('NFKC');
    out += (n !== c && n.length === 1 && REGEX_SPECIAL.has(n)) ? '\\' + n : n;
  }
  return out;
}

function compileCond(cond, f) {
  const src = cond.search || '';
  if (!src) return null;
  try {
    return new RegExp(f.width ? normalizePattern(src) : src, f.icase ? 'i' : '');
  } catch {
    return undefined; // 正規表現として正しくない
  }
}

// 検索のたびに正規表現を作り直さないよう、フィルタごとに一度だけ作る
export function compileFilter(f) {
  return {
    f,
    base: compileCond(f.base, f),
    and: f.and.enabled ? compileCond(f.and, f) : null,
    not: f.not.enabled ? compileCond(f.not, f) : null,
    invalid: [compileCond(f.base, f), f.and.enabled && compileCond(f.and, f), f.not.enabled && compileCond(f.not, f)].includes(undefined),
  };
}

function condMatches(re, fields, ch, width) {
  for (const [k, on] of Object.entries(fields)) {
    if (!on) continue;
    let v = fieldValue(ch, k) || '';
    if (width) v = v.normalize('NFKC');
    if (re.test(v)) return true;
  }
  return false;
}

function inRange(v, r) {
  if (r.min !== null && v < r.min) return false;
  if (r.max !== null && v > r.max) return false;
  return true;
}

export function filterMatches(cf, ch, ctx = {}) {
  const f = cf.f;
  if (!f.enabled || cf.invalid || ch.info) return false;
  // 基本検索が空のフィルタは何にも一致しない（ペカレコ v0.52 と同じ）
  if (!cf.base || !condMatches(cf.base, f.base.fields, ch, f.width)) return false;
  if (cf.and && !condMatches(cf.and, f.and.fields, ch, f.width)) return false;
  if (cf.not && condMatches(cf.not, f.not.fields, ch, f.width)) return false;
  if (!inRange(ch.bitrate, f.bitrate)) return false;
  if (!inRange(ch.listeners, f.listener)) return false;
  if (!inRange(ch.relays, f.relay)) return false;
  if ((f.time.min !== null || f.time.max !== null) && !inRange(ch.uptimeMin, f.time)) return false;
  if (f.newCond.new && !ctx.isNew) return false;
  if (f.newCond.notNew && ctx.isNew) return false;
  return true;
}

// 自動録画するフィルタか。ペカレコの「ダウンロードリストに追加」のうち、「開始」もオンのもの
// （「開始」がオフのものは、ペカレコではリストに入れるだけで録画は始めない）
export const autoRecords = (f) => !!f.download && f.downloadOpts?.execute !== false;

// チャンネルに当たるフィルタを調べる。上にあるフィルタが優先。
export function evaluate(compiled, ch, ctx) {
  const res = { favorite: null, ignore: null, record: null, first: null };
  for (const cf of compiled) {
    if (!filterMatches(cf, ch, ctx)) continue;
    if (!res.first) res.first = cf.f;
    if (cf.f.ignore && !res.ignore) res.ignore = cf.f;
    if (cf.f.favorite && !res.favorite) res.favorite = cf.f;
    if (autoRecords(cf.f) && !res.record) res.record = cf.f;
  }
  return res;
}

// チャンネル名からフィルタを作るとき用：正規表現の記号をそのままの文字として扱う
export function escapeRegex(s) {
  return s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}
