// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

mod p2p;
mod flv;
mod recorder;
mod data_dir;

use std::time::Duration;

/// 画面側から呼び出して、Rust 側が動いていることを確かめるための命令。
#[tauri::command]
fn app_info() -> String {
  format!(
    "PecaList {} ({} / {})",
    env!("CARGO_PKG_VERSION"),
    std::env::consts::OS,
    std::env::consts::ARCH
  )
}

/// 文字コードを判定して文字列にする。
/// BOM があればそれに従い、正しい UTF-8 ならそのまま、そうでなければ Shift_JIS とみなす。
fn decode_text(bytes: &[u8]) -> String {
  if let Some((enc, bom_len)) = encoding_rs::Encoding::for_bom(bytes) {
    let (text, _) = enc.decode_without_bom_handling(&bytes[bom_len..]);
    return text.into_owned();
  }
  match std::str::from_utf8(bytes) {
    Ok(s) => s.to_owned(),
    Err(_) => {
      let (text, _, _) = encoding_rs::SHIFT_JIS.decode(bytes);
      text.into_owned()
    }
  }
}

/// YP の index.txt などを取得する。http と https のみ受け付ける。
#[tauri::command]
async fn fetch_text(url: String, timeout_ms: u64) -> Result<String, String> {
  let parsed = reqwest::Url::parse(&url).map_err(|e| format!("URLが正しくありません: {e}"))?;
  if parsed.scheme() != "http" && parsed.scheme() != "https" {
    return Err("http または https のURLのみ取得できます".into());
  }
  let client = reqwest::Client::builder()
    .user_agent(concat!("PecaList/", env!("CARGO_PKG_VERSION")))
    .gzip(true)
    .timeout(Duration::from_millis(timeout_ms.clamp(1000, 60000)))
    .build()
    .map_err(|e| e.to_string())?;
  let res = client.get(parsed).send().await.map_err(|e| e.to_string())?;
  let status = res.status();
  if !status.is_success() {
    return Err(format!("サーバーの応答: {status}"));
  }
  let bytes = res.bytes().await.map_err(|e| e.to_string())?;
  Ok(decode_text(&bytes))
}


/// 掲示板のスレッド一覧だけを取得する。したらばはEUC-JP、jpnknはUTF-8。
#[tauri::command]
async fn fetch_bbs_subject(url: String) -> Result<String, String> {
  let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
  let host = parsed.host_str().unwrap_or("");
  let parts: Vec<_> = parsed.path().split('/').filter(|p| !p.is_empty()).collect();
  let valid = parsed.scheme() == "https" && parsed.username().is_empty() && parsed.password().is_none()
    && parsed.port().is_none() && parsed.query().is_none() && parsed.fragment().is_none()
    && match host {
      "bbs.jpnkn.com" => parts.len() == 2 && parts[1] == "subject.txt"
        && parts[0].chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
      "jbbs.shitaraba.net" => parts.len() == 3 && parts[2] == "subject.txt"
        && parts[0].chars().all(|c| c.is_ascii_alphabetic()) && parts[1].chars().all(|c| c.is_ascii_digit()),
      _ => false,
    };
  if !valid { return Err("対応する掲示板のスレッド一覧URLではありません".into()); }
  let shitaraba = host == "jbbs.shitaraba.net";
  let client = reqwest::Client::builder()
    .user_agent(concat!("PecaList/", env!("CARGO_PKG_VERSION")))
    .gzip(true).timeout(Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none())
    .build().map_err(|e| e.to_string())?;
  let res = client.get(parsed).send().await.map_err(|e| e.to_string())?;
  // 「取りすぎ」の返事：画面側が待つ時間を決められるよう、相手が言う秒数（Retry-After）を添える
  if res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
    let secs = res.headers().get(reqwest::header::RETRY_AFTER).and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok());
    return Err(match secs { Some(s) => format!("混雑(429) retry={s}"), None => "混雑(429)".into() });
  }
  if !res.status().is_success() { return Err(format!("サーバーの応答: {}", res.status())); }
  let bytes = res.bytes().await.map_err(|e| e.to_string())?;
  if bytes.len() > 2 * 1024 * 1024 { return Err("スレッド一覧が大きすぎます".into()); }
  let encoding = if shitaraba { encoding_rs::EUC_JP } else { encoding_rs::UTF_8 };
  let (text, _, _) = encoding.decode(&bytes);
  Ok(text.into_owned())
}

