import assert from 'node:assert/strict';
import {boardFromUrl,parseSubject,measureActivity,activityTargets,createActivityMonitor,roundPlan,busyWait,ACTIVITY_INTERVAL,MIN_GAP,BUSY_WAIT} from '../src/activity.js';
const a=boardFromUrl('http://bbs.jpnkn.com/test/read.cgi/siki/1726578150/l50');
assert.equal(a.url,'https://bbs.jpnkn.com/siki/subject.txt');
assert.equal(a.key,boardFromUrl('https://bbs.jpnkn.com/siki/').key);
assert.equal(boardFromUrl('https://jbbs.shitaraba.net/bbs/read.cgi/game/1234/1726578150/').key,'shitaraba/game/1234');
assert.equal(boardFromUrl('http://jbbs.livedoor.jp/game/1234/').url,'https://jbbs.shitaraba.net/game/1234/subject.txt');
assert.equal(boardFromUrl('https://jbbs.shitaraba.net/bbs/subject.cgi/game/1234/').key,'shitaraba/game/1234');
for(const u of ['https://evil.invalid/siki/','https://bbs.jpnkn.com.evil.invalid/siki/','https://u:p@bbs.jpnkn.com/siki/','file:///siki','https://bbs.jpnkn.com:8443/siki/'])assert.equal(boardFromUrl(u),null);
const counts=parseSubject('100.dat<>題名 (余談) (10)\n200.cgi,したらば(20)\n');
assert.deepEqual([...counts],[['100',10],['200',20]]);
assert.throws(()=>parseSubject('<html>blocked</html>'));
assert.equal(parseSubject('').size,0);
let at=1700000000000;
const initial=measureActivity(null,counts,at);
assert.equal(initial.count,null,'初回の既存レスは加算しない');
const added=measureActivity(initial.baseline,new Map([['100',15],['200',21]]),at+ACTIVITY_INTERVAL);
assert.equal(added.count,6);
const deleted=measureActivity(added.baseline,new Map([['100',12]]),at+2*ACTIVITY_INTERVAL);
assert.equal(deleted.count,0,'削除では負の値にしない');
assert.equal(measureActivity(deleted.baseline,new Map([['100',15],['200',21]]),at+3*ACTIVITY_INTERVAL).count,0,'削除・過去ログからの復帰を二重計上しない');
const created=String((at+60000)/1000);
assert.equal(measureActivity(initial.baseline,new Map([['100',10],[created,3],['300',1000]]),at+ACTIVITY_INTERVAL).count,3,'新スレッドのみ初期レスを加える');
assert.equal(measureActivity(initial.baseline,counts,at+2*ACTIVITY_INTERVAL).count,null,'間隔が空いた場合は再基準化');
assert.equal(measureActivity(initial.baseline,counts,at+2*ACTIVITY_INTERVAL,3*ACTIVITY_INTERVAL).count,0,'1周が長いときは、その長さまで比べる');
const channels=[{name:'A',contactUrl:'https://bbs.jpnkn.com/siki/'},{name:'A',contactUrl:'https://bbs.jpnkn.com/test/read.cgi/siki/123/'},{name:'B',contactUrl:'https://jbbs.shitaraba.net/game/1234/'},{name:'案内',info:true,contactUrl:'https://bbs.jpnkn.com/other/'}];
assert.equal(activityTargets(channels).size,2);

// 1周の計画：5分の間に散らす。多すぎるときは1周を延ばす（間隔は最低3秒）
assert.deepEqual(roundPlan(36),{gap:22500,round:ACTIVITY_INTERVAL},'15分なら36件を22.5秒おき');
assert.deepEqual(roundPlan(100),{gap:MIN_GAP,round:100*MIN_GAP},'多いときも1件ごとに最低13秒あける');
assert.equal(MIN_GAP,13000);
assert.deepEqual(roundPlan(200),{gap:MIN_GAP,round:200*MIN_GAP});
assert.deepEqual(roundPlan(0),{gap:0,round:ACTIVITY_INTERVAL});
// 「取りすぎ」（429）の返事
assert.equal(busyWait('混雑(429) retry=30'),30000);
assert.equal(busyWait('混雑(429)'),BUSY_WAIT);
assert.equal(busyWait('サーバーの応答: 500'),null);

