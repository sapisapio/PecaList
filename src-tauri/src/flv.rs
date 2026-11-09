// PecaList
// Copyright (C) 2026 sapisapio
// SPDX-License-Identifier: GPL-3.0-or-later

//! FLV（ピアキャスでよく使われる動画の形式）の読み書き。
//! ファイルにもネットにも触らない部分だけをここに置く（テストしやすくするため）。
//!
//! - `Parser`：届いたバイト列を「タグ」（映像1コマ、音声1かたまり、情報）に分ける
//! - `Splicer`：つなぎ直しをまたいで、時刻を0からの続きに振り直し、
//!   映像の切れ目（キーフレーム）が届くまで書き始めないようにする
//! - `build_script` / `write_tag`：ファイルに書く形を作る

pub const TAG_AUDIO: u8 = 8;
pub const TAG_VIDEO: u8 = 9;
pub const TAG_SCRIPT: u8 = 18;

/// タグ1つ分の最大の大きさ（これより大きいものは壊れたデータとみなす）
const MAX_TAG_SIZE: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct Tag {
  pub kind: u8,
  pub ts: u32,
  pub data: Vec<u8>,
}

// ---------------------------------------------------------------------------
// 読み取り

/// 届いたバイト列を、FLV のタグに分ける。1回の接続ごとに作り直す。
#[derive(Default)]
pub struct Parser {
  buf: Vec<u8>,
  pos: usize,
  header_done: bool,
}

impl Parser {
  pub fn new() -> Self {
    Self::default()
  }

  /// 受け取ったバイト列を足して、そろったタグを返す
  pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Tag>, String> {
    self.buf.extend_from_slice(bytes);
    let mut out = Vec::new();
    if !self.header_done {
      if self.buf.len() < 9 {
        return Ok(out);
      }
      if &self.buf[0..3] != b"FLV" {
        return Err("FLV の形式ではありません".into());
      }
      let offset = u32::from_be_bytes([self.buf[5], self.buf[6], self.buf[7], self.buf[8]]) as usize;
      // ヘッダーの後ろに「直前のタグの大きさ」（最初は0）が4バイト付く
      if offset < 9 || offset > 1024 {
        return Err("FLV のヘッダーが壊れています".into());
      }
      if self.buf.len() < offset + 4 {
        return Ok(out);
      }
      self.pos = offset + 4;
      self.header_done = true;
    }
    loop {
      let rest = &self.buf[self.pos..];
      if rest.len() < 11 {
        break;
      }
      let kind = rest[0] & 0x1f;
      let size = u32::from_be_bytes([0, rest[1], rest[2], rest[3]]) as usize;
      if size > MAX_TAG_SIZE {
        return Err("FLV のタグが大きすぎます（データが壊れています）".into());
      }
      if rest.len() < 11 + size + 4 {
        break;
      }
      let ts = u32::from_be_bytes([rest[7], rest[4], rest[5], rest[6]]);
      if kind == TAG_AUDIO || kind == TAG_VIDEO || kind == TAG_SCRIPT {
        out.push(Tag { kind, ts, data: rest[11..11 + size].to_vec() });
      }
      self.pos += 11 + size + 4;
    }
    // 読み終わった部分を捨てる（たまに詰める）
    if self.pos > 1024 * 1024 {
      self.buf.drain(..self.pos);
      self.pos = 0;
    }
    Ok(out)
  }
}

// ---------------------------------------------------------------------------
// タグの中身の見分け方

/// 映像タグの種類。「拡張ヘッダー」（HEVC・AV1 など新しい形式）にも対応する。
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum VideoKind {
  /// 再生の準備に使う情報（コーデックの設定）
  Config,
  /// 映像の切れ目（ここから再生を始められる）
  Keyframe,
  /// 普通のコマ
  Frame,
  /// その他（中身のないものなど）
  Other,
}