/// 保存するファイル（exe と同じフォルダー。data_dir.rs）。検証時は PECALIST_DATA_DIR で分離する。
fn store_path(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
  use tauri::Manager;
  if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
    return Err("保存名が正しくありません".into());
  }
  let data = app.state::<data_dir::DataDir>();
  let dir = &data.0;
  std::fs::create_dir_all(&dir).map_err(|e| format!("保存フォルダを作れませんでした: {e}"))?;
  Ok(dir.join(format!("{name}.json")))
}

/// 設定やフィルタを読み込む。まだ保存されていなければ None。
#[tauri::command]
fn load_store(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
  let path = store_path(&app, &name)?;
  match std::fs::read_to_string(&path) {
    Ok(s) => Ok(Some(s)),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(e) => Err(format!("読み込めませんでした: {e}")),
  }
}

/// 保存したものを消す（控えの .bak も）。なければ何もしない（ランキングの古い月を消すのに使う）
#[tauri::command]
fn delete_store(app: tauri::AppHandle, name: String) -> Result<(), String> {
  let path = store_path(&app, &name)?;
  for p in [path.with_extension("json.bak"), path] {
    match std::fs::remove_file(&p) {
      Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("消せませんでした: {e}")),
      _ => {}
    }
  }
  Ok(())
}

/// 設定やフィルタを保存する。
/// 書きかけで壊れないよう一時ファイルに書いてから置き換え、1つ前の内容を .bak に残す。
#[tauri::command]
fn save_store(app: tauri::AppHandle, name: String, data: String) -> Result<(), String> {
  let path = store_path(&app, &name)?;
  let tmp = path.with_extension("json.tmp");
  std::fs::write(&tmp, data.as_bytes()).map_err(|e| format!("保存できませんでした: {e}"))?;
  if path.exists() {
    let _ = std::fs::copy(&path, path.with_extension("json.bak"));
  }
  std::fs::rename(&tmp, &path).map_err(|e| format!("保存できませんでした: {e}"))
}

/// Windows の通知を出す。
#[tauri::command]
fn show_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
  use tauri_plugin_notification::NotificationExt;
  app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PecarecFiles {
  /// PeCaRecorder.xml の中身（なければ None）
  pecarec: Option<String>,
  /// Filter.xml の中身（なければ None）
  filter: Option<String>,
}

/// ペカレコのフォルダから、設定ファイルとフィルタを読む（引っ越し用）
#[tauri::command]
fn pecarec_read(dir: String) -> Result<PecarecFiles, String> {
  let dir = std::path::Path::new(&dir);
  if !dir.is_dir() {
    return Err("フォルダが見つかりません".into());
  }
  let read = |name: &str| std::fs::read(dir.join(name)).ok().map(|b| decode_text(&b));
  let files = PecarecFiles { pecarec: read("PeCaRecorder.xml"), filter: read("Filter.xml") };
  if files.pecarec.is_none() && files.filter.is_none() {
    return Err("選んだ exe と同じフォルダに PeCaRecorder.xml も Filter.xml もありません（ペカレコの PeCaRecorder.exe を選んでください）".into());
  }
  Ok(files)
}

/// IP アドレスからホスト名を調べる（ブロックリストのホスト名の判定に使う）。分からなければ空
fn reverse_lookup(ip: std::net::IpAddr) -> String {
  use windows_sys::Win32::Networking::WinSock::*;
  let mut host = [0u16; 1025];
  unsafe {
    let mut data: WSADATA = std::mem::zeroed();
    if WSAStartup(0x0202, &mut data) != 0 {
      return String::new();
    }
    let r = match ip {
      std::net::IpAddr::V4(v4) => {
        let mut sa: SOCKADDR_IN = std::mem::zeroed();
        sa.sin_family = AF_INET;
        sa.sin_addr.S_un.S_addr = u32::from_ne_bytes(v4.octets());
        GetNameInfoW(&sa as *const _ as *const SOCKADDR, std::mem::size_of::<SOCKADDR_IN>() as i32, host.as_mut_ptr(), host.len() as u32, std::ptr::null_mut(), 0, NI_NAMEREQD as i32)
      }
      std::net::IpAddr::V6(v6) => {
        let mut sa: SOCKADDR_IN6 = std::mem::zeroed();
        sa.sin6_family = AF_INET6;
        sa.sin6_addr.u.Byte = v6.octets();
        GetNameInfoW(&sa as *const _ as *const SOCKADDR, std::mem::size_of::<SOCKADDR_IN6>() as i32, host.as_mut_ptr(), host.len() as u32, std::ptr::null_mut(), 0, NI_NAMEREQD as i32)
      }
    };
    if r != 0 {
      return String::new();
    }
  }
  let n = host.iter().position(|&c| c == 0).unwrap_or(host.len());
  String::from_utf16_lossy(&host[..n])
}

