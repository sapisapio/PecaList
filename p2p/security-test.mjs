import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {Budget} from './budget.mjs';import {ShareNode,frames} from './network.mjs';import {Catalog,newIdentity,signedRecord,publisherKeyValid,NETWORK} from './catalog.mjs';
class Conn extends EventEmitter{constructor(){super();this.frames=[];this.destroyed=false;this.remotePublicKey=Buffer.alloc(32,1)}write(s){this.frames.push(JSON.parse(s));return true}destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('close')}}
function peer(n){const c=new Conn();n.attach(c);c.emit('data',Buffer.from(JSON.stringify({type:'hello',v:1,network:NETWORK,time:Date.now()})+'\n'));return [c,n.peers.get(c)];}
const key=newIdentity(),cid=i=>i.toString(16).padStart(32,'0').toUpperCase();
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',alias=key.publisher.slice(0,-2)+alphabet[alphabet.indexOf(key.publisher.at(-2))+1]+'=';
assert.deepEqual(Buffer.from(alias,'base64'),Buffer.from(key.publisher,'base64'));assert(!publisherKeyValid(alias),'同じ鍵の非標準表記でブロックをすり抜けない');assert(!publisherKeyValid(key.publisher+'\n'));
const rec=(i,seq=1,kind='upsert',large=false)=>signedRecord(key,{channelId:cid(i),session:'a'.repeat(32),seq,kind,body:kind==='stop'?null:{name:'試験',detail:large?'あ'.repeat(1800):'',listeners:0,type:'DEMO'}});
let now=0;const b=new Budget(100,200,()=>now);assert(b.take(200));assert(!b.take(1));now=500;assert(b.take(50));assert(!b.take(1));now=5000;assert.equal(b.available(),200);
assert.throws(()=>frames(()=>{})(Buffer.from('\n')),'空行の連打を許可しない');
let n=new ShareNode();try{
 const [c,p]=peer(n);n.catalog.accept(rec(1));n.receive(p,{type:'sync'});assert.equal(c.frames.filter(f=>f.type==='record').length,1);
 p.lastSyncReply=-Infinity;n.receive(p,{type:'sync'});assert.equal(c.frames.filter(f=>f.type==='record').length,1,'同じ署名の全文を何度も送り直さない');
 for(let i=0;i<8;i++)n.receive(p,{type:'sync'});assert(c.destroyed,'一覧の連打を切断');
}finally{await n.close()}
n=new ShareNode();try{const[c]=peer(n);c.emit('data',Buffer.alloc(300*1024));assert(c.destroyed,'署名検証より前に大量バイトを拒否')}finally{await n.close()}
n=new ShareNode();try{const[a]=peer(n),[b]=peer(n);const input=Buffer.from('{"type":"sync"}\n');n.rx.tokens=input.length;n.rx.last=0;n.rx.now=()=>0;a.emit('data',input);assert(!a.destroyed);b.emit('data',input);assert(b.destroyed,'全接続合計の受信予算も守る')}finally{await n.close()}
n=new ShareNode();try{
 const[c,p]=peer(n);for(const budget of [p.tx,n.tx]){budget.tokens=0;budget.last=0;budget.now=()=>0;}
 n.send(p,{type:'record',record:rec(1)});n.send(p,{type:'record',record:rec(1,2,'stop')});assert.equal(p.queue.filter(q=>q.key).length,1,'送信待ちの古い掲載を終了通知へ置き換える');
 for(let i=2;i<700;i++)n.send(p,{type:'record',record:rec(i,1,'upsert',true)});
 assert(p.queuedBytes<=2560*1024);assert(n.queuedBytes<=8*1024*1024);assert(!c.destroyed,'送信混雑だけで正しい相手を切断しない');
 n.setBlocked([key.publisher]);assert.equal(p.queue.filter(q=>q.publisher===key.publisher).length,0);assert.equal(p.queuedBytes,p.queue.reduce((s,q)=>s+q.bytes,0));assert.equal(n.queuedBytes,p.queuedBytes);
 const result=n.catalog.accept(rec(1,3));assert.equal(result.reason,'blocked publisher');
 const [other]=peer(n);n.receive(p,{type:'record',record:rec(1,4)});assert(!other.frames.some(m=>m.type==='record'),'別経路から来たブロック済み掲載も他の相手に転送しない');
}finally{await n.close()}
n=new ShareNode();try{
 const[c,p]=peer(n);for(const budget of [p.newRecords,n.newRecords]){budget.last=0;budget.now=()=>0;}
 for(let i=1;i<=65;i++){const k=newIdentity(),r=signedRecord(k,{channelId:cid(i),session:'a'.repeat(32),seq:1,body:{name:'試験',detail:'',listeners:0,type:'DEMO'}});n.receive(p,{type:'record',record:r});}
 assert.equal(n.catalog.rows().length,64,'新しい掲載の大量投入に上限');assert(!c.destroyed);
}finally{await n.close()}
n=new ShareNode();try{
 for(let group=0;group<31;group++){const k=newIdentity();for(let j=0;j<8;j++)assert.equal(n.catalog.accept(signedRecord(k,{channelId:cid(group*8+j+1),session:'a'.repeat(32),seq:j+1,body:{name:'他者',detail:'',listeners:0,type:'DEMO'}})).status,'accepted');}
 assert.equal(n.catalog.rows().length,248);assert.equal(n.catalog.accept(rec(999)).reason,'capacity');n.action('start');assert(n.view().rows.some(r=>r.own),'他者の掲載で埋まっても自分の掲載枠を残す');
 const remote=n.catalog.rows().find(r=>!r.own).publisherKey;n.setBlocked([remote]);assert(!n.catalog.rows().some(r=>r.publisherKey===remote));assert(n.view().rows.some(r=>r.own));
}finally{await n.close()}
console.log('PASS byte budgets, sync flood/dedup, bounded/coalesced output, blocked forwarding purge, new listing admission, own capacity reservation');