pub fn video_kind(data: &[u8]) -> VideoKind {
  if data.is_empty() {
    return VideoKind::Other;
  }
  let b = data[0];
  if b & 0x80 != 0 {
    // 拡張ヘッダー：上位4ビットのうち下3ビットがコマの種類、下4ビットがパケットの種類
    let frame = (b >> 4) & 0x07;
    let packet = b & 0x0f;
    return match packet {
      0 => VideoKind::Config,
      1 | 3 if frame == 1 => VideoKind::Keyframe,
      1 | 3 => VideoKind::Frame,
      _ => VideoKind::Other,
    };
  }
  let frame = b >> 4;
  let codec = b & 0x0f;
  if frame == 5 {
    return VideoKind::Other; // 情報だけのコマ
  }
  if codec == 7 || codec == 12 {
    // H.264（AVC）など：2バイト目が 0 なら設定、1 ならコマ
    match data.get(1) {
      Some(0) => return VideoKind::Config,
      Some(1) => {}
      _ => return VideoKind::Other,
    }
  }
  if frame == 1 { VideoKind::Keyframe } else { VideoKind::Frame }
}

/// 音声タグが「再生の準備に使う情報」（AAC の設定）か
pub fn audio_is_config(data: &[u8]) -> bool {
  data.len() >= 2 && (data[0] >> 4) == 10 && data[1] == 0
}

// ---------------------------------------------------------------------------
// つなぎ合わせ

/// 書き手に伝える指示
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
  /// 新しいファイルを始める（前のファイルがあれば閉じる）。
  /// 最初に書く「再生の準備の情報」も一緒に渡す。
  NewFile { meta: Option<Vec<u8>>, video_config: Option<Vec<u8>>, audio_config: Option<Vec<u8>> },
  /// タグを書く（時刻は振り直し済み）
  Write { tag: Tag, keyframe: bool },
}

/// 一続きの映像とみなせる範囲を超えた時刻の飛び（ミリ秒）
const JUMP_FORWARD_MS: u32 = 10_000;
const JUMP_BACK_MS: u32 = 1_000;
/// つなぎ目に入れる間（ミリ秒）。0 にすると、つなぎ目の前後のコマが同じ時刻になってしまう
const SEAM_MS: u32 = 33;
/// 映像が来ないまま、これだけ音声が届いたら「音声だけの配信」とみなして書き始める
const AUDIO_ONLY_AFTER: u32 = 100;

/// 接続が切れてつなぎ直しても、時刻を続きに振り直して1つのファイルにまとめる。
/// 新しいファイルを始めるのは次のときだけ：
/// - まだファイルがない（映像の切れ目が初めて届いた）
/// - 配信の形式（解像度など、再生の準備の情報）が変わった
#[derive(Default)]
pub struct Splicer {
  // 今書いているファイル
  file_open: bool,
  file_video_config: Option<Vec<u8>>,
  file_audio_config: Option<Vec<u8>>,
  last_out_ts: u32,
  // 今の接続
  conn_meta: Option<Vec<u8>>,
  conn_video_config: Option<Vec<u8>>,
  conn_audio_config: Option<Vec<u8>>,
  conn_saw_video: bool,
  conn_audio_waiting: u32,
  waiting_key: bool,
  base_in: u32,
  offset: u32,
  last_in_ts: u32,
  /// 今のファイルに、つなぎ目がいくつあるか
  pub seams: u32,
}

impl Splicer {
  pub fn new() -> Self {
    Self { waiting_key: true, ..Self::default() }
  }

  /// 新しく接続したときに呼ぶ
  pub fn begin_connection(&mut self) {
    self.conn_meta = None;
    self.conn_video_config = None;
    self.conn_audio_config = None;
    self.conn_saw_video = false;
    self.conn_audio_waiting = 0;
    self.waiting_key = true;
  }

  /// ファイルを書き始めているか
  pub fn has_file(&self) -> bool {
    self.file_open
  }

