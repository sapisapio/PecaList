// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

// 設定やフィルタの保存。
// アプリでは Rust 側が exe と同じフォルダーの <name>.json に保存する（data_dir.rs）。
// ブラウザで画面だけ確認するときは localStorage を使う。

const tauri = window.__TAURI__;
const LOCAL_PREFIX = 'nexus.store.';

export async function loadStore(name) {
  let text = null;
  if (tauri) {
    text = await tauri.core.invoke('load_store', { name });
  } else {
    try { text = localStorage.getItem(LOCAL_PREFIX + name); } catch { text = null; }
  }
  if (text == null) return null;
  return JSON.parse(text);
}

const timers = new Map();
let onError = (e) => console.error(e);
export function setStoreErrorHandler(fn) { onError = fn; }

// 続けて何度も変更されても、少し待ってから1回だけ書き込む
export function saveStoreSoon(name, getData, delayMs = 400) {
  clearTimeout(timers.get(name));
  timers.set(name, setTimeout(() => {
    timers.delete(name);
    saveStoreNow(name, getData()).catch(onError);
  }, delayMs));
}

export async function saveStoreNow(name, data) {
  const text = JSON.stringify(data);
  if (tauri) await tauri.core.invoke('save_store', { name, data: text });
  else localStorage.setItem(LOCAL_PREFIX + name, text);
}