const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
let calls=0,fail=false;
const monitor=createActivityMonitor({now:()=>at,channels:()=>channels,fetch:async()=>{calls++;if(fail)throw Error('network');return `100.dat<>スレ (${calls<3?10:15})`;},onChange:()=>{}});
await monitor.tick();assert.equal(calls,0,'初期OFFでは通信しない');
const gap=roundPlan(2).gap;
monitor.setEnabled(true);await flush();assert.equal(calls,1,'1つずつ取りに行く');
await monitor.tick();await flush();assert.equal(calls,1,'次の掲示板は間をあけてから');
at+=gap;await monitor.tick();await flush();assert.equal(calls,2,'掲示板単位で一回だけ取得');
assert.ok(monitor.snapshot().rows.every(r=>r.count===null));
assert.equal(monitor.snapshot().running,false);
at+=ACTIVITY_INTERVAL-gap-1;await monitor.tick();await flush();assert.equal(calls,2,'取得間隔未満では次の周に入らない');
at++;await monitor.tick();await flush();at+=gap;await monitor.tick();await flush();
assert.equal(calls,4);assert.ok(monitor.snapshot().rows.every(r=>r.count===5));
fail=true;at+=ACTIVITY_INTERVAL;await monitor.tick();await flush();at+=gap;await monitor.tick();await flush();
assert.ok(monitor.snapshot().rows.every(r=>r.error&&r.count===null));
fail=false;at+=ACTIVITY_INTERVAL;await monitor.tick();await flush();at+=gap;await monitor.tick();await flush();
assert.ok(monitor.snapshot().rows.every(r=>r.count===null),'通信復帰後は基準を取り直す');
monitor.setEnabled(false);at+=ACTIVITY_INTERVAL;const oldCalls=calls;await monitor.tick();assert.equal(calls,oldCalls);

// 429：失敗にせず前回の値を残し、そのサイトには待つ時間が過ぎるまで取りに行かない（したらばは続ける）
const three=[{name:'J1',contactUrl:'https://bbs.jpnkn.com/a/'},{name:'J2',contactUrl:'https://bbs.jpnkn.com/b/'},{name:'S',contactUrl:'https://jbbs.shitaraba.net/game/1/'}];
const asked=[];let busy=false;
const m2=createActivityMonitor({now:()=>at,channels:()=>three,fetch:async(url)=>{asked.push(url);if(busy&&url.includes('jpnkn'))throw Error('混雑(429) retry=2400');return '100.dat<>スレ (1)';},onChange:()=>{}});
const g3=roundPlan(3).gap;
const runRound=async()=>{await m2.tick();await flush();for(let i=0;i<3;i++){at+=g3;await m2.tick();await flush();}};
m2.setEnabled(true);await flush();for(let i=0;i<3;i++){at+=g3;await m2.tick();await flush();}
assert.equal(asked.length,3);
busy=true;at+=ACTIVITY_INTERVAL;asked.length=0;await runRound();
assert.deepEqual(asked.map(u=>u.includes('jpnkn')?'j':'s'),['j','s'],'429のあと、同じサイトの残りは取りに行かない');
const rows=m2.snapshot().rows;
assert.ok(rows.filter(r=>r.name.startsWith('jpnkn')).every(r=>r.busy&&!r.error),'429は取得失敗にしない');
assert.ok(rows.filter(r=>r.name.startsWith('jpnkn')).every(r=>r.baseline),'前回の基準を残す');
busy=false;at+=ACTIVITY_INTERVAL;asked.length=0;await runRound();
assert.deepEqual(asked.map(u=>u.includes('jpnkn')?'j':'s'),['s'],'待つ時間（40分）が過ぎるまでは取りに行かない');
at+=ACTIVITY_INTERVAL;asked.length=0;await runRound();
assert.equal(asked.length,3,'待つ時間が過ぎたら取りに行く');