  pub fn push(&mut self, tag: Tag) -> Vec<Action> {
    let mut out = Vec::new();
    match tag.kind {
      TAG_SCRIPT => {
        if script_name(&tag.data).as_deref() == Some("onMetaData") {
          self.conn_meta = Some(tag.data);
        }
        return out;
      }
      TAG_VIDEO => match video_kind(&tag.data) {
        VideoKind::Config => {
          if self.file_open && !self.waiting_key && self.file_video_config.as_ref() != Some(&tag.data) {
            // 配信の途中で形式が変わった：次の切れ目から新しいファイルにする
            self.waiting_key = true;
          }
          self.conn_video_config = Some(tag.data);
          return out;
        }
        VideoKind::Other => return out,
        _ => self.conn_saw_video = true,
      },
      TAG_AUDIO => {
        if audio_is_config(&tag.data) {
          if self.file_open && !self.waiting_key && self.file_audio_config.as_ref() != Some(&tag.data) {
            self.waiting_key = true;
          }
          self.conn_audio_config = Some(tag.data);
          return out;
        }
      }
      _ => return out,
    }

    let is_key = tag.kind == TAG_VIDEO && video_kind(&tag.data) == VideoKind::Keyframe;

    if self.waiting_key {
      let audio_only_start = tag.kind == TAG_AUDIO && !self.conn_saw_video && self.conn_video_config.is_none() && {
        self.conn_audio_waiting += 1;
        self.conn_audio_waiting >= AUDIO_ONLY_AFTER
      };
      if !is_key && !audio_only_start {
        // 映像の切れ目が来るまでは書かない（頭の部分だけのファイルや、乱れた映像を作らない）
        return out;
      }
      let same_format = self.file_open
        && self.file_video_config == self.conn_video_config
        && (self.conn_audio_config.is_none() || self.file_audio_config == self.conn_audio_config);
      if same_format {
        // 同じファイルの続きに書く
        self.offset = self.last_out_ts + SEAM_MS;
        self.seams += 1;
      } else {
        out.push(Action::NewFile {
          meta: self.conn_meta.clone(),
          video_config: self.conn_video_config.clone(),
          audio_config: self.conn_audio_config.clone(),
        });
        self.file_open = true;
        self.file_video_config = self.conn_video_config.clone();
        self.file_audio_config = self.conn_audio_config.clone();
        self.offset = 0;
        self.last_out_ts = 0;
        self.seams = 0;
      }
      self.base_in = tag.ts;
      self.last_in_ts = tag.ts;
      self.waiting_key = false;
    } else if tag.ts > self.last_in_ts.saturating_add(JUMP_FORWARD_MS) || tag.ts.saturating_add(JUMP_BACK_MS) < self.last_in_ts {
      // 同じ接続の中で時刻が大きく飛んだ（配信ソフトの再起動など）：続きの時刻に振り直す
      self.offset = self.last_out_ts + SEAM_MS;
      self.base_in = tag.ts;
    }
    self.last_in_ts = tag.ts;
    let ts = self.offset + tag.ts.saturating_sub(self.base_in);
    self.last_out_ts = self.last_out_ts.max(ts);
    out.push(Action::Write { tag: Tag { kind: tag.kind, ts, data: tag.data }, keyframe: is_key });
    out
  }
}

// ---------------------------------------------------------------------------
// AMF0（FLV の情報タグの書き方）

/// 情報タグの名前（"onMetaData" など）を読む
pub fn script_name(data: &[u8]) -> Option<String> {
  if data.len() < 3 || data[0] != 0x02 {
    return None;
  }
  let n = u16::from_be_bytes([data[1], data[2]]) as usize;
  data.get(3..3 + n).map(|s| String::from_utf8_lossy(s).into_owned())
}

/// AMF0 の値1つ分の長さを調べる（中身は読まない）
fn amf_value_len(d: &[u8], depth: u32) -> Option<usize> {
  if depth > 16 {
    return None;
  }
  let t = *d.first()?;
  let body = &d[1..];
  let n = match t {
    0x00 => 8,                                               // 数
    0x01 => 1,                                               // 真偽
    0x02 => 2 + u16::from_be_bytes([*body.first()?, *body.get(1)?]) as usize, // 文字列
    0x05 | 0x06 => 0,                                        // null / undefined
    0x03 => amf_props_len(body, depth)?,                     // オブジェクト
    0x08 => 4 + amf_props_len(body.get(4..)?, depth)?,       // 連想配列
    0x0a => {
      // 配列
      let count = u32::from_be_bytes(body.get(0..4)?.try_into().ok()?) as usize;
      let mut p = 4;
      for _ in 0..count {
        p += amf_value_len(body.get(p..)?, depth + 1)?;
      }
      p
    }
    0x0b => 10,                                              // 日付
    0x0c => 4 + u32::from_be_bytes(body.get(0..4)?.try_into().ok()?) as usize, // 長い文字列
    _ => return None,
  };
  if body.len() < n {
    return None;
  }
  Some(1 + n)
}

