// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later
import { linkify } from './links.js';
import { rankDay, emptyRanking, normalizeRanking, recordPeaks, rankRows } from './ranking.js';
import { loadStore, saveStoreSoon } from './store.js';
import { buildRankHead } from './rank-cols.js';

export function initRankingUI(ctx) {
  const $ = (id) => document.getElementById(id);
  let data = emptyRanking();
  $('rank-date').value = rankDay(new Date());
  $('rank-month').value = rankDay(new Date()).slice(0, 7);
  function render() {
    const monthly = $('rank-period').value === 'months';
    $('rank-date').hidden = monthly;
    $('rank-month').hidden = !monthly;
    $('rank-current').textContent = monthly ? '今月' : '今日';
    const period = $(monthly ? 'rank-month' : 'rank-date').value;
    const rows = rankRows(data, monthly ? 'months' : 'days', period);
    const box = $('rank-results');
    box.replaceChildren();
    if (!rows.length) {
      const message = document.createElement('p');
      message.className = 'none';
      message.textContent = 'この期間の記録はありません。PecaListで取得した配信から記録します。';
      box.append(message);
      return;
    }
    const table = document.createElement('table');
    table.className = 'rank-table';
    buildRankHead(table, 'ranking', [
      { label: '順位', w: 50 }, { label: '配信者', w: 170 }, { label: '最高リスナー数', w: 110 },
      { label: '最高値を観測した日時', w: 170 }, { label: 'そのときの配信内容', w: 420 }, { label: 'YP', w: 80 },
    ], ctx);
    const body = document.createElement('tbody');
    let rank = 0, previous = null;
    rows.forEach((row, i) => {
      if (row.listeners !== previous) rank = i + 1;
      previous = row.listeners;
      const tr = document.createElement('tr');
      const values = [rank, row.name, `${row.listeners}人`, new Date(row.at).toLocaleString('ja-JP'), row.detail, row.ypName];
      values.forEach((value, index) => { const td = document.createElement('td'); if (index === 4) td.append(linkify(value)); else td.textContent = value; tr.append(td); });
      body.append(tr);
    });
    table.append(body); box.append(table);
  }
  $('rank-period').addEventListener('change', render);
  $('rank-date').addEventListener('change', render);
  $('rank-month').addEventListener('change', render);
  $('rank-current').addEventListener('click', () => {
    $('rank-date').value = rankDay(new Date());
    $('rank-month').value = rankDay(new Date()).slice(0, 7);
    render();
  });
  return {
    async load() {
      try { data = normalizeRanking(await loadStore('ranking')); }
      catch (e) { ctx.toast('ランキングを読み込めませんでした：' + e); }
    },
    observe(channels) {
      if (recordPeaks(data, channels)) saveStoreSoon('ranking', () => data);
      if (ctx.isShown()) render();
    },
    render,
  };
}
