// Copyright (C) 2026 sapisapio — SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import {once} from 'node:events';
import DHT from 'hyperdht';
import Hyperswarm from 'hyperswarm';
import createTestnet from 'hyperdht/testnet.js';
import {Catalog,Publisher,newIdentity,signedRecord,TTL} from './catalog.mjs';
import {ShareNode,frames} from './network.mjs';
import {LocalMonitor,candidates} from './peercast.mjs';

let wall=1700000000000,mono=0;const identity=newIdentity(),other=newIdentity(),cid='A'.repeat(32),session='a'.repeat(32);
const record=(seq,kind='upsert',extra={})=>signedRecord(identity,{channelId:cid,session,seq,kind,body:kind==='stop'?null:{name:'試験',detail:'日本語のテスト',listeners:1,type:'DEMO'},now:wall,...extra});
let catalog=new Catalog({wall:()=>wall,mono:()=>mono});const first=record(1);assert.equal(catalog.accept(first).status,'accepted');assert.equal(catalog.rows().length,1);
const changed=structuredClone(first);changed.body.detail='改ざん';assert.equal(catalog.accept(changed).reason,'signature');
const forged=record(2,'stop');forged.publisher=other.publisher;assert.equal(catalog.accept(forged).reason,'signature');
mono+=60000;wall+=60000;assert.equal(catalog.accept(first).status,'ignored');mono+=30001;wall+=30001;assert.equal(catalog.rows().length,0,'再受信で寿命が延びない');
assert.equal(catalog.accept(record(2)).status,'accepted');assert.equal(catalog.accept(record(3,'stop')).status,'accepted');assert.equal(catalog.rows().length,0);
assert.equal(catalog.accept(record(2)).status,'ignored');assert.equal(catalog.accept(record(4)).reason,'closed session');assert.equal(catalog.accept(record(5,'upsert',{session:'b'.repeat(32)})).status,'accepted');
assert.equal(catalog.accept(record(6,'upsert',{session:'c'.repeat(32),now:wall+33000})).status,'accepted','実際に見られた33秒の時計差を許容');
assert.equal(catalog.accept(record(7,'upsert',{now:wall+61000})).reason,'timestamp');
const poison=structuredClone(first);poison.channelId={toString:{}};assert.equal(catalog.accept(poison).status,'invalid');
const messages=[];const parse=frames(m=>messages.push(m));for(const byte of Buffer.from('{"text":"日本語"}\n{"n":1}\n'))parse(Buffer.from([byte]));assert.deepEqual(messages,[{text:'日本語'},{n:1}]);assert.throws(()=>frames(()=>{})(Buffer.alloc(17000,65)));
let sends=0;const p=new Publisher(new Catalog(),()=>sends++);p.start();p.pause();p.renew();assert.equal(sends,1);p.stop();assert.equal(sends,2);
console.log('PASS signatures, forgery, sequence, terminal session, expiry/replay, clock skew, UTF-8 framing, pause');

async function until(check,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,40));}throw new Error('network test timeout');}
const watchdog=setTimeout(()=>{console.error('test watchdog timeout');process.exit(1)},60000);watchdog.unref();
const testnet=await createTestnet(3);const engines=[],sockets=[],servers=[];
try{
  const a=new ShareNode(),b=new ShareNode(),c=new ShareNode();engines.push(a,b,c);
  const da=testnet.createNode(),db=testnet.createNode(),dc=testnet.createNode();
  const sa=da.createServer(conn=>a.attach(conn)),sb=db.createServer(conn=>b.attach(conn));servers.push(sa,sb);const ka=DHT.keyPair(),kb=DHT.keyPair();await sa.listen(ka);await sb.listen(kb);
  const ab=db.connect(ka.publicKey);sockets.push(ab);await once(ab,'open');b.attach(ab);
  const bc=dc.connect(kb.publicKey);sockets.push(bc);await once(bc,'open');c.attach(bc);
  await until(()=>a.view().peers.length===1&&b.view().peers.length===2&&c.view().peers.length===1);
  a.action('start');await until(()=>c.view().rows.length===1);assert.equal(c.view().rows[0].publisher,a.id);assert.equal(a.view().peers.length,1,'AとCは直接接続しない');
  a.action('update');await until(()=>c.view().rows[0]?.detail.includes('更新 2'));
  a.action('stop');await until(()=>c.view().rows.length===0);
  a.action('start');await until(()=>c.view().rows.length===1);
  bc.destroy();await until(()=>c.view().peers.length===0);a.action('update');await until(()=>b.view().rows[0]?.detail.includes('更新 2'));
  const bc2=dc.connect(kb.publicKey);sockets.push(bc2);await once(bc2,'open');c.attach(bc2);await until(()=>c.view().rows[0]?.detail.includes('更新 2'));
  console.log('PASS three-node A-B-C forwarding, update, stop, restart session, reconnect snapshot');
  a.action('stop');await until(()=>c.view().rows.length===0);
  const liveId='C'.repeat(32);let liveItems=candidates([{channelId:liveId,status:{isBroadcasting:true,isReceiving:true,status:'Receiving',totalDirects:3,totalRelays:1},info:{name:'実配信形式の試験',desc:'本文',contentType:'FLV',bitrate:1000},track:{name:'曲',album:'アルバム',creator:'作者',url:''},yellowPages:[]}],new Map([[liveId,'8.8.8.8:7144']]));
  const monitor=new LocalMonitor(a,{load:async()=>structuredClone(liveItems)});
  try{await monitor.start(liveId);await until(()=>c.view().rows.some(r=>r.channelId===liveId));assert.equal(c.view().rows.find(r=>r.channelId===liveId).track.album,'アルバム');liveItems[0].body.comment='変更';await monitor.poll();await until(()=>c.view().rows.find(r=>r.channelId===liveId)?.comment==='変更');liveItems=[];await monitor.poll();await until(()=>c.view().rows.length===0);console.log('PASS signed live metadata A-B-C transfer, update, automatic disappearance stop');}finally{monitor.close()}
  for(const engine of engines)await engine.close();engines.length=0;
  // こちらは相手のキーをconnectに渡さず、共通トピックで自動発見させる。
  const s1=new Hyperswarm({dht:testnet.createNode(),maxPeers:4,relayThrough:null}),s2=new Hyperswarm({dht:testnet.createNode(),maxPeers:4,relayThrough:null});
  const n1=new ShareNode({swarm:s1}),n2=new ShareNode({swarm:s2});engines.push(n1,n2);n1.startDiscovery();n2.startDiscovery();
  await until(()=>n1.view().peers.length===1&&n2.view().peers.length===1,20000);
  n1.action('start');await until(()=>n2.view().rows.length===1);n1.action('stop');await until(()=>n2.view().rows.length===0);
  console.log('PASS automatic common-topic discovery and signed listing exchange on private local DHT');
  console.log('LOCAL FUNCTIONAL CHECK ONLY — separate Internet connections remain a user test.');
}finally{for(const e of engines)await e.close();for(const s of sockets)s.destroy();for(const s of servers)await s.close();await testnet.destroy();clearTimeout(watchdog)}
