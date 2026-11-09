// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

//! 録画。ペカステからチャンネルの映像を受け取り、FLV のファイルに保存する。
//!
//! - 映像の切れ目が届くまでファイルを作らない（頭の部分だけの失敗ファイルを作らない）
//! - 切れても、決めた時間内に戻ってきたら同じファイルの続きに書く
//! - 止めるときに、長さ・大きさ・早送り用の目印をファイルの先頭に書き込む

use crate::flv::{self, Action, Keyframe, Parser, Splicer, Tag};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

/// 1回の受け取りで、これだけ何も届かなければ切れたとみなす
const READ_TIMEOUT: Duration = Duration::from_secs(15);
/// つなぎ直すまでの間
const RETRY_DELAY: Duration = Duration::from_secs(5);
/// 画面に状態を知らせる間隔
const STATUS_EVERY: Duration = Duration::from_secs(1);
/// ファイルに書き出す間隔（エクスプローラーで大きさが分かるように）
const FLUSH_EVERY: Duration = Duration::from_secs(2);
/// ペカステに「つなぎ直し」を頼む間隔の下限
const BUMP_EVERY: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------------------
// ファイルへの書き込み

struct FileWriter {
  out: BufWriter<File>,
  path: PathBuf,
  pos: u64,
  meta: Option<Vec<u8>>,
  keyframes: Vec<Keyframe>,
  last_ms: u32,
  last_flush: Instant,
}

impl FileWriter {
  fn open(path: PathBuf, meta: Option<Vec<u8>>, video_config: Option<Vec<u8>>, audio_config: Option<Vec<u8>>) -> std::io::Result<Self> {
    if let Some(dir) = path.parent() {
      std::fs::create_dir_all(dir)?;
    }
    let file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
    let mut w = FileWriter {
      out: BufWriter::with_capacity(256 * 1024, file),
      path,
      pos: 0,
      meta,
      keyframes: Vec::new(),
      last_ms: 0,
      last_flush: Instant::now(),
    };
    w.put(&flv::file_header(video_config.is_some(), true))?;
    let script = flv::build_script(w.meta.as_deref(), 0, 0, &[]);
    w.put(&flv::write_tag(flv::TAG_SCRIPT, 0, &script))?;
    if let Some(v) = video_config {
      w.put(&flv::write_tag(flv::TAG_VIDEO, 0, &v))?;
    }
    if let Some(a) = audio_config {
      w.put(&flv::write_tag(flv::TAG_AUDIO, 0, &a))?;
    }
    Ok(w)
  }

  fn put(&mut self, bytes: &[u8]) -> std::io::Result<()> {
    self.out.write_all(bytes)?;
    self.pos += bytes.len() as u64;
    Ok(())
  }

  fn write(&mut self, tag: &Tag, keyframe: bool) -> std::io::Result<()> {
    if keyframe {
      self.keyframes.push(Keyframe { pos: self.pos, ms: tag.ts });
    }
    self.last_ms = self.last_ms.max(tag.ts);
    self.put(&flv::write_tag(tag.kind, tag.ts, &tag.data))?;
    if self.last_flush.elapsed() >= FLUSH_EVERY {
      self.out.flush()?;
      self.last_flush = Instant::now();
    }
    Ok(())
  }

  /// 長さ・大きさ・早送り用の目印を先頭に書き込んで閉じる
  fn finish(mut self) -> std::io::Result<FileDone> {
    self.out.flush()?;
    let script = flv::build_script(self.meta.as_deref(), self.last_ms, self.pos, &self.keyframes);
    let file = self.out.get_mut();
    file.seek(SeekFrom::Start(flv::SCRIPT_DATA_POS))?;
    file.write_all(&script)?;
    file.sync_all()?;
    Ok(FileDone { path: self.path.to_string_lossy().into_owned(), ms: self.last_ms, bytes: self.pos, seams: 0 })
  }
}

