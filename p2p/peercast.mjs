// Copyright (C) 2026 sapisapio — SPDX-License-Identifier: GPL-3.0-or-later
import {validBody} from './catalog.mjs';

async function request(url,options={}){
  const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(3000)});
  if(!r.ok)throw new Error('ローカルAPI HTTP '+r.status);
  let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>1048576)throw new Error('ローカル応答が大きすぎます');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}
export async function localChannels(base='http://127.0.0.1:7144'){
  const [json,index]=await Promise.all([
    request(base+'/api/1',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getChannels',params:{}})}),
    request(base+'/html/index.txt').catch(()=>'')
  ]);
  const r=JSON.parse(json);if(r.error||!Array.isArray(r.result)||r.result.length>256)throw new Error('ローカルAPIの応答を確認してください');
  // ローカルindexは接続先（3列目）だけに使用。曲情報は名前付きAPI項目から取得。
  const endpoints=new Map(index.split(/\r?\n/).map(line=>{const f=line.split('<>');return [f[1]?.toUpperCase(),f[2]]}));
  return candidates(r.result,endpoints);
}
export function candidates(channels,endpoints){
  const text=v=>typeof v==='string'?v:'';
  const number=v=>Number.isSafeInteger(v)?v:0;
  return channels.filter(c=>c?.status?.isBroadcasting===true&&typeof c.channelId==='string'&&/^[0-9a-f]{32}$/i.test(c.channelId)).map(c=>{
    const id=c.channelId.toUpperCase(),i=c.info||{},t=c.track||{},s=c.status;
    // API全体やstatus.source（入力URL）は保存・共有しない。
    const body={name:text(i.name),detail:text(i.desc),listeners:number(s.totalDirects),type:'PEERCAST',genre:text(i.genre),comment:text(i.comment),contactUrl:text(i.url),contentType:text(i.contentType),bitrate:number(i.bitrate),relays:number(s.totalRelays),uptime:Math.max(0,number(s.uptime)),endpoint:endpoints.get(id)||'',track:{name:text(t.name),album:text(t.album),creator:text(t.creator),url:text(t.url)}};
    let blocked='';if(!validBody(body))blocked='公開IPv4の接続先または掲載項目を確認できません（この試作はIPv4のみ）';
    if(Buffer.byteLength(JSON.stringify(body))>6000)blocked='掲載情報が試作のサイズ上限を超えています';
    if(s.status!=='Receiving')blocked='配信データの受信待ちです';
    return {channelId:id,body,status:text(s.status),isReceiving:s.isReceiving===true,ypNames:Array.isArray(c.yellowPages)?c.yellowPages.map(y=>text(y.name)).filter(Boolean):[],blocked};
  });
}

export class LocalMonitor {
  constructor(node,{load=localChannels,now=Date.now}={}){
    this.node=node;this.load=load;this.now=now;this.items=[];this.selected=null;this.error='';this.checkedAt=null;this.failedSince=null;this.notReceivingSince=null;this.lastSent=0;this.lastBody='';this.busy=false;this.closed=false;
    // 実配信は監視結果が成功したときだけ更新する。
    node.publisher.renew=()=>{};
    this.timer=setInterval(()=>this.poll(),5000);
  }
  stop(reason){if(this.selected){this.node.publisher.stop();this.node.emit('log',{event:'publication-ended',reason});}this.selected=null;this.lastBody='';this.notReceivingSince=null;}
  reconcile(items){
    this.items=items;this.error='';this.failedSince=null;this.checkedAt=this.now();
    if(!this.selected)return;
    const c=items.find(c=>c.channelId===this.selected);
    if(!c){this.stop('配信元チャンネルが消失');return;}
    if(c.status!=='Receiving'){this.stop('ペカステの配信終了・切断を検知');return;}
    if(!c.isReceiving){
      this.notReceivingSince??=this.now();
      if(this.now()-this.notReceivingSince>=10000)this.stop('ペカステで配信データの受信停止を検知');
      return; // 受信停止中の情報を生存更新しない
    }
    this.notReceivingSince=null;
    if(c.blocked){this.error=c.blocked;return;}
    // 経過時間は毎回変わるので、内容が変わったかどうかの比べ方からは外す（30秒ごとの生存更新で新しい値を送る）
    const serialized=JSON.stringify({...c.body,uptime:0});
    if(serialized!==this.lastBody||this.now()-this.lastSent>=30000){this.node.publisher.liveBody=structuredClone(c.body);this.node.publisher.publish('upsert');this.lastBody=serialized;this.lastSent=this.now();}
  }
  async poll(){
    if(this.busy||this.closed)return;this.busy=true;
    try{const items=await this.load();if(!this.closed)this.reconcile(items);}
    catch{if(!this.closed){this.error='ペカステの取得に失敗しました。掲載の生存更新を停止しています。';this.checkedAt=null;this.failedSince??=this.now();if(this.now()-this.failedSince>=15000)this.stop('ペカステを15秒以上確認できないため掲載終了');}}
    finally{this.busy=false;}
  }
  async start(id){
    if(this.selected)throw new Error('先に現在の掲載を終了してください');
    // 押した時点で再取得し、古い候補の公開を防ぐ。
    const items=await this.load();if(this.closed)throw new Error('終了処理中です');this.reconcile(items);
    const c=this.items.find(c=>c.channelId===id);if(!c)throw new Error('配信元チャンネルが見つかりません');if(c.blocked)throw new Error(c.blocked);
    this.node.publisher.start(c);this.selected=id;this.notReceivingSince=c.isReceiving?null:this.now();this.lastSent=this.now();this.lastBody=JSON.stringify({...c.body,uptime:0});this.node.emit('log',{event:'publication-started',channelId:id.slice(0,8)});
  }
  view(){return {items:this.items.map(c=>({...c,active:c.channelId===this.selected})),selected:this.selected,error:this.error,checkedAt:this.checkedAt};}
  close(){this.closed=true;clearInterval(this.timer);}
}
