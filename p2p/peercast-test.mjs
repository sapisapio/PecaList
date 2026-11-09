import assert from 'node:assert/strict';
import {candidates,LocalMonitor} from './peercast.mjs';
import {ShareNode} from './network.mjs';
import {Catalog,newIdentity,signedRecord,publicEndpoint} from './catalog.mjs';
const cid='A'.repeat(32),cid2='B'.repeat(32);
const raw=(id=cid,broadcast=true,status='Receiving')=>({channelId:id,status:{isBroadcasting:broadcast,status,isReceiving:true,totalDirects:8,totalRelays:2,uptime:3725,source:'rtmp://SECRET/KEY'},info:{name:'サピオ試験',desc:'詳細',comment:'コメント',genre:'game',url:'https://example.com',contentType:'FLV',bitrate:1000},track:{name:'曲名',album:'アルバム',creator:'作者',url:'https://example.com/track'},yellowPages:[]});
const ep=new Map([[cid,'8.8.8.8:7144'],[cid2,'8.8.4.4:7144']]);
let data=candidates([raw(),raw(cid2,false)],ep);assert.equal(data.length,1);assert.equal(data[0].body.track.name,'曲名');assert.equal(data[0].body.track.album,'アルバム');assert(!JSON.stringify(data).includes('SECRET'));assert(!data[0].blocked,'isReceiving false alone does not imply ended');assert.equal(data[0].body.uptime,3725,'配信者のペカステの経過時間');
for(const value of ['127.0.0.1:7144','192.168.1.1:7144','100.64.0.1:7144','169.254.1.1:7144','[::1]:7144','example.com:7144','8.8.8.8:0'])assert(!publicEndpoint(value),value);
const identity=newIdentity(),catalog=new Catalog();const live=signedRecord(identity,{channelId:cid,session:'a'.repeat(32),seq:1,body:data[0].body});assert.equal(catalog.accept(live).status,'accepted');const altered=structuredClone(live);altered.body.track.album='改変';assert.equal(catalog.accept(altered).reason,'signature');
let now=Date.now(),items=candidates([raw(),raw(cid2)],ep),fail=false;
const n=new ShareNode(),m=new LocalMonitor(n,{now:()=>now,load:async()=>{if(fail)throw new Error('offline');return structuredClone(items)}});
try{
 await m.poll();assert.equal(n.view().rows.length,0,'候補取得だけでは公開しない');
 await m.start(cid);assert.equal(n.view().rows[0].channelId,cid);assert.equal(n.view().rows.length,1,'選んだものだけ公開');
 await assert.rejects(()=>m.start(cid2));
 const seq=n.publisher.seq;n.publisher.renew();assert.equal(n.publisher.seq,seq,'監視を迂回して生存更新しない');
 items[0].body.detail='変更';now+=5000;await m.poll();assert.equal(n.view().rows[0].detail,'変更');
 const seq2=n.publisher.seq;items[0].body.uptime+=5;now+=29000;await m.poll();assert.equal(n.publisher.seq,seq2,'経過時間が増えただけではすぐ送らない');now+=1000;await m.poll();assert.equal(n.publisher.seq,seq2+1);assert.equal(n.view().rows[0].uptime,3730,'生存更新で新しい経過時間を送る');assert(Number.isSafeInteger(n.view().rows[0].ageSeconds));
 items[0].status='Idle';await m.poll();assert.equal(n.view().rows.length,0);assert.equal(m.selected,null);
 items=candidates([raw()],ep);await m.start(cid);items=[];await m.poll();assert.equal(n.view().rows.length,0,'消失で終了');
 items=candidates([raw()],ep);await m.start(cid);fail=true;const last=n.publisher.seq;now+=5000;await m.poll();assert.equal(n.publisher.seq,last,'API失敗では更新しない');fail=false;now+=5000;await m.poll();assert.equal(m.selected,cid,'短いAPI障害から回復');
 fail=true;await m.poll();now+=15000;await m.poll();assert.equal(n.view().rows.length,0);assert.equal(m.selected,null,'長いAPI障害で掲載終了');
 fail=false;await m.poll();assert.equal(n.view().rows.length,0,'回復後に無断再掲載しない');
 for(const status of ['Idle','Error','Connecting','Searching','Disconnected']){items=candidates([raw()],ep);await m.start(cid);items[0].status=status;await m.poll();assert.equal(m.selected,null,'切断・再接続待ちでは掲載を終了: '+status);assert.equal(n.view().rows.length,0);}
 items=candidates([raw()],ep);await m.start(cid);items[0].isReceiving=false;await m.poll();const before=n.publisher.seq;now+=5000;await m.poll();assert.equal(m.selected,cid,'瞬間的な受信レート0は即終了しない');assert.equal(n.publisher.seq,before,'受信停止中は生存更新しない');items[0].isReceiving=true;await m.poll();assert.equal(m.selected,cid);items[0].isReceiving=false;await m.poll();now+=10000;await m.poll();assert.equal(m.selected,null,'Receiving表示が残っても10秒継続で終了');items[0].isReceiving=true;await m.poll();assert.equal(n.view().rows.length,0,'入力再開だけで無断再掲載しない');
 console.log('PASS broadcast-only, metadata, signatures, explicit selection, update/renew, all disconnected states, receive stall/recovery, disappearance, API outage');
}finally{m.close();await n.close()}