// ---------------------------------------------------------------------------
// 画面とのやりとり

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
  /// ペカステのアドレス（localhost:7144 など）
  pub peercast: String,
  pub channel_id: String,
  pub tip: String,
  /// 保存先のフォルダ
  pub dir: String,
  /// チャンネルごとのフォルダ名（空ならフォルダを作らない）
  pub sub: String,
  /// ファイル名（拡張子なし）
  pub base: String,
  /// 切れたとき、戻ってくるのを待つ秒数
  pub wait_sec: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileDone {
  pub path: String,
  pub ms: u32,
  pub bytes: u64,
  pub seams: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Status {
  id: u64,
  /// connecting 接続中 / waiting 切れて待っている / recording 録画中 / done 終わった
  state: &'static str,
  path: String,
  ms: u32,
  bytes: u64,
  seams: u32,
  /// 待っているとき、あと何秒待つか
  wait_left: u64,
  /// 終わったときの理由（stopped 止めた / gone 戻ってこなかった / error）
  reason: &'static str,
  error: String,
  relay_error: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileEvent {
  id: u64,
  #[serde(flatten)]
  file: FileDone,
}

struct Control {
  stop: AtomicBool,
  wake: tokio::sync::Notify,
}

#[derive(Default)]
pub struct Recorders {
  next: AtomicU64,
  map: Mutex<HashMap<u64, (Arc<Control>, tauri::async_runtime::JoinHandle<()>)>>,
}

impl Recorders {
  /// すべての録画を止めて、ファイルの仕上げが終わるのを待つ（アプリの終了時）
  pub fn stop_all_and_wait(&self, limit: Duration) {
    let list: Vec<_> = self.map.lock().unwrap().drain().map(|(_, v)| v).collect();
    if list.is_empty() {
      return;
    }
    for (c, _) in &list {
      c.stop.store(true, Ordering::SeqCst);
      c.wake.notify_one();
    }
    tauri::async_runtime::block_on(async move {
      let all = futures_util::future::join_all(list.into_iter().map(|(_, h)| h));
      let _ = tokio::time::timeout(limit, all).await;
    });
  }
}

/// ファイル名に使えない文字を、見た目の近い全角の文字に置き換える
pub fn safe_name(s: &str) -> String {
  let mut out: String = s
    .chars()
    .map(|c| match c {
      '\\' => '＼',
      '/' => '／',
      ':' => '：',
      '*' => '＊',
      '?' => '？',
      '"' => '”',
      '<' => '＜',
      '>' => '＞',
      '|' => '｜',
      c if c.is_control() => ' ',
      c => c,
    })
    .collect();
  // 末尾の点と空白は Windows で問題になる
  while out.ends_with('.') || out.ends_with(' ') {
    out.pop();
  }
  let out = out.trim_start().to_string();
  let upper = out.to_ascii_uppercase();
  let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
  if out.is_empty() || reserved.contains(&upper.as_str()) {
    return format!("_{out}");
  }
  // 長すぎる名前を切り詰める（フォルダ名・ファイル名それぞれ）
  out.chars().take(120).collect()
}

/// まだ使われていないファイル名を決める。n は同じ録画の中の何番目のファイルか（1から）
fn file_path(dir: &Path, base: &str, n: u32) -> PathBuf {
  let stem = if n <= 1 { base.to_string() } else { format!("{base}_{n}") };
  let mut p = dir.join(format!("{stem}.flv"));
  let mut i = 2;
  while p.exists() {
    p = dir.join(format!("{stem} ({i}).flv"));
    i += 1;
  }
  p
}

/// 録画の保存先。ドライブ直下を「C:」と書いた設定（ペカレコから取り込んだものなど）は「C:\」として扱う。
/// 「C:」のままだと Windows では「C ドライブの今いる場所」の意味になり、保存できない
fn rec_dir(dir: &str) -> PathBuf {
  let s = dir.trim();
  let b = s.as_bytes();
  if b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':' { PathBuf::from(format!("{s}\\")) } else { PathBuf::from(s) }
}

#[tauri::command]
pub fn rec_start(app: tauri::AppHandle, recs: tauri::State<'_, Recorders>, req: StartRequest) -> Result<u64, String> {
  if !req.channel_id.chars().all(|c| c.is_ascii_hexdigit()) || req.channel_id.len() != 32 {
    return Err("チャンネルIDが正しくありません".into());
  }
  if req.dir.trim().is_empty() {
    return Err("録画の保存先が決まっていません（⚙ 設定）".into());
  }
  let dir = rec_dir(&req.dir);
  if !dir.is_absolute() {
    return Err("録画の保存先は C:\\… のように書いてください".into());
  }
  let dir = if req.sub.is_empty() { dir.to_path_buf() } else { dir.join(safe_name(&req.sub)) };
  let id = recs.next.fetch_add(1, Ordering::SeqCst) + 1;
  let control = Arc::new(Control { stop: AtomicBool::new(false), wake: tokio::sync::Notify::new() });
  let job = Job {
    id,
    app: app.clone(),
    peercast: req.peercast,
    channel_id: req.channel_id.to_ascii_uppercase(),
    tip: req.tip,
    dir,
    base: safe_name(&req.base),
    wait: Duration::from_secs(req.wait_sec.clamp(30, 6 * 3600)),
    control: control.clone(),
  };
  let handle = tauri::async_runtime::spawn(job.run());
  recs.map.lock().unwrap().insert(id, (control, handle));
  Ok(id)
}

#[tauri::command]
pub fn rec_stop(recs: tauri::State<'_, Recorders>, id: u64) {
  if let Some((c, _)) = recs.map.lock().unwrap().get(&id) {
    c.stop.store(true, Ordering::SeqCst);
    c.wake.notify_one();
  }
}

// 録画のHTTP接続を閉じたあと、使われていないチャンネルをペカステから削除する。
// stopChannel は視聴者も切るため、配信・視聴・下流リレーがある場合は触らない。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelayStatus {
  local_directs: u64,
  local_relays: u64,
  is_broadcasting: bool,
}

async fn channel_rpc(client: &reqwest::Client, peercast: &str, channel_id: &str, method: &str) -> Result<serde_json::Value, String> {
  let response = client.post(format!("http://{peercast}/api/1"))
    .header("X-Requested-With", "XMLHttpRequest")
    .header("Content-Type", "application/json")
    .body(serde_json::json!({"jsonrpc":"2.0", "id":1, "method":method, "params":{"channelId":channel_id}}).to_string())
    .send().await.map_err(|e| e.to_string())?
    .error_for_status().map_err(|e| e.to_string())?;
  let body: serde_json::Value = serde_json::from_slice(&response.bytes().await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
  if let Some(error) = body.get("error").filter(|v| !v.is_null()) {
    // 配信終了などで既に削除されたチャンネルは後始末済み。
    if error.get("code").and_then(|c| c.as_i64()) == Some(-1) { return Ok(serde_json::Value::Null); }
    return Err(format!("{method}: {error}"));
  }
  body.get("result").cloned().ok_or_else(|| format!("{method}: result がありません"))
}

async fn finish_relay(client: &reqwest::Client, peercast: &str, channel_id: &str) -> Result<(), String> {
  let cleanup = async {
    // HTTP切断がペカステの接続数に反映されるまで、短時間だけ再確認する。
    for attempt in 0..4 {
      let result = channel_rpc(client, peercast, channel_id, "getChannelStatus").await?;
      if result.is_null() { return Ok(()); }
      let status: RelayStatus = serde_json::from_value(result)
        .map_err(|e| e.to_string())?;
      if status.is_broadcasting || status.local_relays > 0 { return Ok(()); }
      if status.local_directs == 0 {
        channel_rpc(client, peercast, channel_id, "stopChannel").await?;
        return Ok(());
      }
      if attempt < 3 { tokio::time::sleep(Duration::from_millis(150)).await; }
    }
    Ok(())
  };
  tokio::time::timeout(Duration::from_secs(2), cleanup).await
    .map_err(|_| "リレー終了処理がタイムアウトしました".to_string())?
}

// ---------------------------------------------------------------------------
// 録画1つ分の仕事

struct Job {
  id: u64,
  app: tauri::AppHandle,
  peercast: String,
  channel_id: String,
  tip: String,
  dir: PathBuf,
  base: String,
  wait: Duration,
  control: Arc<Control>,
}

enum ReadEnd {
  Stopped,
  /// ペカステが接続を閉じた
  Closed,
  /// しばらく何も届かなかった（上流が止まっているかもしれない）
  Stalled,
  Error(String),
}

struct Progress {
  state: &'static str,
  writer: Option<FileWriter>,
  file_no: u32,
  splicer: Splicer,
  /// 最後に映像や音声を書いた時刻（ここから待つ時間を数える）
  last_media: Instant,
  last_status: Instant,
  last_bump: Option<Instant>,
  error: String,
  relay_error: String,
}

impl Job {
  fn stopped(&self) -> bool {
    self.control.stop.load(Ordering::SeqCst)
  }

  fn stream_url(&self) -> String {
    let tip = if self.tip.is_empty() { String::new() } else { format!("?tip={}", urlencode(&self.tip)) };
    format!("http://{}/stream/{}.flv{}", self.peercast, self.channel_id, tip)
  }

  fn emit(&self, p: &Progress, reason: &'static str) {
    let (path, ms, bytes) = match &p.writer {
      Some(w) => (w.path.to_string_lossy().into_owned(), w.last_ms, w.pos),
      None => (String::new(), 0, 0),
    };
    let wait_left = if p.state == "waiting" { self.wait.saturating_sub(p.last_media.elapsed()).as_secs() } else { 0 };
    let _ = self.app.emit_to(
      "main",
      "rec:status",
      Status { id: self.id, state: p.state, path, ms, bytes, seams: p.splicer.seams, wait_left, reason, error: p.error.clone(), relay_error: p.relay_error.clone() },
    );
  }

  fn close_file(&self, p: &mut Progress) {
    if let Some(w) = p.writer.take() {
      let seams = p.splicer.seams;
      match w.finish() {
        Ok(mut f) => {
          f.seams = seams;
          let _ = self.app.emit_to("main", "rec:file", FileEvent { id: self.id, file: f });
        }
        Err(e) => p.error = format!("ファイルの仕上げに失敗しました: {e}"),
      }
    }
  }

  fn handle(&self, p: &mut Progress, actions: Vec<Action>) -> Result<(), String> {
    for a in actions {
      match a {
        Action::NewFile { meta, video_config, audio_config } => {
          self.close_file(p);
          p.file_no += 1;
          let path = file_path(&self.dir, &self.base, p.file_no);
          let w = FileWriter::open(path, meta, video_config, audio_config).map_err(|e| format!("ファイルを作れませんでした: {e}"))?;
          p.writer = Some(w);
        }
        Action::Write { tag, keyframe } => {
          if let Some(w) = p.writer.as_mut() {
            w.write(&tag, keyframe).map_err(|e| format!("書き込めませんでした: {e}"))?;
          }
          p.last_media = Instant::now();
          p.state = "recording";
        }
      }
    }
    Ok(())
  }

  /// 1回の接続で受け取れるだけ受け取る
  async fn read_once(&self, client: &reqwest::Client, p: &mut Progress) -> ReadEnd {
    let request = client.get(self.stream_url()).send();
    let stop = self.control.wake.notified();
    futures_util::pin_mut!(request, stop);
    let response = match futures_util::future::select(request, stop).await {
      futures_util::future::Either::Left((r, _)) => r,
      futures_util::future::Either::Right(_) => return ReadEnd::Stopped,
    };
    let res = match response {
      Ok(r) if r.status().is_success() => r,
      Ok(r) => return ReadEnd::Error(format!("ペカステの応答: {}", r.status())),
      Err(e) => return ReadEnd::Error(format!("ペカステにつながりません: {e}")),
    };
    let mut res = res;
    let mut parser = Parser::new();
    p.splicer.begin_connection();
    loop {
      if self.stopped() {
        return ReadEnd::Stopped;
      }
      let next = {
        let chunk = tokio::time::timeout(READ_TIMEOUT, res.chunk());
        let stop = self.control.wake.notified();
        futures_util::pin_mut!(chunk, stop);
        match futures_util::future::select(chunk, stop).await {
          futures_util::future::Either::Left((r, _)) => r,
          futures_util::future::Either::Right(_) => return ReadEnd::Stopped,
        }
      };
      let bytes = match next {
        Ok(Ok(Some(b))) => b,
        Ok(Ok(None)) => return ReadEnd::Closed,
        Ok(Err(e)) => return ReadEnd::Error(format!("受け取りが止まりました: {e}")),
        Err(_) => return ReadEnd::Stalled,
      };
      let tags = match parser.push(&bytes) {
        Ok(t) => t,
        Err(e) => return ReadEnd::Error(e),
      };
      for tag in tags {
        let actions = p.splicer.push(tag);
        if let Err(e) = self.handle(p, actions) {
          return ReadEnd::Error(e);
        }
      }
      if p.last_status.elapsed() >= STATUS_EVERY {
        p.last_status = Instant::now();
        self.emit(p, "");
      }
    }
  }

  /// ペカステに、そのチャンネルの上流へのつなぎ直しを頼む
  async fn bump(&self, client: &reqwest::Client) {
    let body = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "bumpChannel", "params": { "channelId": self.channel_id } });
    let request = client
      .post(format!("http://{}/api/1", self.peercast))
      .header("X-Requested-With", "XMLHttpRequest")
      .header("Content-Type", "application/json")
      .body(body.to_string())
      .timeout(Duration::from_secs(5))
      .send();
    let stop = self.control.wake.notified();
    futures_util::pin_mut!(request, stop);
    let _ = futures_util::future::select(request, stop).await;
  }

  async fn run(self) {
    let client = match reqwest::Client::builder()
      .user_agent(concat!("PecaList/", env!("CARGO_PKG_VERSION")))
      .connect_timeout(Duration::from_secs(10))
      .no_proxy()
      .build()
    {
      Ok(c) => c,
      Err(e) => {
        let mut p = Progress::new();
        p.state = "done";
        p.error = e.to_string();
        self.emit(&p, "error");
        return;
      }
    };
    let mut p = Progress::new();
    self.emit(&p, "");
    let reason = loop {
      if self.stopped() {
        break "stopped";
      }
      let had_file = p.splicer.has_file();
      let mut stalled = false;
      match self.read_once(&client, &mut p).await {
        ReadEnd::Stopped => break "stopped",
        ReadEnd::Closed => {}
        ReadEnd::Stalled => stalled = true,
        ReadEnd::Error(e) => {
          // ファイルに書けないときは続けても無駄なので止める
          if e.starts_with("ファイル") || e.starts_with("書き込めません") {
            p.error = e;
            break "error";
          }
          p.error = e;
        }
      }
      if self.stopped() {
        break "stopped";
      }
      // 切れた：決めた時間を過ぎても戻ってこなければ終わる
      if p.last_media.elapsed() >= self.wait {
        break "gone";
      }
      p.state = if p.splicer.has_file() { "waiting" } else { "connecting" };
      self.emit(&p, "");
      // 録画の途中でデータが止まったときは、ペカステに上流へのつなぎ直しを頼む
      // （接続が閉じられただけのときは頼まない。同じチャンネルを見ているプレイヤーまで止まるため）
      if stalled && had_file && p.last_bump.is_none_or(|t| t.elapsed() >= BUMP_EVERY) {
        p.last_bump = Some(Instant::now());
        self.bump(&client).await;
      }
      if self.stopped() { break "stopped"; }
      let _ = tokio::time::timeout(RETRY_DELAY, self.control.wake.notified()).await;
    };
    self.close_file(&mut p);
    // read_once の応答は既に破棄され、録画の受信接続は閉じている。
    if let Err(e) = finish_relay(&client, &self.peercast, &self.channel_id).await {
      let message = format!("ペカステのリレーを終了できませんでした: {e}");
      log::warn!("{message}");
      p.relay_error = message;
    }
    p.state = "done";
    self.emit(&p, reason);
    if let Some(recs) = tauri::Manager::try_state::<Recorders>(&self.app) {
      recs.map.lock().unwrap().remove(&self.id);
    }
  }
}

