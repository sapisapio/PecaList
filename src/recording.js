// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// 録画の一覧の計算（画面には触らない部分。テストしやすくするため分けている）

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_JA = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n, w = 2) => String(n).padStart(w, '0');

// 録画のファイル名の書式（ペカレコと同じ記号）。
// PecaList のデフォルト（新しく使い始める人の初め）：チャンネル名(261117-21時03分)ジャンル-詳細「コメント」
export const DEFAULT_REC_FORMAT = '$0($y$M$D-$h時$m分)$B$8';
// 0.2.34 までの PecaList の名前（チャンネル名_20261108_Sun_135520）。前から使っている人はこのまま
export const LEGACY_REC_FORMAT = '$0_$Y$M$D_$w_$h$m$s';
// 設定画面の「テンプレート」。PecaList のデフォルトと、ペカレコにあるテンプレート（ペカレコの「デフォルト」は名前が重なるので「旧デフォルト」）
export const REC_TEMPLATES = [
  ['デフォルト', DEFAULT_REC_FORMAT],
  ['旧デフォルト', '$0 $Y$M$D $w $h$m$s $x'],
  ['チャンネル詳細1', '$0 $Y$M$D $w $h$m$s $7$8$9'],
  ['チャンネル詳細2', '$0($Y$M$D$w$h$m$s)$A$8$4$5$6'],
  ['漢字', '$0 $Y年$M月$D日($W)$h時$m分$s秒 $7$8$9'],
];
// ペカレコの初めの書式のままか（画面の「デフォルト」はスペース区切り、保存されるのは「_」区切り）
export const isPecarecDefaultFormat = (f) => String(f || '').trim().replace(/ /g, '_') === '$0_$Y$M$D_$w_$h$m$s_$x';
// 設定画面などの見本に使う配信
export const REC_SAMPLE = { name: 'チャンネル名', genre: 'ジャンル', detail: '詳細', comment: 'コメント', trackArtist: 'アーティスト', trackTitle: 'タイトル', trackAlbum: 'アルバム' };
// 設定画面の「記号を入れる」に出すもの
export const REC_TOKENS = [
  ['$Y', '西暦（4桁）'], ['$y', '西暦（2桁）'], ['$M', '月'], ['$D', '日'], ['$w', '曜日（英字）'], ['$W', '曜日（漢字）'],
  ['$h', '時'], ['$m', '分'], ['$s', '秒'], ['$x', 'ミリ秒'],
  ['$0', 'チャンネル名'], ['$1', 'ジャンル'], ['$2', '詳細'], ['$3', 'コメント'], ['$4', 'アーティスト'], ['$5', 'タイトル'], ['$6', 'アルバム'],
  ['$7', '[ジャンル - 詳細]'], ['$8', '「コメント」'], ['$9', 'アーティスト タイトル アルバム'],
  ['$A', '[ジャンル-詳細]'], ['$B', 'ジャンル-詳細'], ['$C', 'ジャンル 詳細'],
];
// ペカレコで「特殊文字」とされている文字と、全角にしたときの文字
const SPECIAL = { '\\': '＼', '"': '”', '.': '．', '/': '／', ':': '：', '*': '＊', '?': '？', '<': '＜', '>': '＞', '|': '｜', ';': '；', ',': '，' };

