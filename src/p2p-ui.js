// PecaList — GPL-3.0-or-later
import {receivedChannels} from './p2p-channels.js';
import {normalizePublisherBlocks} from './p2p-safety.js';
import {saveStoreNow} from './store.js';
export function initP2pUI(ctx){
 const $=id=>document.getElementById(id);let working=false,previous='',configured='',configuredBlocks='',refreshing=false,view={},blockView='',blockWorking=false;
 const blocks=()=>normalizePublisherBlocks(ctx.settings.p2pBlocked);
 const el=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
 function message(text){$('p2p-status').textContent=text;}
 async function command(action,channelId){if(working)return;working=true;$('p2p-toggle').disabled=true;try{
  message(action==='enable'?'P2Pを準備しています。初回は少し時間がかかります…':'処理中…');
  await ctx.invoke('p2p_action',{action,peercast:ctx.settings.peercast,channelId:channelId||null,blocked:blocks().map(b=>b.publisher),hideListeners:Boolean(ctx.settings.p2pHideListeners)});
  if(action==='enable'||action==='disable'){ctx.settings.p2pEnabled=action==='enable';ctx.saveSettings();configured=ctx.settings.peercast;configuredBlocks=JSON.stringify(blocks());}
  await poll();
 }catch(e){message(String(e));ctx.toast(String(e));}finally{working=false;$('p2p-toggle').disabled=false;}}
 function renderBlocks(){const list=blocks(),key=JSON.stringify(list);if(key===blockView)return;blockView=key;$('p2p-blocks').replaceChildren(...list.map(b=>{const row=el('div','','p2p-block-row'),name=el('span',b.name);name.title=b.publisher;const button=el('button','解除','btn sm');button.onclick=()=>setBlocks(list.filter(x=>x.publisher!==b.publisher));row.append(name,button);return row;}));$('p2p-block-empty').hidden=list.length>0;}
 async function setBlocks(next){if(blockWorking)return;blockWorking=true;const old=ctx.settings.p2pBlocked;try{ctx.settings.p2pBlocked=normalizePublisherBlocks(next);await saveStoreNow('settings',ctx.settings);previous='';renderBlocks();if(view.enabled)await command('enable');await poll();}catch(e){ctx.settings.p2pBlocked=old;ctx.toast('ブロック設定を保存できません：'+e);}finally{blockWorking=false;}}
 async function block(publisher,name){if(blocks().some(b=>b.publisher===publisher))return;if(blocks().length>=512){ctx.toast('ブロックした掲載者が上限に達しています');return;}await setBlocks([...blocks(),{publisher,name}]);}
 function render(s){view=s;const d=s.data||{},local=d.local||{},items=local.items||[];
  $('p2p-toggle').textContent=s.enabled?'P2P配信をOFF':'P2P配信をON';$('p2p-stop').disabled=!local.selected||working;
  if(s.preparing)message('P2Pを準備しています…');else if(!working)message(!s.enabled?'P2P配信はOFFです':d.error||(local.selected?'配信を掲載中です':'P2P配信はONです。掲載する配信を選べます。'));
  $('p2p-local-error').textContent=local.error||'';
  $('p2p-candidates').replaceChildren(...items.map(c=>{const card=el('article','','p2p-card');card.append(el('strong',c.body.name),el('span',c.active?'掲載中':'未掲載','badge'),el('p',[c.body.detail,c.body.comment].filter(Boolean).join(' / ')),el('p',`YP: ${c.ypNames.join('・')||'登録なし'} · ${c.body.contentType}`,'sub'));
   if(c.blocked)card.append(el('p',c.blocked,'sub'));const b=el('button','掲載を開始','btn primary');b.disabled=Boolean(local.selected||c.blocked||local.error||working);b.onclick=()=>command('start',c.channelId);card.append(b);return card;}));
  $('p2p-empty').hidden=items.length>0;$('p2p-empty').textContent=s.enabled?'自分が配信元のチャンネルはありません。受信したチャンネルは通常の一覧に表示されます。':'ONにするとペカステの配信候補を確認できます。';
  renderBlocks();
 }
 async function poll(){if(refreshing)return;refreshing=true;try{
  const s=await ctx.invoke('p2p_state',{});render(s);
  if(!s.preparing){const denied=new Set(blocks().map(b=>b.publisher)),rows=s.data?.rows||[],channels=receivedChannels(rows).filter(ch=>ch.p2pOwn||!denied.has(ch.publisher));const key=JSON.stringify(channels);if(key!==previous){previous=key;ctx.onChannels(channels);}}
 }catch(e){message(String(e));if(previous!=='[]'){previous='[]';ctx.onChannels([]);}}finally{refreshing=false;}}
 $('p2p-toggle').onclick=()=>command(view.enabled?'disable':'enable');$('p2p-stop').onclick=()=>command('stop');
 // 掲載中に切り替えても、すぐ新しい掲載を送る（ペカステの接続先の設定し直しと同じ道を通る）
 $('p2p-hide-listeners').checked=Boolean(ctx.settings.p2pHideListeners);$('p2p-hide-listeners').onchange=e=>{ctx.settings.p2pHideListeners=e.target.checked;ctx.saveSettings();if(view.enabled)command('enable');};
 $('p2p-auto').checked=Boolean(ctx.settings.p2pAutoActions);$('p2p-auto').onchange=e=>{ctx.settings.p2pAutoActions=e.target.checked;ctx.saveSettings();};
 $('p2p-images').onchange=e=>{ctx.settings.p2pArtworkEnabled=e.target.checked;ctx.saveSettings();ctx.onArtworkChange();};
 const timer=setInterval(()=>{if(!working&&view.enabled&&(configured!==ctx.settings.peercast||configuredBlocks!==JSON.stringify(blocks()))){command('enable');return;}if(!working)poll();},1500);
 return {async load(){$('p2p-auto').checked=Boolean(ctx.settings.p2pAutoActions);$('p2p-hide-listeners').checked=Boolean(ctx.settings.p2pHideListeners);$('p2p-images').checked=Boolean(ctx.settings.p2pArtworkEnabled);ctx.settings.p2pBlocked=blocks();renderBlocks();if(ctx.settings.p2pEnabled)await command('enable');else await poll();},block,render:()=>render(view),close:()=>clearInterval(timer)};
}