/// 「名前と値」の並び（最後は 00 00 09）の長さ
fn amf_props_len(d: &[u8], depth: u32) -> Option<usize> {
  let mut p = 0;
  loop {
    let klen = u16::from_be_bytes([*d.get(p)?, *d.get(p + 1)?]) as usize;
    if klen == 0 && *d.get(p + 2)? == 0x09 {
      return Some(p + 3);
    }
    p += 2 + klen;
    p += amf_value_len(d.get(p..)?, depth + 1)?;
  }
}

/// onMetaData の中身を「名前と、値のバイト列」の並びにする
fn meta_props(data: &[u8]) -> Vec<(String, Vec<u8>)> {
  let mut out = Vec::new();
  let Some(name_len) = amf_value_len(data, 0) else { return out };
  let d = &data[name_len..];
  let mut p = match d.first() {
    Some(0x08) => 5,
    Some(0x03) => 1,
    _ => return out,
  };
  while p + 2 <= d.len() {
    let klen = u16::from_be_bytes([d[p], d[p + 1]]) as usize;
    if klen == 0 {
      break;
    }
    let Some(key) = d.get(p + 2..p + 2 + klen) else { break };
    let key = String::from_utf8_lossy(key).into_owned();
    p += 2 + klen;
    let Some(vlen) = amf_value_len(&d[p..], 1) else { break };
    out.push((key, d[p..p + vlen].to_vec()));
    p += vlen;
  }
  out
}

fn put_key(out: &mut Vec<u8>, k: &str) {
  out.extend_from_slice(&(k.len() as u16).to_be_bytes());
  out.extend_from_slice(k.as_bytes());
}
fn put_num(out: &mut Vec<u8>, v: f64) {
  out.push(0x00);
  out.extend_from_slice(&v.to_be_bytes());
}
fn put_num_array(out: &mut Vec<u8>, vs: &[f64]) {
  out.push(0x0a);
  out.extend_from_slice(&(vs.len() as u32).to_be_bytes());
  for &v in vs {
    put_num(out, v);
  }
}

/// 映像の切れ目の位置（早送り用の目印）
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Keyframe {
  pub pos: u64,
  pub ms: u32,
}

/// ファイルの先頭に置く情報タグ（onMetaData）の大きさ。
/// 録画中は増えていく「早送り用の目印」をあとで書き込めるよう、決まった大きさで空きを取っておく。
/// 空きは情報の終わりの後ろを 0 で埋める（読む側は終わりの印から先を読まない）。
/// 文字列で埋めると、ffmpeg などが長い文字列を読めずに警告を出すため。
pub const SCRIPT_RESERVE: usize = 96 * 1024;

