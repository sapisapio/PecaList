// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
// ランキングの1日は朝5時から翌朝5時まで（夜中の0時をまたぐ配信を、翌日に分けない）。月も同じく1日の朝5時から
export const DAY_START_HOUR = 5;
export const rankDay = (date) => dateKey(new Date(date.getTime() - DAY_START_HOUR * 3600_000));
export const broadcasterKey = (name) => (name || '').normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
export const emptyRanking = () => ({ version: 1, days: {}, months: {} });

export function normalizeRanking(value) {
  const data = emptyRanking();
  for (const kind of ['days', 'months']) {
    for (const [period, rows] of Object.entries(value?.[kind] || {})) {
      if (!(kind === 'days' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(period) || !Array.isArray(rows)) continue;
      data[kind][period] = onePerName(rows.filter((r) => r && typeof r.name === 'string' && Number.isSafeInteger(r.listeners) && r.listeners >= 0 && Number.isFinite(r.at))
        .map((r) => ({ name: r.name, listeners: r.listeners, at: r.at, detail: typeof r.detail === 'string' ? r.detail : '', ypName: typeof r.ypName === 'string' ? r.ypName : '' })));
    }
  }
  return data;
}

// 日別・月別とも「配信者名」ごとに1行。その期間でいちばん多かったときの配信内容を残す。
// （0.2.24 までは日別を「配信者名＋配信内容」で分けていて、同じ名前が何行も並んでいた）
const peakKey = (kind, row) => broadcasterKey(row.name);

// 同じ配信者の行を1つにまとめる（いちばん多い人数の行。同じ人数なら先に見えたほう）
function onePerName(rows) {
  const best = new Map();
  for (const r of rows) {
    const key = broadcasterKey(r.name), prev = best.get(key);
    if (!prev || r.listeners > prev.listeners || (r.listeners === prev.listeners && r.at < prev.at)) best.set(key, r);
  }
  return [...best.values()];
}

// 取得成功したYPの今回のデータだけを渡す。複数YPの人数は合計しない。
export function recordPeaks(data, channels, now = new Date()) {
  const day = rankDay(now), month = day.slice(0, 7);
  let changed = false;
  for (const [kind, period] of [['days', day], ['months', month]]) {
    const peaks = new Map((data[kind][period] || []).map((r) => [peakKey(kind, r), r]));
    let updated = false;
    for (const ch of channels) {
      const detail = [ch.genre, ch.detail, ch.comment].filter(Boolean).join(' - ');
      const key = peakKey(kind, { name: ch.name, detail });
      if (!broadcasterKey(ch.name) || ch.info || ch.event || !Number.isSafeInteger(ch.listeners) || ch.listeners < 0) continue;
      const prev = peaks.get(key);
      if (!prev || ch.listeners > prev.listeners) {
        peaks.set(key, { name: ch.name, listeners: ch.listeners, at: now.getTime(), detail, ypName: ch.ypName || '' });
        updated = true;
      }
    }
    if (updated) { data[kind][period] = [...peaks.values()]; changed = true; }
  }
  const earliestDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364);
  const earliestMonth = new Date(now.getFullYear(), now.getMonth() - 23, 1);
  for (const [kind, cutoff] of [['days', dateKey(earliestDay)], ['months', dateKey(earliestMonth).slice(0, 7)]]) {
    for (const key of Object.keys(data[kind])) if (key < cutoff) { delete data[kind][key]; changed = true; }
  }
  return changed;
}

export function rankRows(data, kind, period) {
  return [...(data[kind]?.[period] || [])].sort((a, b) => b.listeners - a.listeners || a.at - b.at || a.name.localeCompare(b.name, 'ja'));
}

// ---- 保存（月ごとのファイル） ----
// 1年分を1つのファイルにすると、更新のたびに全体（1年で 10〜20MB）を書き直すことになる。
// そこで「ranking-YYYY-MM」に、その月の日別とその月の月別だけを入れ、書き直すのは今の月だけにする。
export const MONTHS_KEPT = 24;
export const monthFileName = (month) => `ranking-${month}`;

// 今の月から、さかのぼって count か月分の「YYYY-MM」（新しい順）
export function recentMonths(now, count = MONTHS_KEPT, skip = 0) {
  const base = new Date(rankDay(now) + 'T00:00:00');
  const out = [];
  for (let i = skip; i < skip + count; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    out.push(dateKey(d).slice(0, 7));
  }
  return out;
}

// ある月の分だけを取り出す（保存用）
export function monthPart(data, month) {
  const part = emptyRanking();
  for (const [day, rows] of Object.entries(data.days)) if (day.slice(0, 7) === month) part.days[day] = rows;
  if (data.months[month]) part.months[month] = data.months[month];
  return part;
}

// 保存してある分をまとめて1つにする。後ろにあるものほど優先（古い1ファイルの形を先に渡す）
export function mergeParts(parts) {
  const data = emptyRanking();
  for (const p of parts) {
    if (!p) continue;
    Object.assign(data.days, p.days || {});
    Object.assign(data.months, p.months || {});
  }
  return normalizeRanking(data);
}

// 中にある月（日別・月別のどちらかがある月）
export function monthsIn(data) {
  return [...new Set([...Object.keys(data.days).map((d) => d.slice(0, 7)), ...Object.keys(data.months)])];
}
