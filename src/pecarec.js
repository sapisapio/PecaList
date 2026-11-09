// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// ペカレコ（PeCaRecorder v0.63 以降）の設定ファイル PeCaRecorder.xml を読んで、PecaList の設定に直す。
// 項目の意味は、ペカレコ本体の画面の文字と、実際の設定ファイルで確かめた（NEXUS_PLAN.md「ペカレコからの引っ越し」）。

import { newBlock } from './blocks.js';
import { cleanYpUrl } from './yp.js';
import { cleanDir } from './recording.js';

// ペカレコの設定に書かれた場所を、ペカレコのフォルダから見た場所として直す（「PCRPlayer\PCRPlayer.exe」など）
export function resolvePath(p, base) {
  const s = (p || '').trim();
  if (!s || /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\')) return s;
  return base.replace(/[\\/]+$/, '') + '\\' + s.replace(/^\.?[\\/]/, '');
}

// ダブルクリック・中クリックの番号（ペカレコの右クリックメニュー「…の動作」の並び）
const DOUBLE = ['play', 'record', 'record'];          // 再生 / ダウンロード開始 / ダウンロードリストに追加
const MIDDLE = ['bbs', 'contact', 'record', 'record']; // 2chブラウザで開く / コンタクトURLを開く / ダウンロード開始 / リストに追加
export const doubleAction = (n) => DOUBLE[n] ?? 'play';
export const middleAction = (n) => MIDDLE[n] ?? 'none';


const attr = (el, name) => el?.getAttribute(name) ?? null;
const bool = (el, name) => attr(el, name) === 'true';
const int = (el, name, d) => {
  const n = parseInt(attr(el, name) ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

// PeCaRecorder.xml を読む。dir はペカレコのフォルダ。
// 返すもの：PecaList の設定に入れる値（読めた項目だけ）と、画面に出す説明のための数
export function parsePecarecXml(text, dir) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XMLとして読めませんでした');
  const root = doc.documentElement;
  if (root.tagName !== 'root') throw new Error('ペカレコの PeCaRecorder.xml ではないようです');
  const q = (sel) => root.querySelector(':scope > ' + sel);
  const items = (sel) => [...root.querySelectorAll(`:scope > ${sel} > item`)];
  const out = { skipped: [] };

  // YP
  const yps = items('yellowPage').map((it) => ({ enabled: bool(it, 'enable'), name: (attr(it, 'name') || '').trim(), url: cleanYpUrl(attr(it, 'url')) }))
    .filter((y) => y.name && y.url);
  if (yps.length) out.yps = yps;

  // 通信
  const net = q('network > base');
  if (net) {
    if (attr(net, 'host')) out.peercast = attr(net, 'host').trim();
    out.timeoutMs = Math.min(60000, Math.max(1000, int(net, 'timeout', 10000)));
  }

  // プレイヤーは今使っている実行ファイルの場所と引数をそのまま引き継ぐ
  const players = [];
  for (const it of items('player')) {
    const path = resolvePath(attr(it, 'path'), dir);
    if (bool(it, 'browser')) { out.skipped.push(`Webブラウザで開くプレイヤー（${attr(it, 'type') || ''}）`); continue; }
    if (!path) continue;
    const p = { enabled: bool(it, 'enable'), path, args: attr(it, 'arg') || '', type: attr(it, 'type') || '' };
    players.push(p);
  }
  if (players.length) out.players = players;

  // 掲示板ブラウザ（「その他」に登録したブラウザ）
  const other = q('browser > other');
  if (other && attr(other, 'path')) out.bbs = { path: resolvePath(attr(other, 'path'), dir), urlRegex: attr(other, 'url') || '.*' };

  // 自動更新（間隔は分）
  const auto = q('refresh > auto');
  if (auto) {
    out.autoOn = bool(auto, 'start');
    out.autoSec = Math.max(30, int(auto, 'interval', 1) * 60);
  }

  // 録画（ダウンロード）
  const dl = q('download > base');
  if (dl && attr(dl, 'path')) {
    out.recDir = cleanDir(resolvePath(attr(dl, 'path'), dir));
    out.recSubFolder = bool(dl, 'subFolder');
  }

  // 通知
  const nb = q('notify > base');
  if (nb) { out.notifyFav = bool(nb, 'favorite'); out.notifyAllNew = bool(nb, 'new'); }
  const alarm = q('notify > alarm');
  if (alarm && attr(alarm, 'path')) { out.soundOn = bool(alarm, 'enable'); out.soundPath = resolvePath(attr(alarm, 'path'), dir); }

  // ダブルクリック・中クリック
  const op = q('operation > channel');
  if (op) { out.dblAction = doubleAction(int(op, 'double', 0)); out.midAction = middleAction(int(op, 'middle', 0)); }

  // ツール（<tool><item enable name path arg browser connect/></tool>。サピオさんの設定で確かめた）
  const tools = items('tool').map((it) => ({
    enabled: attr(it, 'enable') !== 'false', name: attr(it, 'name') || '', path: resolvePath(attr(it, 'path'), dir),
    args: attr(it, 'arg') || '', browser: bool(it, 'browser'),
  })).filter((t) => t.name || t.path);
  if (tools.length) out.tools = tools;

  // ブロックリスト（項目名はペカレコ本体の中の名前から推測。実物の設定ではまだ確かめていない）
  const blocks = items('block').map((it) => newBlock({
    enabled: attr(it, 'enable') !== 'false', name: attr(it, 'name') || '', host: attr(it, 'host') || '',
    icase: attr(it, 'icase') !== 'false', width: attr(it, 'width') !== 'false',
    manualRecord: attr(it, 'download') !== 'false', autoRecord: attr(it, 'autoDownload') !== 'false',
    manualPlay: attr(it, 'player') !== 'false', autoPlay: attr(it, 'autoPlayer') !== 'false',
  })).filter((b) => b.name || b.host);
  if (blocks.length) out.blocks = blocks;

  return out;
}
