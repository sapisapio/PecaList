// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later
const URL_RE = /h?ttps?:\/\/[^\s<>"'「」『』（）]+/g;

export function linkService(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (url.port === '7244') return { id: 'ip', label: 'おつまみ' };
  const services = [
    ['twitch', 'Twitch', ['twitch.tv']],
    ['youtube', 'YouTube', ['youtube.com', 'youtu.be']],
    ['x', 'X', ['x.com', 'twitter.com']],
    ['discord', 'Discord', ['discord.gg', 'discord.com', 'discordapp.com']],
    ['kick', 'Kick', ['kick.com']],
    ['tiktok', 'TikTok', ['tiktok.com']],
    ['instagram', 'Instagram', ['instagram.com', 'instagr.am']],
    ['bluesky', 'Bluesky', ['bsky.app', 'bsky.social']],
    ['steam', 'Steam', ['steampowered.com', 'steamcommunity.com', 's.team']],
    ['niconico', 'ニコニコ', ['nicovideo.jp', 'nico.ms']],
  ];
  for (const [id, label, domains] of services) {
    if (domains.some(domain => host === domain || host.endsWith('.' + domain))) return { id, label };
  }
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.startsWith('[')) {
    return { id: 'ip', label: `${url.port || (url.protocol === 'https:' ? '443' : '80')}ポート` };
  }
  return null;
}

function serviceIcon(service) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (service === 'youtube') {
    const bg = document.createElementNS(ns, 'rect');
    for (const [key,value] of Object.entries({ x:1, y:4, width:22, height:16, rx:5, fill:'#ff0033' })) bg.setAttribute(key, value);
    const play = document.createElementNS(ns, 'path');
    play.setAttribute('d', 'M10 8L17 12L10 16Z'); play.setAttribute('fill', '#fff');
    svg.append(bg, play);
  } else if (service !== 'twitch') {
    const shape = document.createElementNS(ns, 'path');
    const paths = {
      x: 'M18.9 2H22L15.2 9.8L23.2 22H16.9L12 14.6L5.5 22H2.3L10.5 12.6L2.8 2H9.3L13.8 8.7ZM17.8 20H19.5L8.3 4H6.5Z',
      discord: 'M19.7 5.2A18 18 0 0015.4 4L14.9 5A16 16 0 009.1 5L8.6 4A18 18 0 004.3 5.2C1.6 9.2 1 13.1 1.4 16.9A18 18 0 006.7 19.5L7.8 17.8L6.1 17L6.5 16.7C10 18.3 14 18.3 17.5 16.7L17.9 17L16.2 17.8L17.3 19.5A18 18 0 0022.6 16.9C23.1 12.4 21.8 8.5 19.7 5.2ZM8.5 14.9C6.5 14.9 6.5 11.1 8.5 11.1C10.5 11.1 10.5 14.9 8.5 14.9ZM15.5 14.9C13.5 14.9 13.5 11.1 15.5 11.1C17.5 11.1 17.5 14.9 15.5 14.9Z',
      ip: 'M2 3H22V16H13V19H18V21H6V19H11V16H2ZM4 5V14H20V5ZM7 7H9V12H7ZM12 7H17V10H14V12H12ZM14 8V9H16V8Z',
      kick: 'M3 3H9V9H12V6H15V3H21V9H18V12H15V15H18V18H21V21H15V18H12V15H9V21H3Z',
      tiktok: 'M14 2H18C18 5 20 7 23 7V11C21 11 19 10 18 9V17A7 7 0 1111 10V14A3 3 0 1014 17Z',
      instagram: 'M7 2H17A5 5 0 0122 7V17A5 5 0 0117 22H7A5 5 0 012 17V7A5 5 0 017 2ZM7 4A3 3 0 004 7V17A3 3 0 007 20H17A3 3 0 0020 17V7A3 3 0 0017 4ZM12 7A5 5 0 1112 17A5 5 0 0112 7ZM12 9A3 3 0 1012 15A3 3 0 0012 9ZM18 5A1.5 1.5 0 1118 8A1.5 1.5 0 0118 5Z',
      bluesky: 'M5 3C8 5 10 8 12 11C14 8 16 5 19 3C22 1 24 3 23 7C23 12 21 14 17 14C23 15 21 21 17 21C15 21 13 19 12 17C11 19 9 21 7 21C3 21 1 15 7 14C3 14 1 12 1 7C0 3 2 1 5 3Z',
      steam: 'M16 2A6 6 0 1016 14A6 6 0 0016 2ZM16 4A4 4 0 1116 12A4 4 0 0116 4ZM16 5A3 3 0 1016 11A3 3 0 0016 5ZM11 10L6 14L0 12V16L5 18A4 4 0 107 14L13 12ZM7 15A2.5 2.5 0 117 20A2.5 2.5 0 017 15Z',
      niconico: 'M6 1L12 5L18 1L19 3L15 6H21A2 2 0 0123 8V19A2 2 0 0121 21H18V23H15V21H9V23H6V21H3A2 2 0 011 19V8A2 2 0 013 6H9L5 3ZM4 9V18H20V9Z',

    };
    shape.setAttribute('d', paths[service]);
    shape.setAttribute('fill', 'currentColor');
    shape.setAttribute('fill-rule', 'evenodd');
    svg.append(shape);
  } else {
    const shape = document.createElementNS(ns, 'path');
    shape.setAttribute('d', 'M4 2H23V15L16 22H11L7 26V22H1V7Z M6 4V18H11V21L14 18H18L21 15V4Z M11 7H13V13H11Z M17 7H19V13H17Z');
    shape.setAttribute('transform', 'translate(1 0) scale(.85)');
    shape.setAttribute('fill', 'currentColor'); shape.setAttribute('fill-rule', 'evenodd');
    svg.append(shape);
  }
  return svg;
}

// 文字列をHTMLとして解釈せず、リンクだけをDOMで作る。
export function linkify(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of (text || '').matchAll(URL_RE)) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement('a');
    a.className = 'lnk';
    const url = m[0].startsWith('h') ? m[0] : 'h' + m[0];
    a.dataset.url = url;
    const service = linkService(url);
    if (service) {
      a.classList.add('service-link', service.id);
      a.title = url;
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', `${service.label}で開く：${url}`);
      a.append(serviceIcon(service.id), document.createTextNode(service.label));
    } else a.textContent = m[0];
    frag.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < (text || '').length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}
