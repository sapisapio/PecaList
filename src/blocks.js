// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// ブロックリスト：一致したチャンネルの録画やプレイヤー起動を止める（ペカレコと同じ仕組み）。
// チャンネル名とホスト名（配信者の IP から調べた名前）を正規表現で比べる。
// ホスト名は、チャンネル名が一致したときだけ調べる（毎回調べると遅く、相手にも問い合わせが行くため）。

import { normalizePattern } from './filters.js';

// 止める操作
export const BLOCK_OPS = [
  ['manualRecord', '手動の録画'],
  ['autoRecord', '自動録画'],
  ['manualPlay', '手動の再生・ツール'],
  ['autoPlay', '自動の再生'],
];

export function newBlock(over = {}) {
  return {
    enabled: true, name: '', host: '', icase: true, width: true,
    manualRecord: true, autoRecord: true, manualPlay: true, autoPlay: true,
    ...over,
  };
}

function compileRe(src, b) {
  if (!src) return null;
  try {
    return new RegExp(b.width ? normalizePattern(src) : src, b.icase ? 'i' : '');
  } catch {
    return undefined; // 正規表現として正しくない
  }
}

export function compileBlock(b) {
  return { b, name: compileRe(b.name, b), host: compileRe(b.host, b) };
}

export const blockInvalid = (cb) => cb.name === undefined || cb.host === undefined;
const norm = (s, b) => (b.width ? (s || '').normalize('NFKC') : s || '');

// 操作 op について、チャンネル名の条件まで一致しているか（ホスト名の条件はまだ見ない）
export function blockNameMatches(cb, ch, op) {
  const b = cb.b;
  if (!b.enabled || !b[op] || blockInvalid(cb) || (!cb.name && !cb.host)) return false;
  return !cb.name || cb.name.test(norm(ch.name, b));
}

export const blockNeedsHost = (cb) => !!cb.host;

export function blockHostMatches(cb, host) {
  return !cb.host || (!!host && cb.host.test(norm(host, cb.b)));
}

// 配信者の IP（TIP の「IP:ポート」から IP だけ）
export function tipIp(tip) {
  const t = (tip || '').trim();
  const v6 = /^\[([^\]]+)\]/.exec(t);
  if (v6) return v6[1];
  return t.replace(/:\d+$/, '');
}