#[tauri::command]
async fn resolve_host(ip: String) -> String {
  let Ok(addr) = ip.trim().parse::<std::net::IpAddr>() else { return String::new() };
  tauri::async_runtime::spawn_blocking(move || reverse_lookup(addr)).await.unwrap_or_default()
}

/// 通知ポップアップの幅（論理ピクセル）と画面の端からの余白
const NOTIFY_WIDTH: f64 = 340.0;
const NOTIFY_MARGIN: f64 = 12.0;

/// 通知ポップアップ用の小さなウィンドウを作る（最初は隠しておく）。
/// 他のアプリから操作を奪わないよう、フォーカスを受け取らない窓にする。
fn create_notify_window(app: &tauri::AppHandle) -> tauri::Result<()> {
  tauri::WebviewWindowBuilder::new(app, "notify", tauri::WebviewUrl::App("notify.html".into()))
    .title("PecaList 通知")
    .inner_size(NOTIFY_WIDTH, 100.0)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focusable(false)
    .focused(false)
    .shadow(true)
    .visible(false)
    .build()?;
  Ok(())
}

/// 通知ポップアップの大きさと位置を決めて表示する。height が 0 なら隠す。
/// corner: "br" 右下 / "tr" 右上 / "bl" 左下 / "tl" 左上
/// hide_from_capture: true なら、配信ソフトなどの画面取り込みに映らないようにする
#[tauri::command]
fn notify_layout(app: tauri::AppHandle, height: f64, corner: String, hide_from_capture: bool) -> Result<(), String> {
  use tauri::Manager;
  let win = app.get_webview_window("notify").ok_or("通知の窓がありません")?;
  if height <= 0.0 {
    return win.hide().map_err(|e| e.to_string());
  }
  let monitor = win
    .primary_monitor()
    .map_err(|e| e.to_string())?
    .ok_or("画面の情報を取れませんでした")?;
  let scale = monitor.scale_factor();
  let area = monitor.work_area();
  let w = (NOTIFY_WIDTH * scale).round() as i32;
  let h = (height * scale).round() as i32;
  let m = (NOTIFY_MARGIN * scale).round() as i32;
  let left = area.position.x + m;
  let right = area.position.x + area.size.width as i32 - w - m;
  let top = area.position.y + m;
  let bottom = area.position.y + area.size.height as i32 - h - m;
  let (x, y) = match corner.as_str() {
    "tr" => (right, top),
    "bl" => (left, bottom),
    "tl" => (left, top),
    _ => (right, bottom),
  };
  win.set_content_protected(hide_from_capture).map_err(|e| e.to_string())?;
  win.set_size(tauri::PhysicalSize::new(w as u32, h as u32)).map_err(|e| e.to_string())?;
  win.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
  win.set_always_on_top(true).map_err(|e| e.to_string())?;
  win.show().map_err(|e| e.to_string())
}


