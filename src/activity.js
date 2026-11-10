// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later
// 選べる取得間隔（分）
export const ACTIVITY_MINUTES = [15, 30, 60];
export const DEFAULT_ACTIVITY_MINUTES = 15; // 5分・10分を選んでいた設定も、選べる中で一番短い15分として扱う
export const ACTIVITY_INTERVAL = DEFAULT_ACTIVITY_MINUTES * 60 * 1000; // 初めの取得間隔
export const activityInterval = (minutes) => (ACTIVITY_MINUTES.includes(minutes) ? minutes : DEFAULT_ACTIVITY_MINUTES) * 60 * 1000;

// TOP・スレッド・スマートフォン用URLを掲示板単位にそろえる。
export function boardFromUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'bbs.jpnkn.com') {
    const board = parts[0] === 'test' && parts[1] === 'read.cgi' ? parts[2] : parts[0];
    if (!board || !/^[a-zA-Z0-9_-]+$/.test(board) || ['test','api','admin'].includes(board)) return null;
    return { key: `jpnkn/${board}`, name: `jpnkn / ${board}`, url: `https://bbs.jpnkn.com/${board}/subject.txt` };
  }
  if (['jbbs.shitaraba.net', 'jbbs.livedoor.jp', 'jbbs.livedoor.com'].includes(host)) {
    let category, board;
    if (parts[0] === 'bbs' && ['read.cgi','read_archive.cgi','subject.cgi'].includes(parts[1])) [category,board] = parts.slice(2);
    else [category,board] = parts;
    if (!/^[a-zA-Z]+$/.test(category || '') || !/^\d+$/.test(board || '')) return null;
    category = category.toLowerCase();
    return { key: `shitaraba/${category}/${board}`, name: `したらば / ${category}/${board}`, url: `https://jbbs.shitaraba.net/${category}/${board}/subject.txt` };
  }
  return null;
}

export function parseSubject(text) {
  const counts = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\d+)\.(?:dat<>|cgi,).*\((\d+)\)\s*$/.exec(line);
    if (!match) continue;
    const count = Number(match[2]);
    if (Number.isSafeInteger(count)) counts.set(match[1], Math.max(counts.get(match[1]) || 0, count));
  }
  if (!counts.size && text.trim()) throw new Error('スレッド一覧として読めませんでした');
  return counts;
}

// maxGap より間が空いたら、比べずに基準を取り直す（掲示板が多いと1周が5分より長くなるので、その長さを渡す）
export function measureActivity(previous, counts, at, maxGap = ACTIVITY_INTERVAL * 1.5) {
  if (!previous || at <= previous.at || at - previous.at > maxGap) {
    return { baseline: { at, high: new Map(counts) }, count: null, elapsed: 0 };
  }
  const high = new Map(previous.high);
  let added = 0;
  for (const [id, count] of counts) {
    const before = high.get(id);
    if (before !== undefined) added += Math.max(0, count - before);
    // 新しく作成されたスレッドのみ初期レス数を加える。古いスレの再出現は基準扱い。
    else if (Number(id) * 1000 > previous.at && Number(id) * 1000 <= at) added += count;
    high.set(id, Math.max(before || 0, count));
  }
  return { baseline: { at, high }, count: added, elapsed: at - previous.at };
}

export function activityTargets(channels) {
  const targets = new Map();
  for (const ch of channels) {
    if (ch.info || ch.event) continue;
    const board = boardFromUrl(ch.contactUrl);
    if (!board) continue;
    if (!targets.has(board.key)) targets.set(board.key, { ...board, channels: new Set() });
    targets.get(board.key).channels.add(ch.name);
  }
  return targets;
}

// 掲示板の運営に負担をかけないよう、1つずつ、1周（取得間隔）の間に散らして取りに行く。
// 掲示板が多くて間隔に収まらないときは、1周の間隔を延ばす。
export const MIN_GAP = 13000; // 1つ取りに行ったら、次まで最低13秒あける（0.2.22 までは3秒）
export function roundPlan(n, interval = ACTIVITY_INTERVAL) {
  const gap = n ? Math.max(MIN_GAP, Math.floor((interval * 0.9) / n)) : 0;
  return { gap, round: Math.max(interval, gap * n) };
}

