// Copyright (C) 2026 sapisapio — SPDX-License-Identifier: GPL-3.0-or-later
import {createHash,createPublicKey,generateKeyPairSync,sign,verify,randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {isIP} from 'node:net';

// v2（0.2.17）：掲載に配信の経過時間（uptime、秒）を足した。形が違う v1 とは別のネットワークにして混ざらないようにする
export const NETWORK='pecalist-channel-sharing-v2-7c1e5a9d3b6f48e2a0d4c8b1f9e36a57';
export const TTL=90000, SKEW=60000, MAX_RECORDS=256;
export const publisherKeyValid=k=>typeof k==='string'&&k.length===60&&/^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/.test(k)&&Buffer.from(k,'base64').toString('base64')===k;
const FIELDS=['v','network','publisher','channelId','session','seq','issuedAt','expiresAt','kind','body','signature'];
const BODY_FIELDS=['name','detail','listeners','type'];
const LIVE_FIELDS=[...BODY_FIELDS,'genre','comment','contactUrl','contentType','bitrate','relays','uptime','endpoint','track'];
const TRACK_FIELDS=['name','album','creator','url'];
export function publicEndpoint(value){
  if(typeof value!=='string'||value.trim()!==value)return false;
  const m=/^([0-9.]+):([0-9]{1,5})$/.exec(value);if(!m||isIP(m[1])!==4||+m[2]<1||+m[2]>65535)return false;
  const [a,b,c]=m[1].split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
}
export function validBody(b){
  const str=(v,n)=>typeof v==='string'&&v.length<=n;
  if(!b||!str(b.name,128)||!b.name||!str(b.detail,2048)||!Number.isSafeInteger(b.listeners)||b.listeners < -1||b.listeners>999999)return false;
  if(b.type==='DEMO')return exact(b,BODY_FIELDS);
  return b.type==='PEERCAST'&&exact(b,LIVE_FIELDS)&&str(b.genre,256)&&str(b.comment,2048)&&str(b.contactUrl,2048)&&str(b.contentType,32)&&Number.isSafeInteger(b.bitrate)&&b.bitrate>=0&&b.bitrate<=1000000&&Number.isSafeInteger(b.relays)&&b.relays>=-1&&b.relays<=999999&&Number.isSafeInteger(b.uptime)&&b.uptime>=0&&b.uptime<=10*366*86400&&publicEndpoint(b.endpoint)&&exact(b.track,TRACK_FIELDS)&&TRACK_FIELDS.every(k=>str(b.track[k],2048));
}
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
export const shortId=key=>createHash('sha256').update(key).digest('hex').slice(0,8);
const canonical=r=>Buffer.from(JSON.stringify([r.v,r.network,r.publisher,r.channelId,r.session,r.seq,r.issuedAt,r.expiresAt,r.kind,r.body===null?null:r.body.type==='DEMO'?[r.body.name,r.body.detail,r.body.listeners,r.body.type]:[...LIVE_FIELDS.filter(k=>k!=='track').map(k=>r.body[k]),TRACK_FIELDS.map(k=>r.body.track[k])]]));

export function newIdentity(){
  const keys=generateKeyPairSync('ed25519');
  return {publisher:keys.publicKey.export({type:'spki',format:'der'}).toString('base64'),privateKey:keys.privateKey};
}
export function signedRecord(identity,{channelId,session,seq,kind='upsert',body=null,now=Date.now()}){
  const r={v:1,network:NETWORK,publisher:identity.publisher,channelId,session,seq,issuedAt:now,expiresAt:now+TTL,kind,body};
  r.signature=sign(null,canonical(r),identity.privateKey).toString('base64');return r;
}

export class Catalog {
  constructor({wall=Date.now,mono=()=>performance.now(),changed=()=>{}}={}){this.wall=wall;this.mono=mono;this.changed=changed;this.entries=new Map();this.closed=new Map();this.blocked=new Set();this.ownPublisher=null;}
  setBlocked(keys){this.blocked=new Set(keys.filter(k=>publisherKeyValid(k)&&k!==this.ownPublisher));for(const [key,e]of this.entries)if(this.blocked.has(e.record.publisher))this.entries.delete(key);this.changed({event:'publisher-blocks-changed'});}
  accept(r,{historical=false,admit=()=>true}={}){
    const wall=this.wall(),mono=this.mono();
    if(!exact(r,FIELDS)||r.v!==1||r.network!==NETWORK) return {status:'invalid',reason:'network/schema'};
    if(!publisherKeyValid(r.publisher)||typeof r.signature!=='string'||r.signature.length!==88||!/^[A-Za-z0-9+/]{86}==$/.test(r.signature)||Buffer.from(r.signature,'base64').toString('base64')!==r.signature)return {status:'invalid',reason:'key/signature format'};
    if(this.blocked.has(r.publisher))return {status:'ignored',reason:'blocked publisher'};
    if(typeof r.channelId!=='string'||typeof r.session!=='string'||r.channelId.length!==32||r.session.length!==32||!/^[A-F0-9]{32}$/.test(r.channelId)||!/^[a-f0-9]{32}$/.test(r.session)||!Number.isSafeInteger(r.seq)||r.seq<1)return {status:'invalid',reason:'identity/sequence'};
    if(!Number.isSafeInteger(r.issuedAt)||!Number.isSafeInteger(r.expiresAt)||r.expiresAt-r.issuedAt!==TTL||r.issuedAt>wall+SKEW||(historical?r.issuedAt+TTL*3+SKEW<=wall:r.expiresAt<=wall))return {status:'invalid',reason:'timestamp'};
    if(r.kind!=='upsert'&&r.kind!=='stop')return {status:'invalid',reason:'kind'};
    if(r.kind==='stop'&&r.body!==null)return {status:'invalid',reason:'stop body'};
    if(r.kind==='upsert'&&!validBody(r.body))return {status:'invalid',reason:'body'};
    let encoded;
    try{encoded=canonical(r);if(encoded.length>8192||!verify(null,encoded,createPublicKey({key:Buffer.from(r.publisher,'base64'),type:'spki',format:'der'}),Buffer.from(r.signature,'base64')))return {status:'invalid',reason:'signature'};}catch{return {status:'invalid',reason:'signature'};}
    const key=r.publisher+'/'+r.channelId,closedKey=key+'/'+r.session,previous=this.entries.get(key);
    if(previous&&r.seq<=previous.record.seq)return {status:'ignored',reason:'old/duplicate'};
    if(r.kind==='upsert'&&this.closed.has(closedKey))return {status:'ignored',reason:'closed session'};
    const own=r.publisher===this.ownPublisher;
    if(!previous&&(this.entries.size>=(own?MAX_RECORDS:MAX_RECORDS-8)||[...this.entries.values()].filter(e=>e.record.publisher===r.publisher).length>=8))return {status:'ignored',reason:'capacity'};
    if(!previous&&!historical&&!own&&!admit())return {status:'ignored',reason:'admission rate'};
    const record=structuredClone(r);
    const remaining=Math.max(0,Math.min(TTL,r.expiresAt-wall));
    const retention=historical?Math.max(0,Math.min(TTL*3+SKEW,r.issuedAt+TTL*3+SKEW-wall)):TTL*3+SKEW;
    this.entries.set(key,{record,deadline:mono+remaining,retainUntil:mono+retention,active:r.kind==='upsert'&&remaining>0});
    if(r.kind==='stop'){if(this.closed.size>=MAX_RECORDS*4)this.closed.delete(this.closed.keys().next().value);this.closed.set(closedKey,mono+TTL*3+SKEW);}
    this.changed({event:r.kind==='stop'?'listing-stopped':previous?.active?'listing-updated':'listing-added',publisher:shortId(r.publisher),channelId:r.channelId.slice(0,8),seq:r.seq});
    return {status:'accepted',record};
  }
  sweep(){
    const mono=this.mono();
    for(const [key,e]of this.entries){if(e.active&&e.deadline<=mono){e.active=false;this.changed({event:'listing-expired',publisher:shortId(e.record.publisher),channelId:e.record.channelId.slice(0,8)});}if(e.retainUntil<=mono)this.entries.delete(key);}
    for(const [key,until]of this.closed)if(until<=mono)this.closed.delete(key);
  }
  rows(){this.sweep();const mono=this.mono();return [...this.entries.values()].filter(e=>e.active).map(e=>({publisher:shortId(e.record.publisher),publisherKey:e.record.publisher,channelId:e.record.channelId,...e.record.body,seq:e.record.seq,remainingSeconds:Math.max(0,Math.ceil((e.deadline-mono)/1000)),ageSeconds:Math.max(0,Math.round((this.wall()-e.record.issuedAt)/1000))}));}
  snapshot(){this.sweep();const wall=this.wall();return [...this.entries.values()].filter(e=>e.record.expiresAt>wall&&(!e.active?e.record.kind==='stop':true)).map(e=>e.record);}
  checkpoint(){this.sweep();return [...this.entries.values()].map(e=>e.record);}
}

export class Publisher {
  constructor(catalog,send,{identity=newIdentity(),now=Date.now}={}){this.identity=identity;this.now=now;this.catalog=catalog;this.send=send;this.seq=0;this.channelId=randomBytes(16).toString('hex').toUpperCase();this.session='';this.active=false;this.paused=false;this.revision=1;}
  publish(kind){const seq=this.seq+1;this.beforeSign?.(seq);this.seq=seq;const r=signedRecord(this.identity,{channelId:this.channelId,session:this.session,seq,kind,body:kind==='upsert'?(this.liveBody||{name:`試験チャンネル ${shortId(this.identity.publisher)}`,detail:`自動共有の試験です（更新 ${this.revision}）`,listeners:10+this.revision,type:'DEMO'}):null,now:this.now()});const result=this.catalog.accept(r);if(result.status!=='accepted')throw new Error('own publication rejected: '+result.reason);this.send(r);return r;}
  start(live=null){if(this.active&&!this.paused)return;this.liveBody=live?.body?structuredClone(live.body):null;if(live)this.channelId=live.channelId;this.session=randomBytes(16).toString('hex');this.active=true;this.paused=false;this.revision=1;return this.publish('upsert');}
  update(){if(!this.active||this.paused)throw new Error('掲載開始後に更新できます');this.revision++;return this.publish('upsert');}
  renew(){if(this.active&&!this.paused)return this.publish('upsert');}
  pause(){if(!this.active)throw new Error('掲載を開始してください');this.paused=true;}
  stop(){if(!this.active)return;const r=this.publish('stop');this.active=false;this.paused=false;return r;}
}