/// 本文テーマと反対の明暗をタイトルバーに使う（ダーク本文→白、ライト本文→黒）。
#[tauri::command]
fn set_titlebar_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
  use tauri::Manager;
  use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE};
  // タイトルバーを、本文の上のツールバーと同じ色にする（style.css の --panel と --text）。
  // 色は COLORREF（0x00BBGGRR）。ダーク：#1b1f24 に #e4e7eb、ライト：#ffffff に #1d2228
  let (caption, text, dark_caption): (u32, u32, u32) = match theme.as_str() {
    "dark" => (0x0024_1f1b, 0x00eb_e7e4, 1),
    "light" => (0x00ff_ffff, 0x0028_221d, 0),
    _ => return Err("テーマはlightまたはdarkを指定してください".into()),
  };
  let win = app.get_webview_window("main").ok_or("メインウィンドウがありません")?;
  let hwnd = win.hwnd().map_err(|e| e.to_string())?;
  for (attribute, value) in [(DWMWA_USE_IMMERSIVE_DARK_MODE, dark_caption), (DWMWA_CAPTION_COLOR, caption), (DWMWA_TEXT_COLOR, text)] {
    let hr = unsafe {
      DwmSetWindowAttribute(hwnd.0 as _, attribute as u32, &value as *const u32 as _, std::mem::size_of::<u32>() as u32)
    };
    if hr < 0 { return Err(format!("タイトルバーの色を設定できませんでした: {hr:#x}")); }
  }
  Ok(())
}

// ---- 右に張り付ける ----

/// 窓の位置と大きさ（画面の点の単位。元に戻すときに使う）
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy)]
struct WinRect {
  x: i32,
  y: i32,
  w: u32,
  h: u32,
}

/// 見えている窓のふち（Windows の窓は、まわりに見えない「つかみしろ」があるので、それを除いたもの）
fn visible_frame(hwnd: isize) -> Option<(i32, i32, i32, i32)> {
  use windows_sys::Win32::Foundation::RECT;
  use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
  let mut r: RECT = unsafe { std::mem::zeroed() };
  let hr = unsafe { DwmGetWindowAttribute(hwnd as _, DWMWA_EXTENDED_FRAME_BOUNDS as u32, &mut r as *mut RECT as _, std::mem::size_of::<RECT>() as u32) };
  (hr >= 0).then_some((r.left, r.top, r.right, r.bottom))
}

/// 今いる画面の右端に、上から下までの高さで、幅 width（画面の点ではなく見た目の大きさ）の窓にする。
/// 張り付ける前の位置と大きさを返す（元に戻すときに使う）
#[tauri::command]
fn dock_right(app: tauri::AppHandle, width: f64) -> Result<WinRect, String> {
  use tauri::Manager;
  let win = app.get_webview_window("main").ok_or("メインウィンドウがありません")?;
  let _ = win.unmaximize();
  let pos = win.outer_position().map_err(|e| e.to_string())?;
  let size = win.outer_size().map_err(|e| e.to_string())?;
  let prev = WinRect { x: pos.x, y: pos.y, w: size.width, h: size.height };
  let monitor = win.current_monitor().map_err(|e| e.to_string())?.or(win.primary_monitor().map_err(|e| e.to_string())?).ok_or("画面の情報を取れませんでした")?;
  let area = monitor.work_area();
  let scale = monitor.scale_factor();
  let w = (width.clamp(150.0, 900.0) * scale).round() as u32;
  // まず外側の大きさで合わせ、そのあと「見えるふち」が画面の端にぴったり付くようにずらす
  win.set_size(tauri::PhysicalSize::new(w, area.size.height)).map_err(|e| e.to_string())?;
  let outer = win.outer_size().map_err(|e| e.to_string())?;
  let inner = win.inner_size().map_err(|e| e.to_string())?;
  let extra_h = outer.height.saturating_sub(inner.height);
  win.set_size(tauri::PhysicalSize::new(w, area.size.height.saturating_sub(extra_h))).map_err(|e| e.to_string())?;
  let outer = win.outer_size().map_err(|e| e.to_string())?;
  let right = area.position.x + area.size.width as i32;
  win.set_position(tauri::PhysicalPosition::new(right - outer.width as i32, area.position.y)).map_err(|e| e.to_string())?;
  let hwnd = win.hwnd().map_err(|e| e.to_string())?.0 as isize;
  if let (Some((_, t, r, b)), Ok(p)) = (visible_frame(hwnd), win.outer_position()) {
    // 見えないつかみしろの分だけ、右・上・下を画面の端に合わせ直す
    let (pad_t, pad_r, pad_b) = (t - p.y, p.x + outer.width as i32 - r, p.y + outer.height as i32 - b);
    let h = (area.size.height as i32 + pad_t + pad_b).max(100) as u32;
    win.set_size(tauri::PhysicalSize::new(w, h.saturating_sub(extra_h))).map_err(|e| e.to_string())?;
    win.set_position(tauri::PhysicalPosition::new(right - outer.width as i32 + pad_r, area.position.y - pad_t)).map_err(|e| e.to_string())?;
  }
  Ok(prev)
}

