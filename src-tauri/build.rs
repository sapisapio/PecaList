fn main() {
  println!("cargo:rerun-if-changed=icons/icon.ico");
  println!("cargo:rerun-if-changed=p2p-runtime.zip");
  println!("cargo:rerun-if-changed=p2p-runtime-id.txt");
  tauri_build::build()
}
