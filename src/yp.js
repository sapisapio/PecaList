// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// YP の index.txt を読む。
// 1行が1チャンネルで、項目は "<>" で区切られている。
//  0 チャンネル名        1 チャンネルID        2 配信者のIP:ポート（TIP）
//  3 コンタクトURL       4 ジャンル            5 詳細
//  6 リスナー数          7 リレー数            8 ビットレート
//  9 形式（FLV など）   10 アーティスト        11 曲名
// 12 アルバム           13 曲情報のURL        14 チャンネル名（URLエンコード）
// 15 配信時間（h:mm）   16 状態                17 コメント
// 18 ダイレクト（1/0）

export const DEFAULT_YPS = [
  { enabled: true, name: 'SP', url: 'http://bayonet.ddo.jp/sp/' },
  { enabled: true, name: 'p@', url: 'https://p-at.net/' },
  { enabled: true, name: 'イベントYP', url: 'http://eventyp.xrea.jp/' },
  { enabled: true, name: '平成YP', url: 'http://yp.pcgw.pgw.jp/' },
];

// ペカレコの設定にある崩れたアドレスを直す。
// 「http://…/ /」のように後ろに空白と文字が付いたもの → 空白より前だけ
// 「ttp://…」（2ちゃんねる式の h 抜き） → http://
export function cleanYpUrl(url) {
  const u = (url || '').trim().split(/\s+/)[0] || '';
  return /^ttps?:\/\//i.test(u) ? 'h' + u : u;
}

// 取得に使えるアドレスか
export const isValidYpUrl = (url) => /^https?:\/\/[^\s/]+/i.test(cleanYpUrl(url));

// YP のアドレスから index.txt のアドレスを作る。
// ペカレコと同じ「http://bayonet.ddo.jp/sp/」の形でも、index.txt まで書いた形でもよい
export function ypIndexUrl(url) {
  const u = cleanYpUrl(url);
  if (/\.txt(\?.*)?$/i.test(u)) return u;
  return u.replace(/\/?$/, '/') + 'index.txt';
}

// 同じ YP かどうかを比べるための形。http と https、「www.」の有無、大文字小文字は同じとみなす
// （ペカレコの設定の p@ が http で、PecaList の初めの p@ が https だと、同じ YP を2回取りに行き、同じ配信が2行出ていた）
export const ypKey = (url) => ypIndexUrl(url).replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();

// イベントYP：ゲームのイベントなどを日付つきで知らせるYP。お知らせにはまとめず、一覧の一番下に出す
export function isEventYp(url) {
  return /\/\/eventyp\.xrea\.jp\//i.test(ypIndexUrl(url));
}

// 設定の YP 一覧を整える（名前の重複・空欄をなくす）。使うものだけを、取得に使う形で返す
export function activeYps(list) {
  const seen = new Set(), seenUrl = new Set();
  const out = [];
  for (const y of list || []) {
    const name = (y.name || '').trim();
    const url = cleanYpUrl(y.url);
    // 名前が同じもの、アドレスが同じ YP（http と https の違いなど）は、先のものだけ取得する
    if (!y.enabled || !name || !isValidYpUrl(url) || seen.has(name) || seenUrl.has(ypKey(url))) continue;
    seen.add(name);
    seenUrl.add(ypKey(url));
    out.push({ name, url: ypIndexUrl(url), event: isEventYp(url) });
  }
  return out;
}

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#039;': "'", '&#39;': "'" };

