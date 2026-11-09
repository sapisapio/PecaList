// PecaList — GPL-3.0-or-later
use std::{collections::HashMap, io::{BufRead, BufReader, Read, Write}, process::{Child, ChildStdin, Command, Stdio}, sync::{Arc, Mutex, mpsc}, time::{Duration, Instant}};
use serde_json::{Value,json};
#[cfg(windows)] use std::os::windows::process::CommandExt;

type Reply=Result<Value,String>;
#[derive(Default)] struct Shared { view:Value, pending:HashMap<u64,mpsc::Sender<Reply>>, ended:bool }
struct Worker { child:Child, input:ChildStdin, shared:Arc<Mutex<Shared>>, next:u64, _lock:std::fs::File }
#[derive(Default)] pub struct P2p(Mutex<Option<Worker>>);
fn hidden(c:&mut Command)->&mut Command { #[cfg(windows)] c.creation_flags(0x08000000); c }

fn runtime(app:&tauri::AppHandle)->Result<std::path::PathBuf,String>{
 let dir=super::store_path(app,"p2p")?.parent().unwrap().join("p2p-runtime").join(include_str!("../p2p-runtime-id.txt").trim());
 if dir.join("ready").exists()&&dir.join("node.exe").exists(){return Ok(dir)}
 std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 let zip=dir.join("runtime.zip");std::fs::write(&zip,include_bytes!("../p2p-runtime.zip")).map_err(|e|e.to_string())?;
 let output=hidden(Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command","$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:PECALIST_RUNTIME_ZIP -DestinationPath $env:PECALIST_RUNTIME_DEST -Force"])).env("PECALIST_RUNTIME_ZIP",&zip).env("PECALIST_RUNTIME_DEST",&dir).output().map_err(|e|format!("P2Pの初回準備に失敗しました: {e}"))?;
 if !output.status.success(){return Err("P2P実行環境を展開できませんでした。P2PをOFFにして再試行してください".into())}
 let _=std::fs::remove_file(zip);std::fs::write(dir.join("ready"),b"1").map_err(|e|e.to_string())?;Ok(dir)
}
impl Worker {
 fn start(app:&tauri::AppHandle)->Result<Self,String>{
  let data=super::store_path(app,"p2p")?.parent().unwrap().join("p2p-data");std::fs::create_dir_all(&data).map_err(|e|e.to_string())?;
  let mut options=std::fs::OpenOptions::new();options.create(true).read(true).write(true);
  #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;options.share_mode(0);}
  let lock=options.open(data.join("running.lock")).map_err(|_|"同じ設定のPecaListでP2P共有が既に起動しています".to_string())?;
  let root=runtime(app)?;
  let mut cmd=Command::new(root.join("node.exe"));cmd.arg(root.join("bridge.mjs")).arg(data).env_remove("NODE_OPTIONS").env_remove("NODE_PATH").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
  let mut child=hidden(&mut cmd).spawn().map_err(|e|format!("P2Pを起動できません: {e}"))?;
  let input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();let shared=Arc::new(Mutex::new(Shared::default()));let reader=shared.clone();let (tx,rx)=mpsc::channel();
  std::thread::spawn(move||{
   let mut ready=Some(tx);let mut input=BufReader::new(output);
   loop {let mut bytes=Vec::new();match input.by_ref().take(4194305).read_until(b'\n',&mut bytes){Ok(0)|Err(_)=>break,Ok(_)=>{}}
    if bytes.len()>4194304||!bytes.ends_with(b"\n"){break}
    if let Ok(m)=serde_json::from_slice::<Value>(&bytes){let mut s=reader.lock().unwrap();match m["type"].as_str(){
     Some("ready")=>{if let Some(t)=ready.take(){let _=t.send(());}},
     Some("state")=>s.view=m["data"].clone(),
     Some("response")=>{if let Some(id)=m["id"].as_u64(){if let Some(t)=s.pending.remove(&id){let result=if let Some(e)=m["error"].as_str(){Err(e.to_string())}else{Ok(m["data"].clone())};let _=t.send(result);}}},
     Some("error")=>s.view=json!({"error":m["error"]}), _=>{}
    }}
   }
   let mut s=reader.lock().unwrap();s.ended=true;s.view=json!({"error":"P2P通信が終了しました。OFFにして再接続してください"});s.pending.clear();
  });
  if rx.recv_timeout(Duration::from_secs(15)).is_err(){let _=child.kill();let _=child.wait();return Err("P2Pの起動に失敗しました".into())}
  Ok(Self{child,input,shared,next:0,_lock:lock})
 }
 fn request(&mut self,mut m:Value)->Reply{
  self.next+=1;let id=self.next;m["id"]=json!(id);let(tx,rx)=mpsc::channel();
  {let mut s=self.shared.lock().unwrap();if s.ended{return Err("P2P通信が終了しています".into())}s.pending.insert(id,tx);}
  let write=serde_json::to_writer(&mut self.input,&m).map_err(|e|e.to_string()).and_then(|_|self.input.write_all(b"\n").map_err(|e|e.to_string())).and_then(|_|self.input.flush().map_err(|e|e.to_string()));
  let result=match write {Err(e)=>Err(e),Ok(())=>rx.recv_timeout(Duration::from_secs(12)).map_err(|_|"P2P操作がタイムアウトしました".to_string()).and_then(|v|v)};
  self.shared.lock().unwrap().pending.remove(&id);result
 }
 fn stop(&mut self){let _=self.request(json!({"method":"shutdown"}));let end=Instant::now()+Duration::from_secs(3);while Instant::now()<end {if self.child.try_wait().ok().flatten().is_some(){return}std::thread::sleep(Duration::from_millis(30));}let _=self.child.kill();let _=self.child.wait();}
}
impl Drop for Worker {fn drop(&mut self){let _=self.child.kill();let _=self.child.wait();}}
impl P2p {pub fn shutdown(&self){if let Some(mut w)=self.0.lock().unwrap().take(){w.stop();}}}

#[tauri::command] pub fn p2p_state(state:tauri::State<'_,P2p>)->Value{
 let Ok(guard)=state.0.try_lock() else {return json!({"enabled":false,"preparing":true})};
 match guard.as_ref(){Some(w)=>{let s=w.shared.lock().unwrap();json!({"enabled":true,"data":s.view})},None=>json!({"enabled":false})}
}
#[tauri::command] pub async fn p2p_action(app:tauri::AppHandle,action:String,peercast:Option<String>,channel_id:Option<String>,blocked:Option<Vec<String>>)->Reply{
 tauri::async_runtime::spawn_blocking(move||{
  use tauri::Manager;let service=app.state::<P2p>();let mut guard=service.0.lock().unwrap();
  if action=="disable"{if let Some(mut w)=guard.take(){w.stop();}return Ok(json!({"ok":true}))}
  if action=="enable"{let blocked=blocked.unwrap_or_default();if blocked.len()>512||blocked.iter().any(|k|k.len()!=60){return Err("掲載者ブロックの設定が正しくありません".into())}if guard.is_none(){*guard=Some(Worker::start(&app)?);}return guard.as_mut().unwrap().request(json!({"method":"configure","peercast":peercast.unwrap_or_else(||"localhost:7144".into()),"blocked":blocked}));}
  if !["start","stop"].contains(&action.as_str()){return Err("P2P操作が正しくありません".into())}
  let w=guard.as_mut().ok_or("先にP2P共有をONにしてください")?;
  w.request(json!({"method":action,"channelId":channel_id}))
 }).await.map_err(|e|e.to_string())?
}
