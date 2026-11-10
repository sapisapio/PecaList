// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// 「終了」タブと「再生中」タブの中身の計算（画面に触らない）。

export const ENDED_KEEP_MS = 3 * 60 * 60 * 1000; // 終わった配信を出しておく時間
export const ENDED_MAX = 300;

const realId = (ch) => {
  const id = (ch.id || '').toUpperCase();
  return /^[0-9A-F]{32}$/.test(id) && !/^0+$/.test(id) ? id : '';
};

// 更新の前後の一覧を比べ、消えた配信を ended（key → 最後に見えたときの中身＋終わった時刻）に入れる。
// また見えるようになった配信は ended から外す。別の YP の行として残っている配信（同じチャンネルID）は終わっていない。
// 取得に失敗した YP は前回の一覧を残しているので、失敗しただけでは終わったことにならない
export function updateEnded(ended, before, after, now) {
  const liveKeys = new Set(after.map((c) => c.key));
  const liveIds = new Set(after.map(realId).filter(Boolean));
  for (const [key, c] of ended) if (liveKeys.has(key) || liveIds.has(realId(c))) ended.delete(key);
  for (const c of before) {
    if (c.info || c.event || liveKeys.has(c.key) || liveIds.has(realId(c))) continue;
    ended.set(c.key, { ...c, ended: now });
  }
  pruneEnded(ended, now);
  return ended;
}

export function pruneEnded(ended, now) {
  for (const [key, c] of ended) if (now - c.ended > ENDED_KEEP_MS) ended.delete(key);
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
