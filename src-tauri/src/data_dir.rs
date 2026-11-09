// PecaList — GPL-3.0-or-later
//
// 設定の置き場所。ペカレコと同じく、exe と同じフォルダーに直接置く
// （settings.json・filters.json など。P2P は p2p-data、画面の一時データは webview フォルダー）。
// 0.2.14 までは %APPDATA%\jp.sapisapio.pecalist（その前は jp.sapisapio.peercastnexus）に置いていた。
// そこに設定があれば初回に写し、写し終えたら古いフォルダーを消す（名前の入ったフォルダーを残さない）。
use std::{ffi::OsString, fs, path::{Path, PathBuf}};

pub struct DataDir(pub PathBuf);

/// 画面（WebView2）の一時データを置くフォルダー
pub fn webview_dir(data: &Path) -> PathBuf { data.join("webview") }

/// 0.2.14 までの置き場所
pub struct OldDirs {
  /// 設定が入っている（新しい順）
  pub settings: Vec<PathBuf>,
  /// 画面の一時データだけ（写さずに消す）
  pub cache: Vec<PathBuf>,
}

impl OldDirs {
  pub fn from_env() -> Self {
    let under = |var: &str| -> Vec<PathBuf> {
      std::env::var_os(var).map(PathBuf::from).into_iter()
        .flat_map(|base| ["jp.sapisapio.pecalist", "jp.sapisapio.peercastnexus"].map(|id| base.join(id)))
        .collect()
    };
    OldDirs { settings: under("APPDATA"), cache: under("LOCALAPPDATA") }
  }
}

pub fn prepare(exe: &Path, override_dir: Option<OsString>, old: &OldDirs) -> Result<PathBuf, String> {
  // 試すとき（PECALIST_DATA_DIR）は、いつもの設定を写しも消しもしない
  if let Some(value) = override_dir.filter(|v| !v.is_empty()) {
    let dir = PathBuf::from(value);
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    return Ok(dir);
  }
  let dir = exe.parent().ok_or("exeの場所が分かりません")?.to_path_buf();
  check_writable(&dir).map_err(|e| format!("{} に書き込めません: {e}", dir.display()))?;
  if !dir.join("settings.json").exists() {
    if let Some(src) = old.settings.iter().find(|d| d.join("settings.json").is_file() || d.join("filters.json").is_file()) {
      migrate(src, &dir).map_err(|e| format!("前の設定（{}）を写せませんでした: {e}", src.display()))?;
      // 写し終えたので、名前の入った古いフォルダーを消す。動いている古い PecaList が使っていて消せなければ、そのまま
      for d in old.settings.iter().chain(&old.cache) { let _ = fs::remove_dir_all(d); }
    }
  }
  Ok(dir)
}

fn check_writable(dir: &Path) -> std::io::Result<()> {
  let probe = dir.join(format!(".pecalist-write-test-{}", std::process::id()));
  fs::write(&probe, b"")?;
  fs::remove_file(probe)
}

/// 設定（.json と .json.bak）と P2P の鍵などを写す。
/// いったん別の名前で全部写し、そろってから本当の名前に変える（settings.json を最後に）。
/// 途中で失敗したら写しかけを消すので、次の起動でもう一度写す。
fn migrate(src: &Path, dest: &Path) -> std::io::Result<()> {
  // 動いている古い PecaList の P2P の鍵・更新番号を、書きかけのまま写さない
  let _lock = if src.join("p2p-data/running.lock").exists() {
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true);
    #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.share_mode(0); }
    Some(options.open(src.join("p2p-data/running.lock")).map_err(|e|
      std::io::Error::new(e.kind(), format!("前の PecaList が動いています。閉じてから起動してください（{e}）")))?)
  } else { None };
  let mut staged: Vec<(PathBuf, PathBuf)> = Vec::new();
  let result = (|| {
    stage_json(src, dest, &mut staged)?;
    if src.join("p2p-data").is_dir() {
      fs::create_dir_all(dest.join("p2p-data"))?;
      stage_json(&src.join("p2p-data"), &dest.join("p2p-data"), &mut staged)?;
    }
    staged.sort_by_key(|(_, to)| to.file_name().map_or(false, |n| n == "settings.json"));
    for (tmp, to) in &staged { fs::rename(tmp, to)?; }
    Ok(())
  })();
  if result.is_err() { for (tmp, _) in &staged { let _ = fs::remove_file(tmp); } }
  result
}

