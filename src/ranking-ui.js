// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later
import { linkify } from './links.js';
import { rankDay, emptyRanking, recordPeaks, rankRows, recentMonths, monthFileName, monthPart, mergeParts, monthsIn } from './ranking.js';
import { loadStore, saveStoreSoon, saveStoreNow, deleteStore } from './store.js';
import { buildRankHead } from './rank-cols.js';

export function initRankingUI(ctx) {
  const $ = (id) => document.getElementById(id);
  let data = emptyRanking();
  $('rank-date').value = rankDay(new Date());
  $('rank-month').value = rankDay(new Date()).slice(0, 7);
  function render() {
    $('rank-enabled').checked = Boolean(ctx.settings.rankingEnabled);
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
      message.textContent = ctx.settings.rankingEnabled ? 'この期間の記録はありません。' : 'この期間の記録はありません（集計はオフです）。';
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
  $('rank-enabled').addEventListener('change', () => {
    ctx.settings.rankingEnabled = $('rank-enabled').checked;
    ctx.saveSettings();
    render();
  });
  $('rank-period').addEventListener('change', render);
  $('rank-date').addEventListener('change', render);
  $('rank-month').addEventListener('change', render);
  $('rank-current').addEventListener('click', () => {
    $('rank-date').value = rankDay(new Date());
    $('rank-month').value = rankDay(new Date()).slice(0, 7);
    render();
  });
  return {
    // 月ごとのファイル（ranking-YYYY-MM）を、残す期間の分だけ読む。
    // 0.2.20 までの1つのファイル（ranking）があれば、月ごとに分けて書き直してから消す
    async load() {
      try {
        const now = new Date();
        const old = await loadStore('ranking');
        const parts = await Promise.all(recentMonths(now).map((m) => loadStore(monthFileName(m))));
        data = mergeParts([old, ...parts]);
        recordPeaks(data, [], now); // 残す期間より古いものを落とす
        if (old) {
          for (const m of monthsIn(data)) await saveStoreNow(monthFileName(m), monthPart(data, m));
          await deleteStore('ranking');
        }
        // 残す期間を過ぎた月のファイルを消す（毎回、その先の1年分だけ確かめる）
        for (const m of recentMonths(now, 12, recentMonths(now).length)) await deleteStore(monthFileName(m));
      } catch (e) { ctx.toast('ランキングを読み込めませんでした：' + e); }
    },
    observe(channels) {
      if (!ctx.settings.rankingEnabled) return; // 集計オフの間は記録しない
      // 書き直すのは今の月のファイルだけ
      const month = rankDay(new Date()).slice(0, 7);
      if (recordPeaks(data, channels)) saveStoreSoon(monthFileName(month), () => monthPart(data, month));
      if (ctx.isShown()) render();
    },
    render,
  };
}
