//! 同じ設定フォルダーの PecaList を2つ動かさない。
//! 2つ目を起動したら、1つ目に「窓を出して」と知らせて、2つ目はすぐ終わる。
//! 知らせ方は Windows の名前付きイベント。名前には設定フォルダーの場所を入れるので、
//! 別のフォルダーに置いた PecaList（試し用の設定など）は別のものとして動く。

use std::path::Path;
use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
use windows_sys::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject, INFINITE};
use windows_sys::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};

/// 設定フォルダーの場所から、イベントの名前を作る（版が違う PecaList どうしでも同じ名前になるよう、決まった計算で）
fn event_name(dir: &Path) -> Vec<u16> {
  let mut h: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a
  for b in dir.to_string_lossy().to_lowercase().bytes() {
    h ^= b as u64;
    h = h.wrapping_mul(0x0000_0100_0000_01b3);
  }
  format!("Local\\PecaList-show-{h:016x}").encode_utf16().chain(Some(0)).collect()
}

/// 1つ目なら、知らせを待つためのイベントを返す。
/// もう動いているなら、そちらに窓を出すよう知らせて None を返す（呼んだ側はそのまま終わる）
pub fn claim(dir: &Path) -> Option<isize> {
  let name = event_name(dir);
  let h = unsafe { CreateEventW(std::ptr::null(), 0, 0, name.as_ptr()) };
  if h.is_null() { return Some(0); } // 作れないときは、二重起動の確認をあきらめて普通に起動する
  if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
    unsafe {
      // 1つ目の PecaList が窓を手前に出せるようにする（Windows は、操作していないアプリが前に出るのを止めるため）
      AllowSetForegroundWindow(ASFW_ANY);
      SetEvent(h);
    }
    return None;
  }
  Some(h as isize)
}

/// 2つ目が起動されるたびに show を呼ぶ
pub fn listen(handle: isize, show: impl Fn() + Send + 'static) {
  if handle == 0 { return; }
  std::thread::spawn(move || loop {
    if unsafe { WaitForSingleObject(handle as _, INFINITE) } != 0 { break; }
    show();
  });
}
