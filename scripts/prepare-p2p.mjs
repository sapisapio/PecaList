// Build a private runtime archive embedded in the portable exe.
import {mkdirSync,copyFileSync,readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const p2p=path.join(root,'p2p');
if(!existsSync(path.join(p2p,'node_modules/hyperswarm'))){const r=spawnSync('npm.cmd',['ci','--prefix',p2p],{stdio:'inherit',shell:true});if(r.status!==0)process.exit(1);}
copyFileSync(process.execPath,path.join(p2p,'node.exe'));
// Node distribution license supplied by the official installation or build environment.
const possible=[path.join(path.dirname(process.execPath),'LICENSE'),path.join(path.dirname(process.execPath),'LICENSE.txt'),path.join(root,'p2p/NODE-LICENSE.txt')];
const license=possible.find(p=>existsSync(p));if(!license)throw new Error('Node.js license required');if(license!==path.join(p2p,'NODE-LICENSE.txt'))copyFileSync(license,path.join(p2p,'NODE-LICENSE.txt'));
const zip=path.join(root,'src-tauri/p2p-runtime.zip');
const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Compress-Archive -Path ($env:PECALIST_PACK_SOURCE+'\\*') -DestinationPath $env:PECALIST_PACK_ZIP -Force"],{env:{...process.env,PECALIST_PACK_SOURCE:p2p,PECALIST_PACK_ZIP:zip},stdio:'inherit',windowsHide:true});if(r.status!==0)process.exit(1);
// 識別は zip そのものではなく、入れたファイルの名前と中身から作る（zip には日時が入り、毎回変わるため）。
// 中身が同じなら同じ識別になり、利用者の PC で部品を展開し直さずに済む
const hasher=createHash('sha256');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).sort((x,y)=>x.name<y.name?-1:x.name>y.name?1:0).forEach(e=>{const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(e.isFile()){hasher.update(path.relative(p2p,f).split(path.sep).join('/')+'\0');hasher.update(readFileSync(f));hasher.update('\0');}});
walk(p2p);
const hash=hasher.digest('hex');writeFileSync(path.join(root,'src-tauri/p2p-runtime-id.txt'),hash+'\n');console.log('P2P runtime packed '+hash.slice(0,12));