export function unescapeHtml(s) {
  return (s || '').replace(/&(lt|gt|amp|quot|#0?39);/g, (m) => ENTITIES[m] ?? m);
}

function toInt(s, fallback) {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

// "h:mm" を分に直す。読めなければ -1
function uptimeMinutes(s) {
  const m = /^(\d+):(\d{1,2})$/.exec((s || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

export function parseIndexTxt(text, yp) {
  const channels = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const f = raw.split('<>');
    if (f.length < 10) continue;
    const listeners = toInt(f[6], -1);
    channels.push({
      key: yp.name + '/' + (f[1] || '') + '/' + (f[0] || ''),
      name: unescapeHtml(f[0]),
      id: f[1] || '',
      tip: f[2] || '',
      contactUrl: unescapeHtml(f[3]),
      genre: unescapeHtml(f[4]),
      detail: unescapeHtml(f[5]),
      listeners,
      relays: toInt(f[7], -1),
      bitrate: toInt(f[8], 0),
      type: f[9] || '',
      trackArtist: unescapeHtml(f[10]),
      trackTitle: unescapeHtml(f[11]),
      trackAlbum: unescapeHtml(f[12]),
      trackUrl: unescapeHtml(f[13]),
      uptime: f[15] || '',
      uptimeMin: uptimeMinutes(f[15]),
      status: f[16] || '',
      comment: unescapeHtml(f[17]),
      direct: f[18] === '1',
      // YP 自身のお知らせ（リスナー数が -9 になっている行）
      info: listeners <= -9 && !yp.event,
      // イベントYP の行
      event: !!yp.event,
      ypName: yp.name,
      ypUrl: yp.url,
    });
  }
  return channels;
}

// ペカステ経由で再生するときのURL（PeerCast 共通の形式）
export function streamUrl(ch, peercast) {
  const ext = ch.type ? '.' + ch.type.toLowerCase() : '';
  const tip = ch.tip ? '?tip=' + encodeURIComponent(ch.tip) : '';
  return `http://${peercast}/stream/${ch.id}${ext}${tip}`;
}

export function playlistUrl(ch, peercast) {
  const tip = ch.tip ? '?tip=' + encodeURIComponent(ch.tip) : '';
  return `http://${peercast}/pls/${ch.id}${tip}`;
}

// 一覧に出す「詳細」の文字列を作る。
//   ジャンル - 概要 - 「配信者コメント」
// ・ジャンルを別の列に出すときは、ジャンルを含めない
// ・概要の <Open> / <Free> は、表示する設定でなければ取り除く
// ・取り除いて空になった部分は、その前後の「 - 」ごと詰める
const OPEN_FREE = /<\s*(open|free)\s*>/gi;
export function cleanDescription(s, showOpenFree) {
  let t = s || '';
  if (!showOpenFree) t = t.replace(OPEN_FREE, '');
  return t
    .split(/\s+-\s+|^\s*-\s*|\s*-\s*$/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' - ');
}

export function composeDetail(ch, { splitGenre = false, showOpenFree = false } = {}) {
  const parts = [];
  if (!splitGenre && ch.genre) parts.push(ch.genre);
  const d = cleanDescription(ch.detail, showOpenFree);
  if (d) parts.push(d);
  if (ch.comment) parts.push(`「${ch.comment}」`);
  return parts.join(' - ');
}

// 長時間配信の目印。NEWとは別に表示する。
// 長時間の配信：12時間以上なら配信時間（時間、切り捨て）を返す。それ未満・お知らせ・イベントは 0
export function longHours(ch) {
  if (ch.info || ch.event) return 0;
  const minutes = ch.uptimeMin;
  if (!Number.isFinite(minutes) || minutes < 12 * 60) return 0;
  return Math.floor(minutes / 60);
}

// 「長」の色：12時間でオレンジ、99時間で真っ赤。その間は少しずつ赤に近づける
export function longColor(hours) {
  const t = Math.min(1, Math.max(0, (hours - 12) / (99 - 12)));
  return `hsl(${Math.round(30 * (1 - t))} 90% 48%)`;
}

// 同じ配信が複数の YP に載っているとき（チャンネルIDが同じ）や、同じ YP に同じ行が2回あるときは1行にまとめる。
// 先の YP（設定の並び順）の行を残し、YP の欄に「SP / p@」のように並べる。お知らせ・イベントはまとめない
export function mergeSameChannels(list) {
  const out = [], byId = new Map(), keys = new Set();
  for (const ch of list) {
    if (keys.has(ch.key)) continue;
    keys.add(ch.key);
    const id = (ch.id || '').toUpperCase();
    if (!ch.info && !ch.event && /^[0-9A-F]{32}$/.test(id) && !/^0+$/.test(id)) {
      const i = byId.get(id);
      if (i !== undefined) {
        const first = out[i];
        const yps = [first.ypName, ...(first.alsoYps || [])];
        if (!yps.includes(ch.ypName)) {
          const alsoYps = [...(first.alsoYps || []), ch.ypName];
          out[i] = { ...first, alsoYps, sourceLabel: [first.ypName, ...alsoYps].join(' / ') };
        }
        continue;
      }
      byId.set(id, out.length);
    }
    out.push(ch);
  }
  return out;
}
