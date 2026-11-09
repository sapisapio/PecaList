# PecaList

PeerCast のチャンネル一覧ソフトです（Windows 用）。
ペカレコ（PeCaRecorder）と同じような使い方で、YP の一覧・お気に入り・通知・録画ができます。

> 試験中の版です。不具合があれば作者に知らせてください。

## 入手

[Releases](https://github.com/sapisapio/PecaList/releases) から、どちらかをダウンロードします。

- `PecaList_x.y.z.zip`：インストール不要。展開してできた「PecaList」フォルダを好きな場所に置き、中の PecaList.exe を起動します
- `PecaList_x.y.z_x64-setup.exe`：インストーラー

一部にP2P通信を含む（初期はオフ）ので、悪意のある改造クライアントを使わないように注意してください。

## 使う前に

- PeerCastStation（ペカステ）を入れて、起動しておいてください（PecaList はペカステを改造しません）
- 再生には、今使っているプレイヤー（PCRPlayer など）を設定で登録します
- ペカレコを使っていた人は、設定の「ペカレコから引っ越す」で、設定・フィルタ・プレイヤーの場所を取り込めます

## 設定の置き場所

設定（settings.json など）は、**PecaList.exe と同じフォルダ**に保存します。

- 新しい版にするときは、新しい zip の PecaList.exe で、**今の PecaList フォルダの PecaList.exe を上書き**してください。別のフォルダに置くと、設定は引き継がれません
- PecaList 専用のフォルダに置いてください（ほかのアプリの settings.json と混ざらないように）
- 0.2.14 までの版の設定（%APPDATA% の中）は、初めて起動したときに自動で写します

## P2P配信

YP を通さず、PecaList を使う人どうしで掲載情報を共有する機能です。初めはオフです。
仕組み：Hyperswarm（HyperDHT）で利用者どうしが直接つながり、署名付きの掲載情報（YP の一覧の1行に相当）だけをやりとりします。中心となるサーバーはなく、映像は今までどおりペカステを使って流れます。

## ソースから作る

Node.js、Rust、Visual Studio Build Tools（C++ によるデスクトップ開発）が必要です。

```
npm ci
npm run prepare:p2p
npx tauri build
```

テスト：`npm test`、`cd src-tauri && cargo test`

## ライセンス

GPL-3.0-or-later（[LICENSE](LICENSE)）。
P2P に使う Node.js と部品のライセンスは `p2p/NODE-LICENSE.txt` にあります。

AI頼りで至らぬ点が多いと思うので、有能な方の改修お待ちしております（許可や報告などは不要です）。