impl Progress {
  fn new() -> Self {
    Progress {
      state: "connecting",
      writer: None,
      file_no: 0,
      splicer: Splicer::new(),
      last_media: Instant::now(),
      last_status: Instant::now(),
      last_bump: None,
      error: String::new(),
      relay_error: String::new(),
    }
  }
}

fn urlencode(s: &str) -> String {
  s.bytes()
    .map(|b| match b {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
      _ => format!("%{b:02X}"),
    })
    .collect()
}

// ---------------------------------------------------------------------------
// 録画したファイルの操作

fn check_flv(path: &str) -> Result<&Path, String> {
  let p = Path::new(path);
  let ext_ok = p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("flv"));
  if !p.is_absolute() || !ext_ok {
    return Err("録画のファイルではありません".into());
  }
  Ok(p)
}

/// 録画のファイルを、Windows でそのファイルに結び付いているアプリで開く
#[tauri::command]
pub fn rec_open(path: String) -> Result<(), String> {
  let p = check_flv(&path)?;
  if !p.is_file() {
    return Err("ファイルが見つかりません（移動か削除されたかもしれません）".into());
  }
  std::process::Command::new("explorer").arg(p).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// 録画のファイルを選んだ状態で、エクスプローラーでフォルダを開く
#[tauri::command]
pub fn rec_reveal(path: String) -> Result<(), String> {
  let p = Path::new(&path);
  if p.is_file() {
    use std::os::windows::process::CommandExt;
    // explorer は引数のクォートを独自に解釈するので、組み立てた形のまま渡す
    let mut cmd = std::process::Command::new("explorer");
    cmd.raw_arg(format!("/select,\"{}\"", p.display()));
    return cmd.spawn().map(|_| ()).map_err(|e| e.to_string());
  }
  // ファイルがなければ、あるところまでのフォルダを開く
  let mut dir = p.to_path_buf();
  while !dir.is_dir() {
    if !dir.pop() {
      return Err("フォルダが見つかりません".into());
    }
  }
  std::process::Command::new("explorer").arg(dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// 録画のファイルをごみ箱に入れる（元に戻せる）
#[tauri::command]
pub fn rec_trash(paths: Vec<String>) -> Result<(), String> {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE, SHFILEOPSTRUCTW};
  let mut list: Vec<u16> = Vec::new();
  for path in &paths {
    let p = check_flv(path)?;
    if !p.is_file() {
      continue;
    }
    list.extend(p.as_os_str().encode_wide());
    list.push(0);
  }
  if list.is_empty() {
    return Ok(());
  }
  list.push(0);
  let mut op: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
  op.wFunc = FO_DELETE;
  op.pFrom = list.as_ptr();
  op.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI) as u16;
  let r = unsafe { SHFileOperationW(&mut op) };
  if r != 0 {
    return Err(format!("ごみ箱に入れられませんでした（{r}）"));
  }
  if op.fAnyOperationsAborted != 0 {
    return Err("ごみ箱に入れるのが途中で止まりました".into());
  }
  Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
  free: u64,
  total: u64,
}

/// 保存先のドライブの空きと全体の大きさ
#[tauri::command]
pub fn rec_disk(dir: String) -> Result<DiskInfo, String> {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
  let mut p = rec_dir(&dir);
  while !p.is_dir() {
    if !p.pop() {
      return Err("保存先が見つかりません".into());
    }
  }
  let wide: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
  let (mut free, mut total, mut _all_free) = (0u64, 0u64, 0u64);
  let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut _all_free) };
  if ok == 0 {
    return Err("空き容量を調べられませんでした".into());
  }
  Ok(DiskInfo { free, total })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
  ms: u32,
  bytes: u64,
}

