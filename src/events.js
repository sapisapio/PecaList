// PecaList — Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later
const DAY = 86400000;
export function japanDay(now = new Date()) {
  const date = new Date(now.getTime() + 9 * 3600000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
function validDay(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() : null;
}
export function eventDay(ch, now = new Date()) {
  if (!ch.event) return null;
  // 現在のイベントYPは告知URLの「イベント日程/YYYY-MM-DD」に開催日を持つ。
  let path = '';
  try { path = decodeURIComponent(new URL(ch.contactUrl).pathname); } catch {}
  let match = /(?:^|\/)イベント日程\/(\d{4})-(\d{1,2})-(\d{1,2})(?:\/|$)/.exec(path);
  if (match) return validDay(+match[1], +match[2], +match[3]);
  const detail = [ch.detail, ch.comment].filter(Boolean).join(' ');
  match = /(?:^|\D)(\d{4})[年\/-](\d{1,2})[月\/-](\d{1,2})(?:日|\D|$)/.exec(detail);
  if (match) return validDay(+match[1], +match[2], +match[3]);
  match = /(?:^|\D)(\d{1,2})(?:月|\/)(\d{1,2})(?:日|\D|$)/.exec(detail);
  if (!match) return null;
  const today = new Date(japanDay(now)), month = +match[1];
  let year = today.getUTCFullYear();
  if (today.getUTCMonth() === 11 && month === 1) year++;
  if (today.getUTCMonth() === 0 && month === 12) year--;
  return validDay(year, month, +match[2]);
}
export function eventSchedule(ch, now = new Date()) {
  const day = eventDay(ch, now);
  if (day === null) return { days: null, label: '日程未確認', today: false, soon: false };
  const days = (day - japanDay(now)) / DAY;
  return { days, label: days === 0 ? '本日開催' : days > 0 ? `あと${days}日` : '終了', today: days === 0, soon: days >= 0 && days <= 3 };
}
export function eventPriority(ch, now = new Date()) {
  return !ch.event ? 0 : eventSchedule(ch, now).today ? -1 : 1;
}
