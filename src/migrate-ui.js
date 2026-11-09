// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// ペカレコからの引っ越し：PeCaRecorder.exe を選び、内容を確かめてから、設定・フィルタを取り込む。

import { parsePecarecXml } from './pecarec.js';
import { parseFilterXml, autoRecords } from './filters.js';
import { DEFAULT_YPS, ypKey } from './yp.js';

const tauri = window.__TAURI__;
const $ = (id) => document.getElementById(id);

const ACTION_LABEL = { play: '再生', bbs: '掲示板を開く', contact: 'コンタクトURLを開く', record: '録画する', none: '何もしない' };

// ctx：settings, saveSettings, getFilters, setFilters, afterImport, toast
export function initMigrateUI(ctx) {
  let plan = null; // { dir, conf, filters }

  function li(label, value, sub) {
    const e = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = label + '：';
    e.append(b, document.createTextNode(value));
    if (sub) {
      const s = document.createElement('span');
      s.className = 'sub';
      s.textContent = '（' + sub + '）';
      e.append(' ', s);
    }
    return e;
  }

  function summary(c) {
    const out = [];
    if (c.yps) {
      const have = new Set(c.yps.map((y) => ypKey(y.url)));
      const add = DEFAULT_YPS.filter((y) => !have.has(ypKey(y.url))).map((y) => y.name);
      out.push(li('YP', `${c.yps.length}件（使うもの ${c.yps.filter((y) => y.enabled).length}件）`,
        add.length ? `PecaList に初めからある ${add.join('・')} は後ろに足します` : ''));
    }
    if (c.players) {
      out.push(li('プレイヤー', `${c.players.length}件`, '今使っているプレイヤーの場所をそのまま使います'));
    }
    if (c.bbs) out.push(li('掲示板ブラウザ', c.bbs.path));
    if (c.peercast) out.push(li('PeerCast の場所', c.peercast));
    if (c.autoOn !== undefined) out.push(li('自動更新', c.autoOn ? `${Math.round(c.autoSec / 60)}分ごと（起動したらすぐ始める）` : `オフ（${Math.round(c.autoSec / 60)}分ごと）`));
    if (c.recDir) out.push(li('録画の保存先', c.recDir, c.recSubFolder ? 'チャンネルごとにフォルダを作る' : ''));
    if (c.dblAction) out.push(li('クリック', `ダブルクリック：${ACTION_LABEL[c.dblAction]}、中クリック：${ACTION_LABEL[c.midAction]}`));
    if (c.notifyFav !== undefined) out.push(li('通知', [c.notifyFav ? 'お気に入りの配信開始' : '', c.notifyAllNew ? '新着すべて' : ''].filter(Boolean).join('・') || '通知しない', c.soundPath ? `通知音：${c.soundPath}` : ''));
    if (c.tools) out.push(li('ツール', `${c.tools.length}件`));
    if (c.blocks) out.push(li('ブロックリスト', `${c.blocks.length}件`));
    return out;
  }

  async function open() {
    if (!tauri) { ctx.toast('アプリの中でのみ使えます'); return; }
    // フォルダを探すより分かりやすいので、PeCaRecorder.exe そのものを選んでもらい、そのフォルダを読む
    const exe = await tauri.core.invoke('plugin:dialog|open', { options: { directory: false, multiple: false,
      title: 'PeCaRecorder.exe を選んでください', filters: [{ name: 'ペカレコ', extensions: ['exe'] }] } });
    if (!exe) return;
    const dir = exe.replace(/[\\/][^\\/]*$/, '');
    let files, conf = { skipped: [] }, filters = null;
    try {
      files = await tauri.core.invoke('pecarec_read', { dir });
      if (files.pecarec) conf = parsePecarecXml(files.pecarec, dir);
      if (files.filter) filters = parseFilterXml(files.filter);
    } catch (e) {
      ctx.toast('読み込めませんでした：' + (e.message || e));
      return;
    }
    plan = { dir, conf, filters };

    $('mig-dir').textContent = `${dir} から、次の内容を取り込みます。今の PecaList の設定は、この内容で置き換わります。`;
    $('mig-list').replaceChildren(...summary(conf));
    $('mig-skip').textContent = conf.skipped.length ? `取り込まないもの：${conf.skipped.join('、')}` : '';

    $('mig-filter-sec').hidden = !filters;
    if (filters) {
      const current = ctx.getFilters().length;
      $('mig-filter-mode-row').hidden = current === 0;
      $('mig-filter-mode').value = 'replace';
      const fav = filters.filter((f) => f.favorite).length;
      const auto = filters.filter(autoRecords).length;
      $('mig-auto-row').hidden = auto === 0;
      $('mig-auto').value = 'off';
      $('mig-auto-text').textContent = `フィルタ ${filters.length}個（お気に入り ${fav}個）。そのうち ${auto}個が「自動録画」です。PecaList でも自動録画にすると、当たる配信が始まったときに PecaList が録画を始めます（ペカレコも動かしていると、同じ配信を両方で録ります）。`;
      if (current > 0) $('mig-filter-mode-row').querySelector('label').textContent = `今あるフィルタ（${current}個）`;
    }
    $('mig-err').textContent = '';
    $('mig').hidden = false;
  }

  async function go() {
    if (!plan) return;
    const { conf, filters } = plan;
    const s = ctx.settings;
    // 設定（読めた項目だけ置き換える）
    if (conf.yps) {
      const have = new Set(conf.yps.map((y) => ypKey(y.url)));
      // 名前が重なると片方しか取得されないので、後ろのものに番号を付ける
      const names = new Set();
      const yps = [...conf.yps, ...DEFAULT_YPS.filter((y) => !have.has(ypKey(y.url))).map((y) => ({ ...y }))].map((y) => {
        let name = y.name, n = 2;
        while (names.has(name)) name = `${y.name} (${n++})`;
        names.add(name);
        return { ...y, name };
      });
      s.yps = yps;
    }
    for (const k of ['players', 'bbs', 'peercast', 'timeoutMs', 'autoOn', 'autoSec', 'recDir', 'recSubFolder',
      'notifyFav', 'notifyAllNew', 'soundOn', 'soundPath', 'dblAction', 'midAction', 'tools', 'blocks']) {
      if (conf[k] !== undefined) s[k] = conf[k];
    }
    // フィルタ
    let filterNote = '';
    if (filters && $('mig-filter-mode').value !== 'skip') {
      const list = $('mig-auto').value === 'on' ? filters : filters.map((f) => ({ ...f, download: false }));
      const mode = ctx.getFilters().length ? $('mig-filter-mode').value : 'replace';
      ctx.setFilters(mode === 'append' ? [...ctx.getFilters(), ...list] : list);
      filterNote = `、フィルタ ${filters.length}個`;
    }
    ctx.saveSettings();
    $('mig').hidden = true;
    plan = null;
    ctx.afterImport();
    ctx.toast(`ペカレコの設定${filterNote}を取り込みました`);
  }

  $('mig-open').addEventListener('click', open);
  $('mig-cancel').addEventListener('click', () => { $('mig').hidden = true; plan = null; });
  $('mig-go').addEventListener('click', go);
}