/// 張り付ける前の位置と大きさに戻す
#[tauri::command]
fn undock(app: tauri::AppHandle, rect: WinRect) -> Result<(), String> {
  use tauri::Manager;
  let win = app.get_webview_window("main").ok_or("メインウィンドウがありません")?;
  win.set_size(tauri::PhysicalSize::new(rect.w.max(360), rect.h.max(320))).map_err(|e| e.to_string())?;
  let outer = win.outer_size().map_err(|e| e.to_string())?;
  // 外側の大きさで覚えているので、ずれた分を直す
  let (dw, dh) = (outer.width as i64 - rect.w as i64, outer.height as i64 - rect.h as i64);
  if dw != 0 || dh != 0 {
    let inner = win.inner_size().map_err(|e| e.to_string())?;
    let w = (inner.width as i64 - dw).max(360) as u32;
    let h = (inner.height as i64 - dh).max(320) as u32;
    win.set_size(tauri::PhysicalSize::new(w, h)).map_err(|e| e.to_string())?;
  }
  win.set_position(tauri::PhysicalPosition::new(rect.x, rect.y)).map_err(|e| e.to_string())
}

/// 張り付けているときの重なり方を「最下面」にしているか（クリックされても後ろに戻すため）
static KEEP_BOTTOM: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 窓をほかの窓の後ろ（いちばん下）に回す。前に出さない（操作は奪わない）
fn send_to_bottom(win: &tauri::WebviewWindow) {
  use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE};
  if let Ok(h) = win.hwnd() {
    unsafe { SetWindowPos(h.0 as _, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
  }
}

/// 重なり方：top 常に手前 / normal ふつう / bottom 最下面（ほかの窓の後ろ。クリックしても前に出ない）
#[tauri::command]
fn set_layer(app: tauri::AppHandle, layer: String) -> Result<(), String> {
  use tauri::Manager;
  let win = app.get_webview_window("main").ok_or("メインウィンドウがありません")?;
  win.set_always_on_top(layer == "top").map_err(|e| e.to_string())?;
  let bottom = layer == "bottom";
  KEEP_BOTTOM.store(bottom, std::sync::atomic::Ordering::SeqCst);
  if bottom {
    send_to_bottom(&win);
  }
  Ok(())
}

/// タスクバーの PecaList のアイコンを点滅させる
#[tauri::command]
fn flash_taskbar(app: tauri::AppHandle) -> Result<(), String> {
  use tauri::Manager;
  if let Some(win) = app.get_webview_window("main") {
    win.request_user_attention(Some(tauri::UserAttentionType::Informational)).map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// 通知音のファイルを読む（wav / mp3 / ogg、10MB まで）。画面側で再生する。
#[tauri::command]
fn read_sound_file(path: String) -> Result<tauri::ipc::Response, String> {
  let p = std::path::Path::new(&path);
  let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
  if !["wav", "mp3", "ogg"].contains(&ext.as_str()) {
    return Err("通知音は wav / mp3 / ogg のファイルを選んでください".into());
  }
  let meta = std::fs::metadata(p).map_err(|e| format!("ファイルが見つかりません: {e}"))?;
  if meta.len() > 10 * 1024 * 1024 {
    return Err("通知音のファイルが大きすぎます（10MBまで）".into());
  }
  let bytes = std::fs::read(p).map_err(|e| format!("読み込めませんでした: {e}"))?;
  Ok(tauri::ipc::Response::new(bytes))
}

/// プレイヤーや掲示板ブラウザなど、設定で登録されたアプリを起動する。
/// 起動したアプリは PecaList とは別に動き続ける。
#[tauri::command]
fn launch(path: String, args: Vec<String>) -> Result<(), String> {
  let exe = std::path::Path::new(&path);
  if !exe.is_file() {
    return Err(format!("ファイルが見つかりません: {path}"));
  }
  let mut cmd = std::process::Command::new(exe);
  cmd.args(&args);
  // 設定ファイルを自分のフォルダに置くアプリ（PCRPlayer など）のため、作業フォルダをアプリの場所にする
  if let Some(dir) = exe.parent() {
    cmd.current_dir(dir);
  }
  cmd.spawn().map(|_| ()).map_err(|e| format!("起動できませんでした: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // 設定の置き場所は、窓を作る前に決める（画面の一時データの場所も、ここで exe の横に向ける）
  let prepared = std::env::current_exe().map_err(|e| e.to_string())
    .and_then(|exe| data_dir::prepare(&exe, std::env::var_os("PECALIST_DATA_DIR"), &data_dir::OldDirs::from_env()));
  let mut context = tauri::generate_context!();
  let webview = match &prepared {
    Ok(dir) => data_dir::webview_dir(dir),
    // 準備に失敗したときは、終了の案内を出すまでの間だけ一時フォルダーを使う
    Err(_) => std::env::temp_dir().join("PecaList-webview"),
  };
  context.config_mut().app.app_directories_override = Some(tauri::utils::config::AppDirectoriesOverride::Root(webview));
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .manage(recorder::Recorders::default())
    .manage(p2p::P2p::default())
    .setup(move |app| {
      use tauri::Manager;
      let data = match prepared {
        Ok(path) => path,
        Err(error) => {
          use tauri_plugin_dialog::DialogExt;
          app.dialog().message(format!("設定を準備できませんでした。\n{error}\n\nPecaList を終了します。書き込めるフォルダーへ置いてから起動してください。"))
            .title("PecaList").kind(tauri_plugin_dialog::MessageDialogKind::Error).blocking_show();
          return Err(error.into());
        }
      };
      app.manage(data_dir::DataDir(data));
      create_notify_window(app.handle())?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      app_info,
      p2p::p2p_state,
      p2p::p2p_action,
      fetch_text,
      fetch_bbs_subject,
      launch,
      load_store,
      save_store,
      delete_store,
      show_notification,
      read_sound_file,
      notify_layout,
      flash_taskbar,
      set_titlebar_theme,
      dock_right,
      undock,
      set_layer,
      resolve_host,
      pecarec_read,
      recorder::rec_start,
      recorder::rec_stop,
      recorder::rec_open,
      recorder::rec_reveal,
      recorder::rec_trash,
      recorder::rec_disk,
      recorder::rec_exists,
      recorder::rec_probe,
      recorder::rec_default_dir,
    ])
    .on_window_event(|win, ev| {
      // メインの窓を閉じたらアプリを終わる（通知の窓だけが残らないように）
      if win.label() == "main" && matches!(ev, tauri::WindowEvent::Destroyed) {
        use tauri::Manager;
        win.app_handle().exit(0);
      }
      // 最下面にしているときは、クリックされて前に出ても、すぐ後ろに戻す
      if win.label() == "main" && matches!(ev, tauri::WindowEvent::Focused(true)) && KEEP_BOTTOM.load(std::sync::atomic::Ordering::SeqCst) {
        use tauri::Manager;
        if let Some(w) = win.app_handle().get_webview_window("main") {
          send_to_bottom(&w);
        }
      }
    })
    .build(context)
    .expect("error while building tauri application")
    .run(|app, ev| {
      // 終わる前に、録画中のファイルを仕上げる（長さや早送り用の目印を書き込む）
      if let tauri::RunEvent::ExitRequested { .. } = ev {
        use tauri::Manager;
        app.state::<p2p::P2p>().shutdown();
        app.state::<recorder::Recorders>().stop_all_and_wait(Duration::from_secs(5));
      }
    });
}

#[cfg(test)]
mod tests {
  use super::decode_text;

  #[test]
  fn reverse_lookup_localhost() {
    // 127.0.0.1 は、どの PC でも何かしらの名前が返る
    assert!(!super::reverse_lookup("127.0.0.1".parse().unwrap()).is_empty());
  }

  #[test]
  fn decodes_utf8() {
    assert_eq!(decode_text("テスト<>".as_bytes()), "テスト<>");
  }

  #[test]
  fn decodes_utf8_with_bom() {
    let mut b = vec![0xEF, 0xBB, 0xBF];
    b.extend_from_slice("あ".as_bytes());
    assert_eq!(decode_text(&b), "あ");
  }

  #[test]
  fn decodes_shift_jis() {
    let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode("配信中");
    assert_eq!(decode_text(&sjis), "配信中");
  }
}
