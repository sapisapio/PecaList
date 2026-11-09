// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// 録画の一覧の計算（画面には触らない部分。テストしやすくするため分けている）

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_JA = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n, w = 2) => String(n).padStart(w, '0');

// ファイル名（拡張子なし）。ペカレコと同じ並び：チャンネル名_20261108_Sun_135520
export function recFileBase(name, d) {
  return `${name}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${WEEK_EN[d.getDay()]}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