/// 情報タグの中身を作る。必ず SCRIPT_RESERVE の大きさにする。
/// 目印が入りきらないときは、間引いて入れる。
pub fn build_script(src_meta: Option<&[u8]>, duration_ms: u32, file_size: u64, keyframes: &[Keyframe]) -> Vec<u8> {
  let props: Vec<(String, Vec<u8>)> = src_meta
    .map(meta_props)
    .unwrap_or_default()
    .into_iter()
    .filter(|(k, _)| !matches!(k.as_str(), "duration" | "filesize" | "fileSize" | "keyframes"))
    .collect();
  let mut step = 1;
  loop {
    let kf: Vec<&Keyframe> = keyframes.iter().step_by(step).collect();
    let mut out = Vec::with_capacity(SCRIPT_RESERVE);
    out.push(0x02);
    put_key(&mut out, "onMetaData");
    out.push(0x08);
    out.extend_from_slice(&((props.len() + 4) as u32).to_be_bytes());
    put_key(&mut out, "duration");
    put_num(&mut out, duration_ms as f64 / 1000.0);
    put_key(&mut out, "filesize");
    put_num(&mut out, file_size as f64);
    for (k, v) in &props {
      put_key(&mut out, k);
      out.extend_from_slice(v);
    }
    put_key(&mut out, "keyframes");
    out.push(0x03);
    put_key(&mut out, "filepositions");
    put_num_array(&mut out, &kf.iter().map(|k| k.pos as f64).collect::<Vec<_>>());
    put_key(&mut out, "times");
    put_num_array(&mut out, &kf.iter().map(|k| k.ms as f64 / 1000.0).collect::<Vec<_>>());
    out.extend_from_slice(&[0, 0, 0x09]);
    out.extend_from_slice(&[0, 0, 0x09]);
    if out.len() <= SCRIPT_RESERVE {
      out.resize(SCRIPT_RESERVE, 0);
      return out;
    }
    if kf.is_empty() {
      // 元の情報が大きすぎる：元の情報を入れずに作り直す
      return build_script(None, duration_ms, file_size, keyframes);
    }
    step *= 2;
  }
}

/// FLV ファイルの先頭（ヘッダーと、最初の「直前のタグの大きさ」0）
pub fn file_header(has_video: bool, has_audio: bool) -> Vec<u8> {
  let flags = (if has_audio { 4 } else { 0 }) | (if has_video { 1 } else { 0 });
  vec![b'F', b'L', b'V', 1, flags, 0, 0, 0, 9, 0, 0, 0, 0]
}

/// タグ1つ分の書き込むバイト列（後ろの「このタグの大きさ」まで含む）
pub fn write_tag(kind: u8, ts: u32, data: &[u8]) -> Vec<u8> {
  let size = data.len() as u32;
  let mut out = Vec::with_capacity(11 + data.len() + 4);
  out.push(kind);
  out.extend_from_slice(&size.to_be_bytes()[1..]);
  out.extend_from_slice(&ts.to_be_bytes()[1..]);
  out.push((ts >> 24) as u8);
  out.extend_from_slice(&[0, 0, 0]);
  out.extend_from_slice(data);
  out.extend_from_slice(&(11 + size).to_be_bytes());
  out
}

/// ファイルの中で、情報タグの中身が始まる位置（ヘッダー 9 + 直前の大きさ 4 + タグの頭 11）
pub const SCRIPT_DATA_POS: u64 = 13 + 11;

/// 情報タグに書かれた長さ（ミリ秒）。書かれていなければ None
pub fn meta_duration_ms(data: &[u8]) -> Option<u32> {
  let (_, v) = meta_props(data).into_iter().find(|(k, _)| k == "duration")?;
  if v.len() != 9 || v[0] != 0x00 {
    return None;
  }
  let s = f64::from_be_bytes(v[1..9].try_into().ok()?);
  (s.is_finite() && s > 0.0).then(|| (s * 1000.0).round() as u32)
}

#[cfg(test)]
mod tests {
  use super::*;

  const AVC_CFG: [u8; 5] = [0x17, 0, 0, 0, 0xaa];
  const AVC_CFG2: [u8; 5] = [0x17, 0, 0, 0, 0xbb];
  const AAC_CFG: [u8; 3] = [0xaf, 0, 0x12];