/// 録画のファイルの長さと大きさを読む（アプリが落ちて、一覧の数字が途中のままのときに使う）。
/// 先頭の情報に長さがなければ（仕上げる前に落ちた）、最後のタグの時刻を使う。
fn probe(path: &Path) -> std::io::Result<Probe> {
  use std::io::Read;
  let mut f = File::open(path)?;
  let bytes = f.metadata()?.len();
  let mut head = vec![0u8; flv::SCRIPT_DATA_POS as usize + flv::SCRIPT_RESERVE];
  let n = f.read(&mut head)?;
  head.truncate(n);
  if let Some(ms) = head.get(flv::SCRIPT_DATA_POS as usize..).and_then(flv::meta_duration_ms) {
    return Ok(Probe { ms, bytes });
  }
  // ファイルの最後の4バイトは「最後のタグの大きさ」。そこから最後のタグの時刻を読む
  let mut ms = 0;
  if bytes > 4 + 11 {
    let mut b = [0u8; 4];
    f.seek(SeekFrom::End(-4))?;
    f.read_exact(&mut b)?;
    let size = u32::from_be_bytes(b) as u64;
    if size >= 11 && size + 4 <= bytes {
      let mut t = [0u8; 8];
      f.seek(SeekFrom::Start(bytes - 4 - size))?;
      f.read_exact(&mut t)?;
      ms = u32::from_be_bytes([t[7], t[4], t[5], t[6]]);
    }
  }
  Ok(Probe { ms, bytes })
}