fn stage_json(src: &Path, dest: &Path, staged: &mut Vec<(PathBuf, PathBuf)>) -> std::io::Result<()> {
  for entry in fs::read_dir(src)? {
    let entry = entry?;
    if !entry.file_type()?.is_file() { continue; }
    let name = entry.file_name();
    let text = name.to_string_lossy();
    if text.ends_with(".json") || text.ends_with(".json.bak") {
      let tmp = dest.join(format!(".{text}.migrating"));
      fs::copy(entry.path(), &tmp)?;
      staged.push((tmp, dest.join(&name)));
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicUsize, Ordering};
  static NEXT: AtomicUsize = AtomicUsize::new(0);
  struct Temp(PathBuf);
  impl Temp {
    fn new() -> Self {
      let p = std::env::temp_dir().join(format!("pecalist-datadir-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
      fs::create_dir_all(&p).unwrap(); Self(p)
    }
  }
  impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

  fn layout(t: &Temp) -> (PathBuf, OldDirs) {
    let app = t.0.join("app"); fs::create_dir_all(&app).unwrap();
    let roaming = t.0.join("Roaming"); let local = t.0.join("Local");
    let old = OldDirs {
      settings: vec![roaming.join("jp.sapisapio.pecalist"), roaming.join("jp.sapisapio.peercastnexus")],
      cache: vec![local.join("jp.sapisapio.pecalist"), local.join("jp.sapisapio.peercastnexus")],
    };
    (app.join("PecaList.exe"), old)
  }

  #[test]
  fn copies_next_to_exe_then_removes_named_folders() {
    let t = Temp::new(); let (exe, old) = layout(&t);
    let src = &old.settings[0];
    fs::create_dir_all(src.join("p2p-data")).unwrap();
    fs::create_dir_all(old.cache[0].join("EBWebView")).unwrap();
    fs::create_dir_all(&old.settings[1]).unwrap();
    for (name, value) in [("settings.json", "settings"), ("filters.json", "filters"), ("settings.json.bak", "backup"),
      ("p2p-data/identity.json", "key"), ("ignore.exe", "skip")] {
      fs::write(src.join(name), value).unwrap();
    }
    let dir = prepare(&exe, None, &old).unwrap();
    assert_eq!(dir, exe.parent().unwrap());
    assert_eq!(fs::read_to_string(dir.join("settings.json")).unwrap(), "settings");
    assert_eq!(fs::read_to_string(dir.join("p2p-data/identity.json")).unwrap(), "key");
    assert!(dir.join("filters.json").exists() && dir.join("settings.json.bak").exists());
    assert!(!dir.join("ignore.exe").exists());
    assert!(fs::read_dir(&dir).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".migrating")));
    for d in old.settings.iter().chain(&old.cache) { assert!(!d.exists(), "{} が残っている", d.display()); }
    // 2回目は写さない（exe の横の設定をそのまま使う）
    fs::write(dir.join("settings.json"), "changed").unwrap();
    prepare(&exe, None, &old).unwrap();
    assert_eq!(fs::read_to_string(dir.join("settings.json")).unwrap(), "changed");
  }

  #[test]
  fn falls_back_to_the_oldest_name() {
    let t = Temp::new(); let (exe, old) = layout(&t);
    fs::create_dir_all(&old.settings[1]).unwrap();
    fs::write(old.settings[1].join("settings.json"), "legacy").unwrap();
    let dir = prepare(&exe, None, &old).unwrap();
    assert_eq!(fs::read_to_string(dir.join("settings.json")).unwrap(), "legacy");
    assert!(!old.settings[1].exists());
  }

  #[test]
  fn fresh_start_without_old_settings() {
    let t = Temp::new(); let (exe, old) = layout(&t);
    fs::create_dir_all(old.cache[0].join("EBWebView")).unwrap();
    let dir = prepare(&exe, None, &old).unwrap();
    assert!(!dir.join("settings.json").exists());
    assert!(old.cache[0].exists(), "写していないときは何も消さない");
  }

  #[test]
  fn test_folder_never_touches_user_settings() {
    let t = Temp::new(); let (exe, old) = layout(&t);
    fs::create_dir_all(&old.settings[0]).unwrap();
    fs::write(old.settings[0].join("settings.json"), "user").unwrap();
    let isolated = t.0.join("isolated");
    assert_eq!(prepare(&exe, Some(isolated.clone().into_os_string()), &old).unwrap(), isolated);
    assert!(!isolated.join("settings.json").exists());
    assert!(old.settings[0].join("settings.json").exists());
  }

  #[cfg(windows)]
  #[test]
  fn running_old_p2p_stops_migration_and_retry_succeeds() {
    use std::os::windows::fs::OpenOptionsExt;
    let t = Temp::new(); let (exe, old) = layout(&t);
    let src = &old.settings[0];
    fs::create_dir_all(src.join("p2p-data")).unwrap();
    fs::write(src.join("settings.json"), "settings").unwrap();
    let lock = fs::OpenOptions::new().read(true).write(true).create(true).share_mode(0).open(src.join("p2p-data/running.lock")).unwrap();
    assert!(prepare(&exe, None, &old).is_err());
    assert!(!exe.parent().unwrap().join("settings.json").exists());
    assert!(src.join("settings.json").exists(), "失敗したら古い設定は消さない");
    drop(lock);
    assert!(prepare(&exe, None, &old).unwrap().join("settings.json").exists());
    assert!(!src.exists());
  }
}
