// PecaList — GPL-3.0-or-later
// 配信の経過時間：配信者のペカステの値（掲載を出した時点）に、掲載を出してからの時間を足す。分の単位で「h:mm」
export function p2pUptime(r){
 const sec=Number.isSafeInteger(r.uptime)&&r.uptime>=0?r.uptime+(Number.isSafeInteger(r.ageSeconds)?r.ageSeconds:0):-1;
 if(sec<0)return {uptime:'',uptimeMin:-1};
 const min=Math.floor(sec/60);return {uptime:`${Math.floor(min/60)}:${String(min%60).padStart(2,'0')}`,uptimeMin:min};
}
export function receivedChannels(rows){
 return (rows||[]).filter(r=>r.type==='PEERCAST'&&/^[A-F0-9]{32}$/.test(r.channelId)&&!/^0+$/.test(r.channelId)).map(r=>({
  key:`P2P/${r.channelId}/${r.publisherKey||r.publisher}`,name:r.name,id:r.channelId,tip:r.endpoint,
  contactUrl:r.contactUrl||'',genre:r.genre||'',detail:r.detail||'',comment:r.comment||'',listeners:r.listeners,relays:r.relays,bitrate:r.bitrate,type:r.contentType,
  trackArtist:r.track?.creator||'',trackTitle:r.track?.name||'',trackAlbum:r.track?.album||'',trackUrl:r.track?.url||'',...p2pUptime(r),status:'',direct:false,info:false,event:false,
  ypName:'P2P',ypUrl:'',p2pOnly:true,p2pOwn:Boolean(r.own),publisher:r.publisherKey||r.publisher,sourceLabel:'P2P',
 }));
}
export function mergeP2P(existing,received){
 const out=existing.slice(),first=new Map();for(let i=0;i<out.length;i++)if(!out[i].info&&!out[i].event&&!first.has(out[i].id.toUpperCase()))first.set(out[i].id.toUpperCase(),i);
 const groups=new Map();for(const c of received){const key=c.id.toUpperCase();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
 for(const [id,group]of groups){
  group.sort((a,b)=>a.publisher.localeCompare(b.publisher));const sources=group.map(c=>c.publisher),ownKeys=group.filter(c=>c.p2pOwn).map(c=>c.publisher),conflict=sources.length>1;
  if(first.has(id)){const i=first.get(id);out[i]={...out[i],p2pSources:sources,p2pOwnKeys:ownKeys,p2pConflict:conflict,sourceLabel:(out[i].sourceLabel||out[i].ypName)+' / P2P'+(conflict?'（競合）':'')};}
  else if(conflict){for(const c of group)out.push({...c,p2pSources:sources,p2pConflict:true,sourceLabel:'P2P（掲載者競合）'});}
  else out.push({...group[0],p2pSources:sources});
 }
 return out;
}