  fn key(ts: u32) -> Tag {
    Tag { kind: TAG_VIDEO, ts, data: vec![0x17, 1, 0, 0, 0, 1] }
  }
  fn inter(ts: u32) -> Tag {
    Tag { kind: TAG_VIDEO, ts, data: vec![0x27, 1, 0, 0, 0, 2] }
  }
  fn aud(ts: u32) -> Tag {
    Tag { kind: TAG_AUDIO, ts, data: vec![0xaf, 1, 9] }
  }
  fn vcfg(d: &[u8]) -> Tag {
    Tag { kind: TAG_VIDEO, ts: 0, data: d.to_vec() }
  }
  fn acfg() -> Tag {
    Tag { kind: TAG_AUDIO, ts: 0, data: AAC_CFG.to_vec() }
  }
  fn meta() -> Tag {
    let mut d = vec![0x02];
    put_key(&mut d, "onMetaData");
    d.push(0x08);
    d.extend_from_slice(&3u32.to_be_bytes());
    put_key(&mut d, "duration");
    put_num(&mut d, 0.0);
    put_key(&mut d, "width");
    put_num(&mut d, 1280.0);
    put_key(&mut d, "encoder");
    d.push(0x02);
    put_key(&mut d, "obs-output module");
    d.extend_from_slice(&[0, 0, 9]);
    Tag { kind: TAG_SCRIPT, ts: 0, data: d }
  }
  /// 接続1回分：頭の部分（情報・設定）を受け取ったあと、tags を受け取る
  fn connect(s: &mut Splicer, cfg: &[u8], tags: Vec<Tag>) -> Vec<Action> {
    s.begin_connection();
    let mut out = Vec::new();
    for t in [meta(), vcfg(cfg), acfg()].into_iter().chain(tags) {
      out.extend(s.push(t));
    }
    out
  }
  fn writes(a: &[Action]) -> Vec<(u8, u32)> {
    a.iter()
      .filter_map(|x| match x {
        Action::Write { tag, .. } => Some((tag.kind, tag.ts)),
        _ => None,
      })
      .collect()
  }
  fn new_files(a: &[Action]) -> usize {
    a.iter().filter(|x| matches!(x, Action::NewFile { .. })).count()
  }

  #[test]
  fn parser_splits_tags_across_chunks() {
    let mut bytes = file_header(true, true);
    bytes.extend(write_tag(TAG_SCRIPT, 0, &meta().data));
    bytes.extend(write_tag(TAG_VIDEO, 13_397_732, &key(0).data));
    bytes.extend(write_tag(TAG_AUDIO, 0x0100_0005, &aud(0).data));
    let mut p = Parser::new();
    let mut tags = Vec::new();
    for chunk in bytes.chunks(7) {
      tags.extend(p.push(chunk).unwrap());
    }
    assert_eq!(tags.len(), 3);
    assert_eq!(tags[0].kind, TAG_SCRIPT);
    assert_eq!(tags[1].ts, 13_397_732);
    assert_eq!(tags[2].ts, 0x0100_0005, "時刻の上位8ビットも読む");
  }

  #[test]
  fn parser_rejects_non_flv() {
    assert!(Parser::new().push(b"<html>error</html>").is_err());
  }

  #[test]
  fn header_only_connection_makes_no_file() {
    // 回線が悪いとき・配信が終わった後：頭の部分だけ届いて中身が来ない
    let mut s = Splicer::new();
    for _ in 0..10 {
      let a = connect(&mut s, &AVC_CFG, vec![]);
      assert!(a.is_empty());
    }
    assert!(!s.has_file());
  }

  #[test]
  fn waits_for_keyframe_and_starts_at_zero() {
    let mut s = Splicer::new();
    // 配信開始から3時間43分たった時刻で、切れ目の前のコマから届く
    let base = 13_397_732;
    let a = connect(&mut s, &AVC_CFG, vec![inter(base), aud(base + 6), key(base + 2534), aud(base + 2540), inter(base + 2567)]);
    assert_eq!(new_files(&a), 1);
    assert_eq!(writes(&a), vec![(TAG_VIDEO, 0), (TAG_AUDIO, 6), (TAG_VIDEO, 33)]);
  }

  #[test]
  fn reconnect_continues_same_file() {
    let mut s = Splicer::new();
    let a = connect(&mut s, &AVC_CFG, vec![key(1000), inter(1033), inter(1066)]);
    assert_eq!(new_files(&a), 1);
    // 頭の部分だけで終わったつなぎ直しを2回はさむ
    connect(&mut s, &AVC_CFG, vec![]);
    connect(&mut s, &AVC_CFG, vec![inter(50_000)]);
    // 35秒後に戻ってきた
    let a = connect(&mut s, &AVC_CFG, vec![inter(90_000), key(91_000), inter(91_033)]);
    assert_eq!(new_files(&a), 0, "同じ形式なら同じファイルの続き");
    assert_eq!(writes(&a), vec![(TAG_VIDEO, 66 + 33), (TAG_VIDEO, 66 + 33 + 33)]);
    assert_eq!(s.seams, 1);
  }

