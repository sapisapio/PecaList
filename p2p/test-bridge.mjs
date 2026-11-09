// Local end-to-end bridge test. No DHT traffic or real broadcasts.
import assert from 'node:assert/strict';
import {newIdentity,signedRecord} from './catalog.mjs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createInterface} from 'node:readline';
const root=path.dirname(fileURLToPath(import.meta.url)),dir=await mkdtemp(path.join(os.tmpdir(),'pecalist-bridge-'));
const id='A'.repeat(32);let ended=false,changed=false,indexFailed=false;
const raw=()=>({channelId:id,status:{isBroadcasting:true,isReceiving:true,status:ended?'Idle':'Receiving',source:'rtmp://PRIVATE/SECRET',totalDirects:8,totalRelays:1},info:{name:'橋渡し試験',desc:changed?'変更':'詳細',contentType:'FLV',bitrate:1000},track:{name:'曲',album:'アルバム'},yellowPages:[]});
const server=createServer((req,res)=>{if(req.url!=='/api/1'&&indexFailed){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','application/json');res.end(req.url==='/api/1'?JSON.stringify({result:[raw()]}):`名前<>${id}<>8.8.8.8:7144`)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let child,next=0,latest={},output='',pending=new Map();
async function boot(){latest={};child=spawn(process.execPath,[path.join(root,'bridge.mjs'),dir],{env:{...process.env,PECALIST_P2P_LOCAL_ONLY:'1'},stdio:['pipe','pipe','pipe'],windowsHide:true});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('ready timeout')),8000);createInterface({input:child.stdout}).on('line',line=>{output+=line;const m=JSON.parse(line);if(m.type==='ready'){clearTimeout(timer);resolve()}if(m.type==='state')latest=m.data;if(m.type==='response'){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.data)}}});child.once('error',reject)});}
function request(method,extra={}){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,...extra})+'\n')});}
async function wait(check){const end=Date.now()+8000;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,30))}throw new Error('state timeout')}
async function close(){const c=child;const done=new Promise(r=>c.once('exit',r));await request('shutdown');await done;}
const guard=setTimeout(()=>{child?.kill();process.exit(1)},40000);guard.unref();
try{
 await boot();await request('configure',{peercast:`127.0.0.1:${server.address().port}`});await wait(()=>latest.local?.items.length===1);assert.equal(latest.rows.length,0);
 await request('start',{channelId:id});await wait(()=>latest.rows?.length===1);const key=latest.nodeId,seq=latest.rows[0].seq;assert.equal(latest.rows[0].track.album,'アルバム');
 changed=true;await wait(()=>latest.rows[0]?.detail==='変更');ended=true;indexFailed=true;await wait(()=>latest.rows?.length===0);assert.equal(latest.local.selected,null);await close();
 ended=false;indexFailed=false;const foreign=newIdentity(),foreignId='B'.repeat(32);const record=signedRecord(foreign,{channelId:foreignId,session:'b'.repeat(32),seq:1,body:{name:'他者',detail:'',listeners:0,type:'DEMO'}});await import('node:fs/promises').then(fs=>fs.writeFile(path.join(dir,'received.json'),JSON.stringify([record])));
 await boot();await request('configure',{peercast:`127.0.0.1:${server.address().port}`,blocked:Array(512).fill(foreign.publisher)});await wait(()=>latest.local?.items.length===1);assert(!latest.rows.some(r=>r.channelId===foreignId),'起動時にブロックを適用し復元キャッシュからも除外');await request('start',{channelId:id});await wait(()=>latest.rows?.length===1);assert.equal(latest.nodeId,key);assert(latest.rows[0].seq>seq,'restart sequence must increase');
 await close();assert(!output.includes('PRIVATE'));assert(!output.includes('BEGIN PRIVATE KEY'));
 const received=await readFile(path.join(dir,'received.json'),'utf8');assert(!received.includes('PRIVATE'));console.log('PASS bridge explicit publication, metadata update, automatic source end, persistent key/sequence, no secret source in output/cache');
}finally{clearTimeout(guard);child?.kill();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})}
