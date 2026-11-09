// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// ランキング・勢いの表の見出し。ペカレコと同じく、どの列も見出しの右端をドラッグして幅を変えられ、
// 1つの列を変えても、ほかの列の幅は変わらない（表全体の幅は列の合計。はみ出したら横に動かす）。
// 幅は設定に残す。見出しの右端をダブルクリックすると、その列を初めの幅に戻す。
const MIN_WIDTH = 30;

// table：見出しを付ける表、kind：'ranking' か 'activity'、columns：[{ label, w }]
export function buildRankHead(table, kind, columns, ctx) {
  const saved = () => ((ctx.settings.rankColWidths ||= {})[kind] ||= {});
  const widthOf = (c) => saved()[c.label] || c.w;
  const group = document.createElement('colgroup');
  const cols = columns.map((c) => {
    const col = document.createElement('col');
    col.style.width = widthOf(c) + 'px';
    group.append(col);
    return col;
  });
  const fit = () => { table.style.width = columns.reduce((sum, c) => sum + widthOf(c), 0) + 'px'; };
  const setWidth = (i, w) => {
    if (w === null) delete saved()[columns[i].label]; else saved()[columns[i].label] = w;
    cols[i].style.width = widthOf(columns[i]) + 'px';
    fit();
  };
  const head = document.createElement('thead');
  const tr = document.createElement('tr');
  columns.forEach((c, i) => {
    const th = document.createElement('th');
    th.textContent = c.label;
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = widthOf(c);
      const move = (ev) => setWidth(i, Math.max(MIN_WIDTH, Math.round(startW + ev.clientX - startX)));
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        ctx.saveSettings();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    grip.addEventListener('dblclick', () => { setWidth(i, null); ctx.saveSettings(); });
    th.append(grip);
    tr.append(th);
  });
  head.append(tr);
  fit();
  table.append(group, head);
}
