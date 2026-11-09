// Copyright (C) 2026 sapisapio — SPDX-License-Identifier: GPL-3.0-or-later
import DHT from 'hyperdht';
import Hyperswarm from 'hyperswarm';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {performance} from 'node:perf_hooks';
import {Catalog,Publisher,NETWORK,shortId} from './catalog.mjs';
import {Budget} from './budget.mjs';

export function frames(receive){
  const decoder=new StringDecoder('utf8');let pending='';
  return bytes=>{pending+=decoder.write(bytes);let n;while((n=pending.indexOf('\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+1);if(Buffer.byteLength(line)>16384)throw new Error('frame too large');if(!line)throw new Error('empty frame');receive(JSON.parse(line));}if(Buffer.byteLength(pending)>16384)throw new Error('frame too large');};
}

export class ShareNode extends EventEmitter {
  constructor({swarm=null,label=''}={}){
    super();this.swarm=swarm;this.label=label;this.peers=new Map();this.status='starting';this.rejections=0;this.closing=false;this.startedAt=Date.now();
    this.catalog=new Catalog({changed:e=>{this.emit('log',e);this.emit('change');}});
    this.publisher=new Publisher(this.catalog,r=>this.broadcast({type:'record',record:r}));
    this.id=shortId(this.publisher.identity.publisher);
    this.catalog.ownPublisher=this.publisher.identity.publisher;
    this.rx=new Budget(512*1024,1024*1024);this.tx=new Budget(512*1024,1024*1024);this.newRecords=new Budget(2,128);this.queuedBytes=0;this.round=0;
    this.pump=setInterval(()=>{const peers=[...this.peers.values()];if(!peers.length)return;this.round=(this.round+1)%peers.length;for(let i=0;i<peers.length;i++)this.flush(peers[(i+this.round)%peers.length]);},100);
    this.lastRenew=performance.now();this.lastSync=performance.now();
    this.timer=setInterval(()=>this.tick(),1000);
    if(swarm){swarm.on('connection',conn=>this.attach(conn));swarm.on('error',e=>{this.emit('log',{event:'network-error',message:e.code||'network error'});});}
  }
  startDiscovery(){
    if(!this.swarm)return;
    this.status='discovering';
    this.discovery=this.swarm.join(createHash('sha256').update(NETWORK).digest(),{server:true,client:true,limit:8});
    this.discovery.flushed().then(()=>{if(this.closing)return;this.status='discovering';this.emit('log',{event:'discovery-announced',publicAddressObserved:Boolean(this.swarm.dht.host),firewalled:this.swarm.dht.firewalled,randomized:this.swarm.dht.randomized});this.emit('change');}).catch(e=>{if(!this.closing){this.status='discovery-error';this.emit('log',{event:'discovery-error',code:e.code||'error'});}});
    this.emit('log',{event:'start',version:'0.3.0',upnp:false,payloadRelayConfigured:false,topic:'fixed-prototype-network'});
  }
  attach(conn){
    if(this.closing||this.accepting===false||this.peers.size>=8){conn.destroy();return;}
    const peer={conn,id:conn.remotePublicKey?shortId(conn.remotePublicKey):'local-test',ready:false,queue:[],queuedBytes:0,sent:new Map(),rx:new Budget(128*1024,256*1024),tx:new Budget(128*1024,256*1024),newRecords:new Budget(1,64),lastSyncReply:-Infinity,syncAbuse:0,blocked:false,invalid:0,tokens:300,lastToken:performance.now(),clockDeltaMs:0};
    this.peers.set(conn,peer);
    const timer=setTimeout(()=>{if(!peer.ready)conn.destroy();},15000);
    conn.on('error',()=>{});
    conn.once('close',()=>{clearTimeout(timer);this.queuedBytes-=peer.queuedBytes;peer.queuedBytes=0;peer.queue=[];this.peers.delete(conn);this.emit('log',{event:'peer-disconnected',peer:peer.id});this.emit('change');});
    conn.on('drain',()=>{peer.blocked=false;this.flush(peer)});
    const decode=frames(message=>{
      const now=performance.now();peer.tokens=Math.min(300,peer.tokens+(now-peer.lastToken)*0.03);peer.lastToken=now;
      if(--peer.tokens<0)throw new Error('rate limit');
      this.receive(peer,message);
    });
    conn.on('data',data=>{try{if(peer.rx.available()<data.length||this.rx.available()<data.length)throw new Error('byte rate');peer.rx.take(data.length);this.rx.take(data.length);decode(data)}catch{this.emit('log',{event:'peer-rejected',peer:peer.id,reason:'invalid frame/rate'});conn.destroy()}});
    this.send(peer,{type:'hello',v:1,network:NETWORK,time:Date.now()});
  }
  send(peer,message){
    if(peer.conn.destroyed)return;
    const r=message.type==='record'?message.record:null,key=r?r.publisher+'/'+r.channelId:null;
    if(r&&this.catalog.blocked.has(r.publisher))return;
    if(r&&peer.sent.get(key)===r.signature)return;
    const frame=JSON.stringify(message)+'\n',bytes=Buffer.byteLength(frame);
    if(bytes>16384)return;
    const index=key?peer.queue.findIndex(q=>q.key===key):-1,old=index>=0?peer.queue[index]:null,extra=bytes-(old?.bytes||0);
    if(peer.queuedBytes+extra>2560*1024||this.queuedBytes+extra>8*1024*1024||(!old&&peer.queue.length>=512))return;
    const q={frame,bytes,key,signature:r?.signature,publisher:r?.publisher};if(r?.kind==='stop'){if(old)peer.queue.splice(index,1);peer.queue.unshift(q);}else if(old)peer.queue[index]=q;else peer.queue.push(q);
    peer.queuedBytes+=extra;this.queuedBytes+=extra;this.flush(peer);
  }
  flush(peer){while(!peer.blocked&&peer.queue.length&&!peer.conn.destroyed){const q=peer.queue[0];if(peer.tx.available()<q.bytes||this.tx.available()<q.bytes)return;peer.tx.take(q.bytes);this.tx.take(q.bytes);peer.queue.shift();peer.queuedBytes-=q.bytes;this.queuedBytes-=q.bytes;peer.blocked=!peer.conn.write(q.frame);if(q.key){peer.sent.delete(q.key);peer.sent.set(q.key,q.signature);if(peer.sent.size>512)peer.sent.delete(peer.sent.keys().next().value);}}}
  setBlocked(keys){
    this.catalog.setBlocked(keys);
    for(const p of this.peers.values()){const keep=[];for(const q of p.queue){if(q.publisher&&this.catalog.blocked.has(q.publisher)){p.queuedBytes-=q.bytes;this.queuedBytes-=q.bytes;}else keep.push(q);}p.queue=keep;}
  }
  broadcast(message,except=null){for(const peer of this.peers.values())if(peer.ready&&peer!==except)this.send(peer,message);}
  receive(peer,m){
    if(!m||typeof m!=='object'||Array.isArray(m))throw new Error('schema');
    if(m.type==='hello'){
      if(peer.ready||m.v!==1||m.network!==NETWORK||!Number.isSafeInteger(m.time)||Object.keys(m).length!==4)throw new Error('wrong network');
      peer.ready=true;peer.clockDeltaMs=m.time-Date.now();
      this.emit('log',{event:'peer-connected',peer:peer.id,clockDeltaMs:peer.clockDeltaMs,rawTransport:peer.conn.rawStream?.constructor?.name||'unknown'});
      this.send(peer,{type:'sync'});this.emit('change');return;
    }
    if(!peer.ready)throw new Error('missing hello');
    if(m.type==='sync'&&Object.keys(m).length===1){const now=performance.now();if(now-peer.lastSyncReply<10000){if(++peer.syncAbuse>=8)peer.conn.destroy();return;}peer.lastSyncReply=now;peer.syncAbuse=0;for(const r of this.catalog.snapshot())this.send(peer,{type:'record',record:r});return;}
    if(m.type!=='record'||Object.keys(m).length!==2)throw new Error('message type');
    if(m.record?.publisher===this.publisher.identity.publisher)return;
    const result=this.catalog.accept(m.record,{admit:()=>{if(this.newRecords.available()<1||peer.newRecords.available()<1)return false;this.newRecords.take(1);peer.newRecords.take(1);return true;}});
    if(result.status==='accepted')this.broadcast({type:'record',record:result.record},peer);
    else if(result.status==='invalid'){this.rejections++;this.emit('log',{event:'record-rejected',peer:peer.id,reason:result.reason});if(++peer.invalid>=8)peer.conn.destroy();}
  }
  tick(){
    if(this.closing)return;
    this.catalog.sweep();const now=performance.now();
    if(now-this.lastRenew>=30000){this.lastRenew=now;try{this.publisher.renew();}catch(e){this.emit('log',{event:'renew-error',message:e.message});}}
    if(now-this.lastSync>=20000){this.lastSync=now;this.broadcast({type:'sync'});}
  }
  action(name){if(this.closing)throw new Error('終了処理中です');let result;switch(name){case'start':result=this.publisher.start();this.lastRenew=performance.now();break;case'update':result=this.publisher.update();break;case'stop':result=this.publisher.stop();break;case'pause':this.publisher.pause();this.emit('log',{event:'renew-paused'});break;default:throw new Error('操作が不明です');}this.emit('change');return result;}
  view(){
    const dht=this.swarm?.dht,rows=this.catalog.rows();
    return {version:'0.3.0',nodeId:this.id,status:this.status,peers:[...this.peers.values()].filter(p=>p.ready).map(p=>({id:p.id,clockDeltaMs:p.clockDeltaMs})),rows:rows.map(r=>({...r,own:r.publisherKey===this.publisher.identity.publisher})),own:{active:this.publisher.active,paused:this.publisher.paused},rejections:this.rejections,network:{publicAddressObserved:Boolean(dht?.host),firewalled:dht?.firewalled??null,randomized:dht?.randomized??null,upnp:false,payloadRelayConfigured:false},limits:{renewSeconds:30,expirySeconds:90,clockToleranceSeconds:60}};
  }
  async close(){
    if(this.closing)return;this.closing=true;clearInterval(this.timer);
    try{this.publisher.stop();await new Promise(r=>setTimeout(r,500));}catch{}
    clearInterval(this.pump);
    for(const p of this.peers.values())p.conn.destroy();
    if(this.swarm){const stop=this.swarm.destroy();await Promise.race([stop,new Promise(r=>{const t=setTimeout(r,2000);t.unref()})]);}
    this.status='closed';this.emit('log',{event:'closed'});
  }
}

export function internetNode(){return new ShareNode({swarm:new Hyperswarm({dht:new DHT({ephemeral:true,port:0}),maxPeers:8,maxParallel:3,relayThrough:null})});}
