// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// お気に入りの色（設定で変えられる）。一覧・配信中のお気に入りの帯・詳細・通知の窓で使う。
// ライトとダークで見やすい色が違うので、それぞれに持つ。イベントYP の強調など、お気に入り以外の色は変えない。

export const FAV_DEFAULT = { light: '#c2410c', dark: '#ff9a5c' };

const isColor = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
export const favColor = (c, theme) => (isColor(c) ? c.toLowerCase() : FAV_DEFAULT[theme]);

// 設定から CSS を作る。rowBg が false なら、お気に入りの行に背景の色を付けない
export function favCss({ light, dark, rowBg = true } = {}) {
  const vars = (theme, c) => {
    const color = favColor(c, theme);
    // 初めの色のままなら、行の背景も初めの色（style.css の --fav-bg）
    const bg = !rowBg ? 'transparent' : color === FAV_DEFAULT[theme] ? 'var(--fav-bg)' : `color-mix(in srgb, ${color} 10%, var(--panel))`;
    return `--favc:${color};--favc-bg:${bg}`;
  };
  return `:root{${vars('light', light)}}`
    + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${vars('dark', dark)}}}`
    + `:root[data-theme="dark"]{${vars('dark', dark)}}`;
}

export function applyFavCss(doc, opts) {
  let el = doc.getElementById('fav-style');
  if (!el) {
    el = doc.createElement('style');
    el.id = 'fav-style';
    doc.head.appendChild(el);
  }
  el.textContent = favCss(opts);
}
