// PecaList — GPL-3.0-or-later
export function normalizePublisherBlocks(list){
 const seen=new Set(),out=[];for(const b of Array.isArray(list)?list:[]){if(!b||typeof b.publisher!=='string'||b.publisher.length!==60||!/^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/.test(b.publisher)||btoa(atob(b.publisher))!==b.publisher||seen.has(b.publisher))continue;seen.add(b.publisher);out.push({publisher:b.publisher,name:typeof b.name==='string'?b.name.slice(0,128):'掲載者'});if(out.length>=512)break;}return out;
}
export function artworkAllowed(ch,settings){return !ch.p2pOnly||settings.p2pArtworkEnabled===true;}