// OFF にしたら、取りに行く途中の応答を捨て、残りも取りに行かない
let resolveFetch,pendingCalls=0;
const pending=createActivityMonitor({now:()=>at,channels:()=>['a','b','c'].map(name=>({name,contactUrl:`https://bbs.jpnkn.com/${name}/`})),fetch:()=>{pendingCalls++;return new Promise(r=>resolveFetch=r);},onChange:()=>{}});
pending.setEnabled(true);assert.equal(pendingCalls,1,'同時に取りに行くのは1つ');pending.setEnabled(false);resolveFetch('100.dat<>スレ(9)');await flush();
at+=ACTIVITY_INTERVAL;await pending.tick();assert.equal(pendingCalls,1,'OFF後は残りを取得しない');assert.equal(pending.snapshot().rows.length,0,'OFF後の応答は破棄');
console.log('activity tests ok');

// 取得間隔を選べる（1時間・30分・10分・5分）
import { activityInterval, ACTIVITY_MINUTES } from '../src/activity.js';
assert.deepEqual(ACTIVITY_MINUTES,[15,30,60]);
assert.equal(activityInterval(60),3600000);
assert.equal(activityInterval(undefined),900000,'選んでいなければ15分');
assert.equal(activityInterval(5),900000,'前の版の5分・10分は15分として扱う');
assert.equal(activityInterval(10),900000);
assert.deepEqual(roundPlan(36,activityInterval(60)),{gap:90000,round:3600000},'1時間なら36件を1時間に散らす');
{
  let t=0,n=0,mins=60;const ch=[{name:'a',contactUrl:'https://bbs.jpnkn.com/a/'}];
  const m=createActivityMonitor({now:()=>t,channels:()=>ch,interval:()=>activityInterval(mins),fetch:async()=>{n++;return '100.dat<>スレ (1)';},onChange:()=>{}});
  m.setEnabled(true);await m.tick();await new Promise(r=>setTimeout(r,0));
  assert.equal(n,1);
  t+=15*60000;await m.tick();assert.equal(n,1,'1時間のときは15分では取りに行かない');
  mins=15;m.intervalChanged();await m.tick();await new Promise(r=>setTimeout(r,0));
  assert.equal(n,2,'15分に変えたら、すでに15分たっていればすぐ次の周');
  assert.equal(m.snapshot().rows[0].count,0,'15分の間の差を数える');
}
console.log('activity interval tests ok');

// 一覧の並びが変わっても、前の周で早く取った掲示板から取る（比べる期間が周の長さにそろう）
{
  let t=0;let order=['a','b','c'];const asked=[];
  const m=createActivityMonitor({now:()=>t,channels:()=>order.map(n=>({name:n,contactUrl:`https://bbs.jpnkn.com/${n}/`})),fetch:async(url)=>{asked.push(url.split('/')[3]);return '100.dat<>スレ (1)';},onChange:()=>{}});
  const g=roundPlan(3).gap;const step=async()=>{await m.tick();await new Promise(r=>setTimeout(r,0));};
  m.setEnabled(true);await step();for(let i=0;i<2;i++){t+=g;await step();}
  assert.deepEqual(asked,['a','b','c']);
  order=['c','b','a'];asked.length=0;
  t=ACTIVITY_INTERVAL;await step();for(let i=0;i<2;i++){t+=g;await step();}
  assert.deepEqual(asked,['a','b','c'],'並びが逆になっても、前に早く取ったものから');
  const el=m.snapshot().rows.map(r=>r.elapsed);
  assert.ok(el.every(e=>e===ACTIVITY_INTERVAL),'どの掲示板も比べる期間が取得間隔と同じ');
}
console.log('activity order tests ok');
