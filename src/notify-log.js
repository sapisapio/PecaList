// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// 通知ログ：お気に入りの配信について、通知を出したか・出さなかったか（その理由）を残す。
// 「出たのに気づかなかった」のか「そもそも出していない」のかを、あとから確かめるため。

const MAX = 300;
const pad = (n) => String(n).padStart(2, '0');

// 出さなかった理由
export const REASONS = {
  startup: '起動時にもう配信中',
  returned: '1時間以内の再開',
  styleNone: '「通知しない」のお気に入り',
  favOff: 'お気に入りの通知がオフ',
  ng: 'NG にも当たっている',
  p2p: 'P2Pだけの配信',
};

export function formatTime(at) {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 新しいものを先頭に足し、古いものは捨てる
export function addEntries(list, entries) {
  return [...entries.slice().reverse(), ...list].slice(0, MAX);
}

export function resultText(e) {
  if (e.shown) return e.sticky ? '通知した（確認するまで出す）' : '通知した（数秒で消える）';
  return '出さなかった：' + (REASONS[e.reason] || e.reason);
}

// ctx：loadStore, saveStoreSoon
export function initNotifyLog(ctx) {
  const $ = (id) => document.getElementById(id);
  let list = [];
  const save = () => ctx.saveStoreSoon('notifylog', () => ({ version: 1, items: list }), 2000);

  function render() {
    const box = $('nlog-body');
    if (list.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'まだ記録はありません。お気に入りが配信を始めると、ここに通知を出したかどうかが残ります。';
      box.replaceChildren(p);
      return;
    }
    const table = document.createElement('table');
    table.className = 'nlog-table';
    const head = document.createElement('tr');
    for (const t of ['時刻', 'チャンネル', 'お気に入り', '結果']) {
      const th = document.createElement('th');
      th.textContent = t;
      head.appendChild(th);
    }
    const thead = document.createElement('thead');
    thead.appendChild(head);
    const tbody = document.createElement('tbody');
    for (const e of list) {
      const tr = document.createElement('tr');
      tr.className = e.shown ? 'shown' : 'skipped';
      for (const v of [formatTime(e.at), e.yp ? `${e.name}（${e.yp}）` : e.name, e.filter || '', resultText(e)]) {
        const td = document.createElement('td');
        td.textContent = v;
        td.title = v;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    box.replaceChildren(table);
  }

  $('nlog-open').addEventListener('click', () => { render(); $('nlog').hidden = false; });
  $('nlog-close').addEventListener('click', () => { $('nlog').hidden = true; });
  $('nlog-clear').addEventListener('click', () => { list = []; save(); render(); });

  return {
    async load() {
      const s = await ctx.loadStore('notifylog');
      list = Array.isArray(s?.items) ? s.items.slice(0, MAX) : [];
    },
    // entries：{ at, name, yp, filter, shown, sticky, reason }
    add(entries) {
      if (!entries.length) return;
      list = addEntries(list, entries);
      save();
      if (!$('nlog').hidden) render();
    },
  };
}
