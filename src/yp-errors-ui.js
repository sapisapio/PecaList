// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

export function initYpErrorsUI(ctx) {
  const $ = (id) => document.getElementById(id);
  const trigger = $('yp-error-trigger'), pop = $('yp-error-pop');
  let timer, pinned = false, signature = '';
  const failures = () => ctx.getYps().filter((y) => ctx.getStatus(y.name)?.ok === false);
  function close() {
    clearTimeout(timer);
    pinned = false;
    pop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
  function open() {
    clearTimeout(timer);
    if (trigger.hidden) return;
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }
  function leave() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!pinned && !pop.contains(document.activeElement) && document.activeElement !== trigger) close();
    }, 250);
  }
  trigger.addEventListener('mouseenter', open);
  trigger.addEventListener('focus', open);
  trigger.addEventListener('mouseleave', leave);
  trigger.addEventListener('click', () => { pinned = !pinned; if (pinned) open(); else close(); });
  pop.addEventListener('mouseenter', () => clearTimeout(timer));
  pop.addEventListener('mouseleave', leave);
  for (const element of [trigger, pop]) element.addEventListener('focusout', leave);
  $('yp-error-close').addEventListener('click', close);
  $('yp-error-stop-all').addEventListener('click', () => ctx.stop(failures().map((y) => y.name)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('pointerdown', (e) => { if (!pop.contains(e.target) && e.target !== trigger) close(); });
  return {
    render() {
      const list = failures();
      trigger.hidden = list.length === 0;
      trigger.textContent = `取得失敗 ${list.length}件`;
      if (!list.length) { close(); signature = ''; $('yp-error-list').replaceChildren(); return; }
      const next = JSON.stringify(list.map((y) => [y.name, y.url, ctx.getStatus(y.name)?.error]));
      if (next === signature) return;
      signature = next;
      $('yp-error-list').replaceChildren(...list.map((y) => {
        const row = document.createElement('div');
        row.className = 'yp-error-row';
        const text = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = y.name;
        const url = document.createElement('div');
        url.textContent = y.url;
        const error = document.createElement('div');
        error.className = 'hint';
        error.textContent = ctx.getStatus(y.name)?.error || '取得できませんでした';
        text.append(name, url, error);
        const stop = document.createElement('button');
        stop.className = 'btn sm';
        stop.textContent = '取得を停止';
        stop.setAttribute('aria-label', `${y.name}の取得を停止`);
        stop.addEventListener('click', () => ctx.stop([y.name]));
        row.append(text, stop);
        return row;
      }));
    },
  };
}