#[tauri::command]
pub fn rec_probe(path: String) -> Result<Probe, String> {
  probe(check_flv(&path)?).map_err(|e| e.to_string())
}

/// ファイルがまだあるか（一覧から、消されたファイルを見分けるため）
#[tauri::command]
pub fn rec_exists(paths: Vec<String>) -> Vec<bool> {
  paths.iter().map(|p| Path::new(p).is_file()).collect()
}

/// 録画の保存先の初期値（ビデオ フォルダの中の「PecaList」）
#[tauri::command]
pub fn rec_default_dir(app: tauri::AppHandle) -> String {
  use tauri::Manager;
  app.path().video_dir().map(|d| d.join("PecaList").to_string_lossy().into_owned()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
  use super::*;

  // 実際のHTTP/JSON-RPCを通し、接続数が残る間はstopChannelしないことを確認。
  fn relay_fixture(replies: Vec<(&'static str, serde_json::Value)>) -> Result<(), String> {
    use std::io::{Read, Write};
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = server.local_addr().unwrap().to_string();
    let worker = std::thread::spawn(move || {
      for (method, reply) in replies {
        let (mut socket, _) = server.accept().unwrap();
        socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut request = Vec::new();
        let mut b = [0; 1024];
        loop {
          let n = socket.read(&mut b).unwrap();
          assert!(n > 0);
          request.extend_from_slice(&b[..n]);
          if let Some(end) = request.windows(4).position(|v| v == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
            let len: usize = head.lines().find_map(|line| line.strip_prefix("content-length:").map(str::trim)).unwrap().parse().unwrap();
            if request.len() >= end + 4 + len {
              let body: serde_json::Value = serde_json::from_slice(&request[end + 4..end + 4 + len]).unwrap();
              assert_eq!(body["method"], method);
              assert_eq!(body["params"]["channelId"], "A".repeat(32));
              assert!(head.contains("x-requested-with: xmlhttprequest"));
              break;
            }
          }
        }
        let body = reply.to_string();
        write!(socket, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
      }
    });
    let result = tauri::async_runtime::block_on(async {
      let client = reqwest::Client::builder().no_proxy().build().unwrap();
      finish_relay(&client, &address, &"A".repeat(32)).await
    });
    worker.join().unwrap();
    result
  }

  #[test]
  fn recording_releases_idle_relay_but_preserves_other_users() {
    let status = |directs, relays, broadcast| serde_json::json!({"result":{"localDirects":directs,"localRelays":relays,"isBroadcasting":broadcast}});
    assert!(relay_fixture(vec![
      ("getChannelStatus", status(1, 0, false)),
      ("getChannelStatus", status(0, 0, false)),
      ("stopChannel", serde_json::json!({"result":null})),
    ]).is_ok());
    assert!(relay_fixture(vec![("getChannelStatus", status(1, 0, false)); 4]).is_ok());
    assert!(relay_fixture(vec![("getChannelStatus", status(0, 1, false))]).is_ok());
    assert!(relay_fixture(vec![("getChannelStatus", status(0, 0, true))]).is_ok());
    assert!(relay_fixture(vec![("getChannelStatus", serde_json::json!({"error":{"code":-1}}))]).is_ok());
    assert!(relay_fixture(vec![("getChannelStatus", serde_json::json!({"result":{}}))]).is_err());
    assert!(relay_fixture(vec![("getChannelStatus", serde_json::json!({"error":{"code":-32603}}))]).is_err());
    assert!(relay_fixture(vec![
      ("getChannelStatus", status(0, 0, false)),
      ("stopChannel", serde_json::json!({"error":{"code":-32603}})),
    ]).is_err());
  }

  #[test]
  fn safe_name_replaces_bad_chars() {
    assert_eq!(safe_name("a/b:c?"), "a／b：c？");
    assert_eq!(safe_name("配信 ..."), "配信");
    assert_eq!(safe_name("con"), "_con");
    assert_eq!(safe_name(""), "_");
  }

  #[test]
  fn writer_makes_playable_file_with_index() {
    assert_eq!(rec_dir(" C: "), PathBuf::from("C:\\"));
    assert!(rec_dir("C:").is_absolute());
    assert_eq!(rec_dir("D:\\録画"), PathBuf::from("D:\\録画"));
    let dir = std::env::temp_dir().join(format!("nexus-rec-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let path = file_path(&dir, "テスト", 1);
    let mut w = FileWriter::open(path.clone(), None, Some(vec![0x17, 0, 0, 0, 1]), Some(vec![0xaf, 0, 0x12])).unwrap();
    w.write(&Tag { kind: flv::TAG_VIDEO, ts: 0, data: vec![0x17, 1, 0, 0, 0, 9] }, true).unwrap();
    w.write(&Tag { kind: flv::TAG_VIDEO, ts: 2000, data: vec![0x17, 1, 0, 0, 0, 9] }, true).unwrap();
    let done = w.finish().unwrap();
    assert_eq!(done.ms, 2000);
    let p = probe(&path).unwrap();
    assert_eq!((p.ms, p.bytes), (2000, done.bytes));
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(bytes.len() as u64, done.bytes);
    // 読み直すと、情報・設定2つ・映像2つのタグがある
    let tags = Parser::new().push(&bytes).unwrap();
    assert_eq!(tags.len(), 5);
    assert_eq!(tags[0].data.len(), flv::SCRIPT_RESERVE);
    // 2つ目のファイル名は _2、同じ名前があれば (2)
    assert!(file_path(&dir, "テスト", 2).ends_with("テスト_2.flv"));
    assert!(file_path(&dir, "テスト", 1).ends_with("テスト (2).flv"));
    // 仕上げる前に落ちたファイル：最後のタグの時刻から長さを読む
    let crashed = dir.join("落ちた.flv");
    let mut w = FileWriter::open(crashed.clone(), None, None, None).unwrap();
    w.write(&Tag { kind: flv::TAG_AUDIO, ts: 7500, data: vec![0xaf, 1, 9] }, false).unwrap();
    w.out.flush().unwrap();
    drop(w);
    assert_eq!(probe(&crashed).unwrap().ms, 7500);
    let _ = std::fs::remove_dir_all(&dir);
  }
}
