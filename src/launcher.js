// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

import { streamUrl, playlistUrl } from './yp.js';

// プレイヤーやツールに渡す引数の置き換え記号。
// ペカレコと同じ書き方（"$x" "$0" "$3" など）をそのまま使える。記号の意味もペカレコと同じ。
//  $0〜$9 は YP の index.txt の項目の順番、$A〜$L はその他の項目。
//  大文字の $X $Y $Z はペカステのアドレスを書いたまま、小文字は localhost を 127.0.0.1 に直したもの。
export const PLACEHOLDER_HELP = [
  ['$x', 'プレイリストURL'],
  ['$y', 'ストリームURL'],
  ['$z', 'ペカステの IP:ポート'],
  ['$X $Y $Z', '同じ（アドレスを書いたまま）'],
  ['$0', 'チャンネル名'],
  ['$1', 'チャンネルID'],
  ['$2', 'TIP（配信者のIP:ポート）'],
  ['$3', 'コンタクトURL'],
  ['$4', 'ジャンル'],
  ['$5', '詳細'],
  ['$6', 'リスナー数'],
  ['$7', 'リレー数'],
  ['$8', 'ビットレート'],
  ['$9', '形式（FLV など）'],
  ['$T', '形式（小文字）'],
  ['$A', 'アーティスト'],
  ['$B', 'タイトル'],
  ['$C', 'アルバム'],
  ['$E', 'チャンネル名（URL用）'],
  ['$F', '配信時間'],
  ['$G', 'ステータス'],
  ['$H', 'コメント'],
  ['$I', 'ダイレクト（1/0）'],
  ['$J', 'YP名'],
  ['$K', 'YPのURL'],
  ['$L', 'フィルタ名'],
  ['$$', '$ そのもの'],
];

// ペカレコの小文字の記号は「ホスト名を IP に直したもの」。名前の解決はせず、localhost だけ直す
const toIp = (hostPort) => hostPort.replace(/^localhost(?=:|$)/i, '127.0.0.1');

function values(ch, peercast, extra = {}) {
  return {
    X: playlistUrl(ch, peercast), x: playlistUrl(ch, toIp(peercast)),
    Y: streamUrl(ch, peercast), y: streamUrl(ch, toIp(peercast)),
    Z: peercast, z: toIp(peercast),
    0: ch.name, 1: ch.id, 2: ch.tip, 3: ch.contactUrl, 4: ch.genre,
    5: ch.detail, 6: String(ch.listeners), 7: String(ch.relays), 8: String(ch.bitrate), 9: ch.type,
    T: (ch.type || '').toLowerCase(),
    A: ch.trackArtist, B: ch.trackTitle, C: ch.trackAlbum, D: '',
    E: encodeURIComponent(ch.name || ''), F: ch.uptime, G: ch.status, H: ch.comment, I: ch.direct ? '1' : '0',
    J: ch.ypName, K: ch.ypUrl, L: extra.filterName || '',
    $: '$',
  };
}

// 引数の文字列を、ダブルクォートを考えながら1つずつに分ける。
// 例：  "$x" "$0" "$3"  →  ['$x', '$0', '$3']
export function splitArgs(s) {
  const out = [];
  let cur = '', inQuote = false, has = false;
  for (const c of s || '') {
    if (c === '"') { inQuote = !inQuote; has = true; continue; }
    if (!inQuote && /\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = ''; has = false;
      continue;
    }
    cur += c; has = true;
  }
  if (has || cur) out.push(cur);
  return out;
}

// 分けた後で置き換えるので、チャンネル名に空白があっても1つの引数のまま渡る
export function buildArgs(template, ch, peercast, extra) {
  const v = values(ch, peercast, extra);
  return splitArgs(template).map((a) => a.replace(/\$([xyzXYZ0-9A-LT$])/g, (m, k) => v[k] ?? ''));
}

// 形式に合うプレイヤーを探す（上にあるものが優先）
export function findPlayer(players, ch) {
  return players.find((p) => {
    if (!p.enabled || !p.path) return false;
    try { return new RegExp(`^(?:${p.type || '.*'})$`, 'i').test(ch.type || ''); }
    catch { return false; }
  }) || null;
}

export function bbsMatches(bbs, url) {
  if (!bbs || !bbs.path || !url) return false;
  try { return new RegExp(bbs.urlRegex || '.*', 'i').test(url); }
  catch { return false; }
}