// 「取りすぎ」（429）の返事なら、待つ時間（ミリ秒）を返す。相手が時間を言わなければ10分待つ
export const BUSY_WAIT = 10 * 60 * 1000;
export function busyWait(error) {
  const m = /混雑\(429\)(?: retry=(\d+))?/.exec(String(error));
  if (!m) return null;
  return m[1] ? Math.min(Number(m[1]) * 1000, 60 * 60 * 1000) : BUSY_WAIT;
}
const siteOf = (key) => key.split("/")[0];

// OFF にしたら、取りに行く途中の応答は捨て、残りも取りに行かない。
export function createActivityMonitor(ctx) {
  let enabled = false, generation = 0, rows = new Map();
  let queue = [], total = 0, plan = roundPlan(0), nextAt = 0, nextRequestAt = 0, inFlight = false, roundStart = 0;
  const interval = () => ctx.interval?.() ?? ACTIVITY_INTERVAL;
  const busyUntil = new Map(); // 掲示板サイト（jpnkn / shitaraba）→ この時刻まで取りに行かない
  function notify() { ctx.onChange(); }
  async function poll() {
    if (!enabled || inFlight) return;
    const now = ctx.now();
    if (!queue.length) {
      if (now < nextAt) return;
      // 新しい1周：今配信している掲示板を集め直す
      const targets = activityTargets(ctx.channels());
      rows = new Map([...rows].filter(([key]) => targets.has(key)));
      queue = [...targets.values()];
      total = queue.length;
      plan = roundPlan(total, interval());
      roundStart = now;
      nextAt = total ? now + plan.round : 0;
      nextRequestAt = now;
      notify();
      if (!queue.length) return;
    }
    if (now < nextRequestAt) return;
    const target = queue.shift();
    const prev = rows.get(target.key);
    const until = busyUntil.get(siteOf(target.key));
    if (until && now < until) {
      // 混んでいると言われた掲示板サイトは、待つ時間が過ぎるまで取りに行かない（前回の値はそのまま）
      rows.set(target.key, { ...prev, ...target, loading: false, busy: true });
      notify();
      return poll();
    }
    nextRequestAt = now + plan.gap;
    inFlight = true;
    const current = generation;
    rows.set(target.key, { ...prev, ...target, loading: true });
    notify();
    try {
      const text = await ctx.fetch(target.url);
      if (!enabled || current !== generation) return;
      const at = ctx.now();
      const result = measureActivity(prev?.baseline, parseSubject(text), at, plan.round * 1.5);
      rows.set(target.key, { ...target, ...result, at, loading: false });
    } catch (error) {
      if (!enabled || current !== generation) return;
      const wait = busyWait(error);
      if (wait !== null) {
        busyUntil.set(siteOf(target.key), ctx.now() + wait);
        rows.set(target.key, { ...prev, ...target, loading: false, busy: true });
      } else {
        rows.set(target.key, { ...target, count: null, loading: false, error: String(error) });
      }
    } finally {
      if (current === generation) inFlight = false;
      notify();
    }
  }
  return {
    setEnabled(value) {
      if (enabled === !!value) return;
      enabled = !!value; generation++; rows.clear();
      queue = []; total = 0; nextAt = 0; nextRequestAt = 0; inFlight = false;
      notify();
      if (enabled) void poll();
    },
    // 取得間隔を変えたら、次の周をその間隔で数え直す（今の周の途中なら、残りは新しい間隔で散らす）
    intervalChanged() {
      if (!enabled || !total) return;
      plan = roundPlan(total, interval());
      nextAt = roundStart + plan.round;
      if (queue.length) nextRequestAt = Math.min(nextRequestAt, ctx.now() + plan.gap);
      notify();
    },
    tick() { return poll(); },
    snapshot() {
      return { enabled, running: queue.length > 0 || inFlight, done: total - queue.length - (inFlight ? 1 : 0), total, nextAt, rows: [...rows.values()] };
    },
  };
}
