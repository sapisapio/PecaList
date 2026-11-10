// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// フィルタタブとフィルタ編集画面
import { FIELD_LABELS, newFilter, parseFilterXml, compileFilter, autoRecords } from './filters.js';
import { buildRankHead } from './rank-cols.js';

const $ = (id) => document.getElementById(id);
const clone = (o) => structuredClone(o);

// ---- はい/いいえ などを聞く小さな画面 ----
export function ask(title, text, buttons) {
  return new Promise((resolve) => {
    $('ask-title').textContent = title;
    $('ask-text').textContent = text;
    const box = $('ask-btns');
    box.replaceChildren();
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' primary' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => { $('ask').hidden = true; resolve(b.value); });
      box.appendChild(btn);
    }
    $('ask').hidden = false;
  });
}

function kindText(f) {
  const k = [];
  if (f.favorite) k.push('お気に入り');
  if (f.ignore) k.push('NG');
  if (autoRecords(f)) k.push('録画');
  return k.join('・') || '−';
}

export function initFilterUI(ctx) {
  let selected = -1;

  // フィルタタブの表の見出し。ほかの表と同じく、列ごとに幅を変えられる（ほかの列は動かない）。
  // 保存した幅を使うので、設定を読み込んだあと、初めて表を出すときに作る
  let headBuilt = false;
  function buildHead() {
    if (headBuilt) return;
    headBuilt = true;
    buildRankHead(document.querySelector('.fv-table'), 'filter', [
      { label: '有効', w: 44 }, { label: 'フィルタ名', w: 200 }, { label: '種類', w: 110 }, { label: '基本検索', w: 320 },
      { label: 'AND検索', w: 150 }, { label: 'NOT検索', w: 150 }, { label: '一致', w: 60, cls: 'num' },
    ], ctx);
  }

  // ---- フィルタタブ ----
  function renderFilterView() {
    buildHead();
    const filters = ctx.getFilters();
    if (selected >= filters.length) selected = filters.length - 1;
    const body = $('fv-body');
    const frag = document.createDocumentFragment();
    filters.forEach((f, i) => {
      const tr = document.createElement('tr');
      tr.dataset.i = i;
      if (!f.enabled) tr.classList.add('disabled');
      if (compileFilter(f).invalid) tr.classList.add('bad');
      if (i === selected) tr.classList.add('sel');
      const en = document.createElement('td');
      en.className = 'center';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = f.enabled;
      cb.addEventListener('change', () => {
        const list = ctx.getFilters().slice();
        list[i] = { ...list[i], enabled: cb.checked };
        ctx.setFilters(list);
      });
      en.appendChild(cb);
      const td = (t, cls) => { const c = document.createElement('td'); c.textContent = t; if (cls) c.className = cls; c.title = t; return c; };
      tr.append(
        en,
        td(f.name),
        td(kindText(f), 'kind'),
        td(f.base.search, 'c-search'),
        td(f.and.enabled ? f.and.search : '<無効>'),
        td(f.not.enabled ? f.not.search : '<無効>'),
        td(String(ctx.matchCount(f)), 'num'),
      );
      frag.appendChild(tr);
    });
    body.replaceChildren(frag);
    $('fv-empty').hidden = filters.length > 0;
  }

  $('fv-body').addEventListener('mousedown', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    selected = Number(tr.dataset.i);
    for (const r of $('fv-body').children) r.classList.toggle('sel', r === tr);
  });
  $('fv-body').addEventListener('dblclick', (e) => {
    if (e.target.closest('input')) return;
    const tr = e.target.closest('tr');
    if (tr) editAt(Number(tr.dataset.i));
  });

  function editAt(i) {
    const f = ctx.getFilters()[i];
    if (!f) return;
    openEditor(f, (nf) => {
      const list = ctx.getFilters().slice();
      list[i] = nf;
      ctx.setFilters(list);
    });
  }

  function move(d) {
    const list = ctx.getFilters().slice();
    const j = selected + d;
    if (selected < 0 || j < 0 || j >= list.length) return;
    [list[selected], list[j]] = [list[j], list[selected]];
    selected = j;
    ctx.setFilters(list);
  }

  $('fv-add').addEventListener('click', () => openEditor(newFilter({ favorite: true }), (nf) => {
    const list = ctx.getFilters().slice();
    list.unshift(nf);
    selected = 0;
    ctx.setFilters(list);
  }));
  $('fv-edit').addEventListener('click', () => editAt(selected));
  $('fv-dup').addEventListener('click', () => {
    const list = ctx.getFilters().slice();
    if (!list[selected]) return;
    list.splice(selected + 1, 0, { ...clone(list[selected]), name: list[selected].name + ' のコピー' });
    selected += 1;
    ctx.setFilters(list);
  });
  $('fv-del').addEventListener('click', async () => {
    const list = ctx.getFilters().slice();
    const f = list[selected];
    if (!f) return;
    const ok = await ask('フィルタの削除', `「${f.name}」を削除しますか？`, [
      { label: 'キャンセル', value: false }, { label: '削除', value: true, primary: true },
    ]);
    if (!ok) return;
    list.splice(selected, 1);
    ctx.setFilters(list);
  });
  $('fv-up').addEventListener('click', () => move(-1));
  $('fv-down').addEventListener('click', () => move(1));

  // ---- ペカレコの Filter.xml の読み込み ----
  $('fv-import').addEventListener('click', () => { $('fv-file').value = ''; $('fv-file').click(); });
  $('fv-file').addEventListener('change', async () => {
    const file = $('fv-file').files[0];
    if (!file) return;
    let imported;
    try {
      imported = parseFilterXml(await file.text());
    } catch (e) {
      ctx.toast('読み込めませんでした：' + e.message);
      return;
    }
    const current = ctx.getFilters();
    let mode = 'replace';
    if (current.length > 0) {
      mode = await ask('Filter.xml の読み込み', `${imported.length} 個のフィルタが見つかりました。今あるフィルタ（${current.length} 個）はどうしますか？`, [
        { label: 'キャンセル', value: null },
        { label: '後ろに追加', value: 'append' },
        { label: '置き換える', value: 'replace', primary: true },
      ]);
      if (!mode) return;
    }
    // 自動録画のフィルタは、PecaList でも録画するか聞く（ペカレコと両方で録ってしまわないように）
    const auto = imported.filter(autoRecords).length;
    if (auto > 0) {
      const on = await ask('自動録画', `${auto} 個のフィルタが「自動録画」です。PecaList でも自動録画にすると、当たる配信が始まったときに PecaList が録画を始めます（ペカレコも動かしていると、同じ配信を両方で録ります）。`, [
        { label: '止めておく', value: false },
        { label: 'PecaList でも自動録画する', value: true, primary: true },
      ]);
      if (!on) imported = imported.map((f) => ({ ...f, download: false }));
    }
    ctx.setFilters(mode === 'append' ? [...current, ...imported] : imported);
    const bad = imported.filter((f) => compileFilter(f).invalid).length;
    ctx.toast(`${imported.length} 個のフィルタを読み込みました` + (bad ? `（正規表現が正しくないもの ${bad} 個は赤字）` : ''));
  });

  // ---- 編集画面 ----
  let draft = null;
  let onSave = null;

  function condBox(id, title, cond, toggle) {
    const box = $(id);
    box.replaceChildren();
    const top = document.createElement('div');
    top.className = 'top';
    const ttl = document.createElement('span');
    ttl.className = 'ttl';
    if (toggle) {
      const l = document.createElement('label');
      l.className = 'chk';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = cond.enabled;
      cb.addEventListener('change', () => { cond.enabled = cb.checked; box.classList.toggle('off', !cb.checked); });
      l.append(cb, document.createTextNode(title));
      ttl.appendChild(l);
      box.classList.toggle('off', !cond.enabled);
    } else {
      ttl.textContent = title;
    }
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.spellcheck = false;
    inp.value = cond.search;
    inp.addEventListener('input', () => { cond.search = inp.value; });
    top.append(ttl, inp);
    const flds = document.createElement('div');
    flds.className = 'flds';
    for (const [k, label] of Object.entries(FIELD_LABELS)) {
      const l = document.createElement('label');
      l.className = 'chk';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!cond.fields[k];
      cb.addEventListener('change', () => { cond.fields[k] = cb.checked; });
      l.append(cb, document.createTextNode(label));
      flds.appendChild(l);
    }
    box.append(top, flds);
  }

  const RANGES = [['bitrate', 'ビットレート'], ['listener', 'リスナー数'], ['relay', 'リレー数'], ['time', '配信時間（分）']];
  function rangeFields() {
    const box = $('fe-ranges');
    box.replaceChildren();
    for (const [k, label] of RANGES) {
      const row = document.createElement('div');
      row.className = 'field';
      const l = document.createElement('label');
      l.textContent = label;
      const mk = (which) => {
        const i = document.createElement('input');
        i.type = 'number';
        i.value = draft[k][which] ?? '';
        i.placeholder = which === 'min' ? '下限' : '上限';
        i.addEventListener('input', () => {
          const n = parseInt(i.value, 10);
          draft[k][which] = Number.isFinite(n) ? n : null;
        });
        return i;
      };
      row.append(l, mk('min'), document.createTextNode('〜'), mk('max'));
      box.appendChild(row);
    }
  }

  function openEditor(filter, save) {
    draft = clone(filter);
    onSave = save;
    $('fe-name').value = draft.name;
    $('fe-favorite').checked = draft.favorite;
    $('fe-ignore').checked = draft.ignore;
    $('fe-record').checked = autoRecords(draft);
    $('fe-enabled').checked = draft.enabled;
    condBox('fe-base', '基本検索', draft.base, false);
    condBox('fe-and', 'AND検索', draft.and, true);
    condBox('fe-not', 'NOT検索', draft.not, true);
    $('fe-icase').checked = draft.icase;
    $('fe-width').checked = draft.width;
    rangeFields();
    $('fe-new').value = draft.newCond.new ? 'new' : draft.newCond.notNew ? 'notNew' : '';
    $('fe-notify').value = draft.notify?.notify === false && (draft.notifyStyle || 'default') === 'default' ? 'none' : (draft.notifyStyle || 'default');
    $('fe-text-on').checked = !!draft.color.text;
    $('fe-text').value = draft.color.text || '#c2410c';
    $('fe-bg-on').checked = !!draft.color.bg;
    $('fe-bg').value = draft.color.bg || '#fff4ec';
    $('fe-note').textContent = Object.values(draft.play).some(Boolean)
      ? 'ペカレコから引き継いだ設定（再生中の条件）は保存されていますが、今の版ではまだ使われません。'
      : '';
    $('fe-err').textContent = '';
    $('fe').hidden = false;
    $('fe-name').focus();
  }

  $('fe-cancel').addEventListener('click', () => { $('fe').hidden = true; });
  $('fe-save').addEventListener('click', () => {
    draft.name = $('fe-name').value.trim();
    draft.favorite = $('fe-favorite').checked;
    draft.ignore = $('fe-ignore').checked;
    draft.download = $('fe-record').checked;
    if (draft.download) draft.downloadOpts = { ...draft.downloadOpts, execute: true };
    draft.enabled = $('fe-enabled').checked;
    draft.icase = $('fe-icase').checked;
    draft.width = $('fe-width').checked;
    draft.notifyStyle = $('fe-notify').value;
    draft.notify = { ...draft.notify, notify: draft.notifyStyle !== 'none' };
    const nv = $('fe-new').value;
    draft.newCond = { new: nv === 'new', notNew: nv === 'notNew' };
    draft.color = {
      text: $('fe-text-on').checked ? $('fe-text').value : null,
      bg: $('fe-bg-on').checked ? $('fe-bg').value : null,
    };
    if (!draft.name) { $('fe-err').textContent = 'フィルタ名を入れてください'; return; }
    if (!draft.base.search) { $('fe-err').textContent = '基本検索を入れてください（空だと何にも一致しません）'; return; }
    if (compileFilter(draft).invalid) { $('fe-err').textContent = '検索の正規表現が正しくありません'; return; }
    $('fe').hidden = true;
    onSave(draft);
  });

  return { renderFilterView, openEditor };
}