// 書式からファイル名（拡張子なし）を作る。
// opts.underbar：半角スペースを「_」に。opts.fullwidth：特殊文字を全角に（しないときは「_」。ペカレコと同じ）
export function recFileName(format, ch, d, opts = {}) {
  const t = (v) => String(v ?? '').trim();
  const join = (sep, ...xs) => xs.map(t).filter(Boolean).join(sep);
  const gd = (sep) => join(sep, ch.genre, ch.detail);
  const map = {
    Y: String(d.getFullYear()), y: pad(d.getFullYear() % 100), M: pad(d.getMonth() + 1), D: pad(d.getDate()),
    w: WEEK_EN[d.getDay()], W: WEEK_JA[d.getDay()], h: pad(d.getHours()), m: pad(d.getMinutes()), s: pad(d.getSeconds()), x: pad(d.getMilliseconds(), 3),
    0: t(ch.name), 1: t(ch.genre), 2: t(ch.detail), 3: t(ch.comment), 4: t(ch.trackArtist), 5: t(ch.trackTitle), 6: t(ch.trackAlbum),
    7: gd(' - ') && `[${gd(' - ')}]`, 8: t(ch.comment) && `「${t(ch.comment)}」`, 9: join(' ', ch.trackArtist, ch.trackTitle, ch.trackAlbum),
    A: gd('-') && `[${gd('-')}]`, B: gd('-'), C: gd(' '), '$': '$',
  };
  let out = String(format || DEFAULT_REC_FORMAT).replace(/\$(.)/g, (all, k) => (k in map ? map[k] : all));
  out = out.replace(/[\u0000-\u001f]/g, ' ');
  if (opts.underbar) out = out.replace(/ /g, '_');
  out = out.replace(/[\\"./:*?<>|;,]/g, (c) => (opts.fullwidth ? SPECIAL[c] : '_'));
  return out.trim() || map[0] || 'rec';
}

// 1:24:08 / 0:42:51
export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

// 合計時間：5時間02分 / 42分
export function formatHours(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}時間${pad(m % 60)}分` : `${m}分`;
}

// 1.32 GB / 640 MB
export function formatBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(b >= 1e11 ? 0 : 2) + ' GB';
  if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
  return Math.max(0, Math.round(b / 1e3)) + ' KB';
}

// 13:55〜15:58
export function formatSpan(start, end) {
  const t = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  return `${t(start)}〜${t(end)}`;
}

function dayStart(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 一覧の範囲：today 今日 / yesterday 昨日 / week この1週間 / all すべて（録画を始めた日で数える）
export function inRange(item, range, now) {
  const today = dayStart(now);
  if (range === 'today') return item.start >= today;
  if (range === 'yesterday') return item.start >= today - DAY_MS && item.start < today;
  if (range === 'week') return item.start >= today - 6 * DAY_MS;
  return true;
}

// 日ごとにまとめる（新しい日が上、日の中も新しい順）
export function groupByDay(items, now) {
  const today = dayStart(now);
  const groups = new Map();
  for (const it of items.slice().sort((a, b) => b.start - a.start)) {
    const day = dayStart(it.start);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(it);
  }
  return [...groups].map(([day, list]) => {
    const d = new Date(day);
    const md = `${d.getMonth() + 1}/${d.getDate()}（${WEEK_JA[d.getDay()]}）`;
    const label = day === today ? `今日 ${md}` : day === today - DAY_MS ? `昨日 ${md}` : md;
    return {
      day, label, items: list,
      ms: list.reduce((s, x) => s + (x.ms || 0), 0),
      bytes: list.reduce((s, x) => s + (x.bytes || 0), 0),
    };
  });
}

// この1週間の自動録画を、フィルタごとに集計する（大きい順）
export function weeklyByFilter(items, now) {
  const from = now - 7 * DAY_MS;
  const map = new Map();
  for (const it of items) {
    if (!it.auto || it.start < from) continue;
    const s = map.get(it.auto) || { name: it.auto, count: 0, ms: 0, bytes: 0 };
    s.count++;
    s.ms += it.ms || 0;
    s.bytes += it.bytes || 0;
    map.set(it.auto, s);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}

// 1週間で録りすぎているフィルタ（キーワードが広すぎるかもしれない）
export function isHeavy(s) {
  return s.count >= 10 || s.ms >= 20 * 3600 * 1000;
}

// 保存先の空きが、この1週間のペースで何日分か（録画がなければ null）
export function daysLeft(free, items, now) {
  const from = now - 7 * DAY_MS;
  const week = items.filter((x) => x.start >= from).reduce((s, x) => s + (x.bytes || 0), 0);
  if (week <= 0) return null;
  return Math.floor(free / (week / 7));
}

// 録画できる形式か（今は FLV だけ）
export function canRecord(ch) {
  return !!ch && !ch.info && !ch.event && /^flv$/i.test(ch.type || '') && /^[0-9a-f]{32}$/i.test(ch.id || '');
}

// 録画の保存先の書き方をそろえる。後ろの「\」は取るが、ドライブ直下（「C:\」）は残す。
// 「C:」だけだと Windows では「C ドライブの今いる場所」の意味になり、保存できない
export function cleanDir(dir) {
  const s = (dir || '').trim().replace(/[\\/]+$/, '').replace(/\//g, '\\');
  return /^[a-zA-Z]:$/.test(s) ? s + '\\' : s;
}