  #[test]
  fn format_change_starts_new_file() {
    let mut s = Splicer::new();
    connect(&mut s, &AVC_CFG, vec![key(0), inter(33)]);
    let a = connect(&mut s, &AVC_CFG2, vec![key(5000), inter(5033)]);
    assert_eq!(new_files(&a), 1);
    assert_eq!(writes(&a), vec![(TAG_VIDEO, 0), (TAG_VIDEO, 33)]);
  }

  #[test]
  fn format_change_mid_connection_starts_new_file_at_next_keyframe() {
    let mut s = Splicer::new();
    s.begin_connection();
    for t in [vcfg(&AVC_CFG), key(0), inter(33)] {
      s.push(t);
    }
    let mut a = s.push(vcfg(&AVC_CFG2));
    a.extend(s.push(inter(66)));
    a.extend(s.push(key(100)));
    assert_eq!(new_files(&a), 1);
    assert_eq!(writes(&a), vec![(TAG_VIDEO, 0)]);
  }

  #[test]
  fn timestamp_jump_within_connection_is_closed_up() {
    let mut s = Splicer::new();
    let a = connect(&mut s, &AVC_CFG, vec![key(500_000), inter(500_033), key(10), inter(43)]);
    assert_eq!(writes(&a), vec![(TAG_VIDEO, 0), (TAG_VIDEO, 33), (TAG_VIDEO, 66), (TAG_VIDEO, 99)]);
  }

  #[test]
  fn audio_only_stream_starts_without_video() {
    let mut s = Splicer::new();
    s.begin_connection();
    s.push(acfg());
    let mut a = Vec::new();
    for i in 0..(AUDIO_ONLY_AFTER + 2) {
      a.extend(s.push(aud(7000 + i * 21)));
    }
    assert_eq!(new_files(&a), 1);
    assert_eq!(writes(&a).len(), 3);
    assert_eq!(writes(&a)[0], (TAG_AUDIO, 0));
  }

  #[test]
  fn video_kind_handles_enhanced_header() {
    assert_eq!(video_kind(&[0x90, b'h', b'v', b'c', b'1']), VideoKind::Config);
    assert_eq!(video_kind(&[0x91, b'h', b'v', b'c', b'1']), VideoKind::Keyframe);
    assert_eq!(video_kind(&[0xa3, b'h', b'v', b'c', b'1']), VideoKind::Frame);
    assert_eq!(video_kind(&AVC_CFG), VideoKind::Config);
  }

  #[test]
  fn script_keeps_source_props_and_fixed_size() {
    let src = meta().data;
    let kf = vec![Keyframe { pos: 98_000, ms: 0 }, Keyframe { pos: 700_000, ms: 2000 }];
    let s = build_script(Some(&src), 125_000, 1_800_000_000, &kf);
    assert_eq!(s.len(), SCRIPT_RESERVE);
    assert_eq!(script_name(&s).as_deref(), Some("onMetaData"));
    let props = meta_props(&s);
    let keys: Vec<&str> = props.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(keys, vec!["duration", "filesize", "width", "encoder", "keyframes"]);
    assert_eq!(meta_duration_ms(&s), Some(125_000));
    assert_eq!(meta_duration_ms(&build_script(None, 0, 0, &[])), None);
  }

  #[test]
  fn script_thins_keyframes_when_too_many() {
    // 2秒ごとの切れ目で約28時間分
    let kf: Vec<Keyframe> = (0..50_000).map(|i| Keyframe { pos: i * 600_000, ms: i as u32 * 2000 }).collect();
    let s = build_script(None, 100_000_000, 1, &kf);
    assert_eq!(s.len(), SCRIPT_RESERVE);
    assert!(meta_props(&s).iter().any(|(k, _)| k == "keyframes"));
  }
}
