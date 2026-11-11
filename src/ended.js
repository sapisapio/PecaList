// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// 「終了」タブと「再生中」タブの中身の計算（画面に触らない）。

// 終わった配信を出しておく時間（分）。'refresh' は次の更新まで
export const ENDED_KEEPS = [['refresh', '次の更新まで'], [60, '1時間'], [180, '3時間'], [1440, '24時間']];
export const DEFAULT_ENDED_KEEP = 180;
export const ENDED_MAX = 1000;
export const endedKeepOf = (v) => ENDED_KEEPS.some(([k]) => k === v) ? v : DEFAULT_ENDED_KEEP;
export const endedKeepLabel = (v) => ENDED_KEEPS.find(([k]) => k === endedKeepOf(v))[1];
// 配信者名は全角半角・大文字小文字をそろえて比べる
const nameKey = (c) => (c.name || '').normalize('NFKC').trim().toLocaleLowerCase('ja-JP');

const realId = (ch) => {
  const id = (ch.id || '').toUpperCase();
  return /^[0-9A-F]{32}$/.test(id) && !/^0+$/.test(id) ? id : '';
};

// 更新の前後の一覧を比べ、消えた配信を ended（key → 最後に見えたときの中身＋終わった時刻）に入れる。
// また見えるようになった配信は ended から外す（チャンネルIDが変わっていても、同じ配信者名なら外す）。
// 同じ配信者名の終わった配信は、いちばん新しいもの1つだけ残す。
// 別の YP の行として残っている配信（同じチャンネルID）は終わっていない。
// 取得に失敗した YP は前回の一覧を残しているので、失敗しただけでは終わったことにならない
export function updateEnded(ended, before, after, now, keep = DEFAULT_ENDED_KEEP) {
  if (endedKeepOf(keep) === 'refresh') ended.clear();
  const live = after.filter((c) => !c.info && !c.event);
  const liveKeys = new Set(live.map((c) => c.key));
  const liveIds = new Set(live.map(realId).filter(Boolean));
  const liveNames = new Set(live.map(nameKey));
  const isLive = (c) => liveKeys.has(c.key) || liveIds.has(realId(c)) || liveNames.has(nameKey(c));
  for (const [key, c] of ended) if (isLive(c)) ended.delete(key);
  for (const c of before) {
    if (c.info || c.event || isLive(c)) continue;
    for (const [key, e] of ended) if (nameKey(e) === nameKey(c)) ended.delete(key);
    ended.set(c.key, { ...c, ended: now });
  }
  pruneEnded(ended, now, keep);
  return ended;
}

export function pruneEnded(ended, now, keep = DEFAULT_ENDED_KEEP) {
  const k = endedKeepOf(keep);
  if (k !== 'refresh') for (const [key, c] of ended) if (now - c.ended > k * 60_000) ended.delete(key);
  if (ended.size > ENDED_MAX) {
    const old = [...ended.values()].sort((a, b) => a.ended - b.ended).slice(0, ended.size - ENDED_MAX);
    for (const c of old) ended.delete(c.key);
  }
}

// ペカステで再生中のチャンネル（peercast_playing の答え）を、一覧の行にする。
// YP の一覧にあればその行を、終わった配信にあればその行を使い、どこにもなければペカステの情報で行を作る
export function playingRows(playing, live, ended) {
  const byId = new Map();
  for (const c of [...ended, ...live]) { const id = realId(c); if (id) byId.set(id, c); } // YP の行を優先
  return playing.map((p) => {
    const found = byId.get(p.channelId);
    if (found) return found;
    const min = Math.floor((p.uptime || 0) / 60);
    return {
      key: 'local/' + p.channelId, name: p.name || '(名前なし)', id: p.channelId, tip: '',
      contactUrl: p.url || '', genre: p.genre || '', detail: p.desc || '', comment: p.comment || '',
      listeners: p.listeners ?? -1, relays: p.relays ?? -1, bitrate: p.bitrate || 0, type: p.contentType || '',
      trackArtist: '', trackTitle: '', trackAlbum: '', trackUrl: '',
      uptime: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`, uptimeMin: min,
      status: '', direct: false, info: false, event: false, ypName: 'ペカステ', ypUrl: '',
    };
  });
}
