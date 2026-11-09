// PecaList — GPL-3.0-or-later. Private stdio bridge, no HTTP listener.
import {createPrivateKey,createPublicKey} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,openSync,fsyncSync,closeSync} from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {internetNode,ShareNode} from './network.mjs';
import {LocalMonitor,localChannels} from './peercast.mjs';

const dir=process.argv[2];if(!dir)throw new Error('data directory required');mkdirSync(dir,{recursive:true});
const emit=m=>process.stdout.write(JSON.stringify(m)+'\n');
const node=process.env.PECALIST_P2P_LOCAL_ONLY==='1'?new ShareNode():internetNode();
node.accepting=false; // ブロック設定を適用するまで相手の接続を受け入れない
const identityPath=path.join(dir,'identity.json'),catalogPath=path.join(dir,'received.json');
function atomic(file,value){const tmp=file+'.tmp',fd=openSync(tmp,'w',0o600);try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd)}finally{closeSync(fd)}renameSync(tmp,file);}
let saved;
try{saved=JSON.parse(readFileSync(identityPath,'utf8'));const key=createPrivateKey(saved.privateKey);if(!Number.isSafeInteger(saved.seq)||saved.seq<0||key.asymmetricKeyType!=='ed25519')throw new Error('invalid key');node.publisher.identity={privateKey:key,publisher:createPublicKey(key).export({type:'spki',format:'der'}).toString('base64')};node.publisher.seq=saved.seq;}
catch(e){if(e.code!=='ENOENT')throw new Error('掲載鍵を読み込めません。自動的な鍵の作り直しは行いません。');saved={privateKey:node.publisher.identity.privateKey.export({type:'pkcs8',format:'pem'}),seq:0};atomic(identityPath,saved);}
node.publisher.beforeSign=seq=>{saved.seq=seq;atomic(identityPath,saved);};
// The public publisher id must match the persisted key.
const {shortId,publisherKeyValid}=await import('./catalog.mjs');node.id=shortId(node.publisher.identity.publisher);node.catalog.ownPublisher=node.publisher.identity.publisher;
try{const records=JSON.parse(readFileSync(catalogPath,'utf8'));if(Array.isArray(records)&&records.length<=256)for(const record of records)node.catalog.accept(record,{historical:true});}catch{}
let base='http://127.0.0.1:7144',closing=false,dirty=false,events=[],discoveryStarted=false;
const monitor=new LocalMonitor(node,{load:()=>localChannels(base)});
node.on('log',e=>{events.push({time:Date.now(),...e});events=events.slice(-40);dirty=true;});
function state(){return {...node.view(),local:monitor.view(),events};}
function flush(){if(dirty){atomic(catalogPath,node.catalog.checkpoint());dirty=false;}}
const timer=setInterval(()=>{try{flush();emit({type:'state',data:state()})}catch{emit({type:'error',error:'P2P状態を保存できません。掲載を停止します。'});quit()}},1000);
async function quit(){if(closing)return;closing=true;clearInterval(timer);monitor.close();try{await node.close();flush()}finally{process.exit(0)}}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});let queue=Promise.resolve();
input.on('line',line=>{if(line.length>65536){quit();return;}queue=queue.then(async()=>{
 let m;try{m=JSON.parse(line);if(!Number.isSafeInteger(m.id))throw new Error('invalid command');
  if(m.method==='configure'){
    const u=new URL('http://'+m.peercast);if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||!u.hostname)throw new Error('ペカステの接続先が正しくありません');
    const blocked=m.blocked||[];if(!Array.isArray(blocked)||blocked.length>512||!blocked.every(publisherKeyValid))throw new Error('掲載者ブロックの設定が正しくありません');
    node.setBlocked(blocked);
    monitor.hideListeners=m.hideListeners===true;
    node.accepting=true;
    if(!discoveryStarted&&process.env.PECALIST_P2P_LOCAL_ONLY!=='1'){discoveryStarted=true;node.startDiscovery();}
    if(monitor.selected&&u.origin!==base)monitor.stop('ペカステ接続先の変更');base=u.origin;await monitor.poll();
  }else if(m.method==='start'){await monitor.start(m.channelId)}
  else if(m.method==='stop'){monitor.stop('利用者が掲載終了')}
  else if(m.method==='shutdown'){emit({type:'response',id:m.id,data:{ok:true}});await quit();return;}
  else throw new Error('unknown command');
  emit({type:'state',data:state()});emit({type:'response',id:m.id,data:{ok:true}});
 }catch(e){emit({type:'response',id:m?.id,error:e.message?.slice(0,256)||'P2P操作に失敗しました'})}
}).catch(()=>quit());});
input.on('close',quit);process.on('SIGINT',quit);process.on('SIGTERM',quit);
emit({type:'ready'});
