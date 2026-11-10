// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// 新しい版のお知らせ。起動して少ししてからと、6時間ごとに、GitHub の配布ページ（Releases）の一覧を見る。
// 今の版より新しい版があれば、下の帯に「新しい版 x.y.z」を出し、押すと配布ページを開く。
// 入れ替えは自分でしてもらう（自動で入れ替えはしない）。設定でオフにできる。

export const RELEASES_API = 'https://api.github.com/repos/sapisapio/PecaList/releases?per_page=20';
const FIRST_DELAY = 15_000;
const EVERY = 6 * 60 * 60 * 1000;

// 「v0.2.21」「0.2.21」→ [0, 2, 21]。読めなければ null
export function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text || '').trim());
  return m ? m.slice(1).map(Number) : null;
}

export function newerThan(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// 配布ページの一覧から、今の版より新しいうち一番新しいものを選ぶ（試験版も含む。下書きは除く）
export function pickUpdate(releases, current) {
  const now = parseVersion(current);
  if (!now || !Array.isArray(releases)) return null;
  let best = null;
  for (const r of releases) {
    const v = parseVersion(r?.tag_name);
    if (!v || r.draft || !newerThan(v, now)) continue;
    if (typeof r.html_url !== 'string' || !r.html_url.startsWith('https://github.com/sapisapio/PecaList/')) continue;
    if (!best || newerThan(v, best.v)) best = { v, version: v.join('.'), url: r.html_url };
  }
  return best && { version: best.version, url: best.url };
}

// ctx：settings, current()（今の版。Promise でもよい）, fetchText(url), openUrl(url)
export function initUpdateCheck(ctx) {
  const btn = document.getElementById('update-notice');
  let found = null;
  btn.addEventListener('click', () => { if (found) ctx.openUrl(found.url); });
  async function check() {
    if (ctx.settings.updateCheck === false) { btn.hidden = true; return; }
    try {
      found = pickUpdate(JSON.parse(await ctx.fetchText(RELEASES_API)), await ctx.current());
    } catch {
      return; // 取れなかったときは何も出さない（次の確認で取り直す）
    }
    btn.hidden = !found;
    if (found) {
      btn.textContent = `新しい版 ${found.version}`;
      btn.title = `PecaList ${found.version} が出ています。押すと配布ページを開きます`;
    }
  }
  setTimeout(check, FIRST_DELAY);
  setInterval(check, EVERY);
  return { check };
}
