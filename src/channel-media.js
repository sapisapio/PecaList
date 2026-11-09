// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later
import { linkify, linkService } from './links.js';

const URL_RE = /h?ttps?:\/\/[^\s<>"'「」『』（）]+|(?<![\w./:@])(?:(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\]):\d{1,5}(?:\/[^\s<>"'「」『』（）]*)?/gi;
const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;

export function shortSiteName(host) {
  const name = host.replace(/^www\d*\./i, '').split('.')[0];
  return name.length > 20 ? name.slice(0, 19) + '…' : name;
}

// 従来の曲情報は維持し、URLだけを表示用に取り出す。HTMLとして解釈しない。
export function channelMedia(ch) {
  const links = [], text = [], seen = new Set();
  let artwork = '';
  for (const value of [ch.trackTitle, ch.trackAlbum, ch.trackArtist, ch.trackUrl]) {
    const source = String(value || '').slice(0, 16384);
    const rest = source.replace(URL_RE, (match) => {
      const raw = (/^https?:/i.test(match) ? match : /^ttps?:/i.test(match) ? 'h' + match : 'http://' + match).replace(/[.,;!?)\]、。]+$/, '');
      let url;
      try { url = new URL(raw); } catch { return match; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return match;
      if (seen.has(url.href)) return '';
      seen.add(url.href);
      if (IMAGE_PATH.test(url.pathname)) {
        if (!artwork) artwork = url.href;
      } else {
        links.push({ url: url.href, label: linkService(url.href)?.label || shortSiteName(url.hostname) });
      }
      return '';
    }).trim();
    if (rest && !text.includes(rest)) text.push(rest);
  }
  return { artwork, links, text: text.join(' · ') };
}

export function mediaButtons(media) {
  const fragment = document.createDocumentFragment();
  for (const link of media.links) {
    const a = linkify(link.url).firstChild;
    a.classList.add('tag', 'media-link');
    a.href = link.url;
    a.title = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', `${link.label}を開く：${link.url}`);
    if (!a.classList.contains('service-link')) a.textContent = link.label;
    fragment.appendChild(a);
  }
  return fragment;
}

export function artworkImage(media, name) {
  if (!media.artwork) return null;
  const img = document.createElement('img');
  img.className = 'channel-artwork';
  img.alt = `${name}のアイコン`;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => img.remove(), { once: true });
  img.src = media.artwork;
  return img;
}
