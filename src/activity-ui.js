// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later
import { createActivityMonitor } from './activity.js';
import { buildRankHead } from './rank-cols.js';

export function initActivityUI(ctx) {
  const $ = id => document.getElementById(id);
  const monitor = createActivityMonitor({ channels: ctx.channels, fetch: ctx.fetch, now: () => Date.now(), onChange: render });
  function render() {
    const state = monitor.snapshot();
    $('activity-enabled').checked = state.enabled;
    const box = $('activity-results');
    box.replaceChildren();
    $('activity-status').textContent = !state.enabled ? 'OFF：掲示板への取得は行いません'
      : state.running ? `取得中（${state.done}/${state.total}）`
      : state.nextAt ? `次回取得 ${new Date(state.nextAt).toLocaleTimeString('ja-JP')}` : '対応する掲示板の取得待ち';
    if (!state.enabled) return;
    if (!state.rows.length) {
      const p = document.createElement('p'); p.className = 'none'; p.textContent = '配信中のチャンネルに、対応するコンタクトURLがありません。'; box.append(p); return;
    }
    const table = document.createElement('table'); table.className = 'rank-table';
    buildRankHead(table, 'activity', [
      { label: '順位', w: 50 }, { label: '配信者', w: 260 }, { label: '増えたレス数', w: 150 },
      { label: '比較期間', w: 90 }, { label: '掲示板', w: 220 }, { label: '取得時刻', w: 90 },
    ], ctx);
    const body = document.createElement('tbody');
    const rows = state.rows.sort((a,b) => (b.count ?? -1) - (a.count ?? -1));
    let rank = 0, last = null;
    rows.forEach((r,i) => {
      if (r.count !== last) rank = i + 1;
      last = r.count;
      const tr = document.createElement('tr');
      const count = r.loading && r.count == null ? '取得中…'
        : r.busy ? (r.count == null ? '混雑のため次回' : `${r.count}件（前回）`)
        : r.error ? '取得失敗' : r.count == null ? '計測待ち（基準取得済み）' : `${r.count}件`;
      for (const value of [r.count == null ? '−' : rank, [...r.channels].join(' / '), count, r.count == null ? '−' : `${(r.elapsed / 60000).toFixed(1)}分`, r.name, r.at ? new Date(r.at).toLocaleTimeString('ja-JP') : '−']) {
        const td = document.createElement('td'); td.textContent = value;
        if (r.error) td.title = r.error;
        else if (r.busy) td.title = '掲示板が混んでいると返したので、しばらく待ってから取り直します';
        tr.append(td);
      }
      body.append(tr);
    });
    table.append(body); box.append(table);
  }
  $('activity-enabled').addEventListener('change', () => {
    ctx.settings.activityEnabled = $('activity-enabled').checked;
    ctx.saveSettings();
    monitor.setEnabled(ctx.settings.activityEnabled);
  });
  setInterval(() => { void monitor.tick(); }, 1000);
  return {
    sync() { monitor.setEnabled(ctx.settings.activityEnabled); void monitor.tick(); },
    render,
  };
}
