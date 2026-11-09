import assert from 'node:assert/strict';
import { dateKey, rankDay, emptyRanking, normalizeRanking, recordPeaks, rankRows } from '../src/ranking.js';
import { longHours, longColor } from '../src/yp.js';

const data = emptyRanking();
const now = new Date(2026, 10, 9, 23, 59);
const channel = (name, listeners, extra={}) => ({name,listeners,genre:'ゲーム',detail:'最初の配信',ypName:'SP',...extra});
assert.equal(dateKey(now),'2026-11-09');
recordPeaks(data,[channel('Ａさん',10),channel('Aさん',20,{ypName:'別YP'}),channel('B',-1),channel('案内',999,{info:true}),channel('イベント',999,{event:true})],now);
assert.equal(data.days['2026-11-09'].length,1);
assert.equal(data.months['2026-11'][0].listeners,20,'重複YPは加算しない');
assert.equal(data.months['2026-11'][0].ypName,'別YP');
assert.equal(recordPeaks(data,[channel('Aさん',19)],now),false,'低い値では更新しない');
assert.equal(recordPeaks(data,[channel('Aさん',20)],new Date(2026,10,9,23,59,30)),false,'同人数の最初の観測日時を維持');
// 夜中の0時を過ぎても、朝5時までは前の日
assert.equal(rankDay(new Date(2026,10,10,0,1)),'2026-11-09');
assert.equal(rankDay(new Date(2026,10,10,4,59)),'2026-11-09');
assert.equal(rankDay(new Date(2026,10,10,5,0)),'2026-11-10');
assert.equal(rankDay(new Date(2026,11,1,3)),'2026-11-30','月の変わり目も朝5時');
recordPeaks(data,[channel('Aさん',15)],new Date(2026,10,10,0,1));
assert.equal(data.days['2026-11-10'],undefined,'0時を過ぎた直後は前の日に記録');
const tomorrow = new Date(2026,10,10,5,1);
recordPeaks(data,[channel('Aさん',12),channel('C',30)],tomorrow);
assert.equal(data.days['2026-11-10'][0].listeners,12,'日付をまたぐと当日の値から集計');
assert.equal(data.months['2026-11'].find(r=>r.name==='Aさん').listeners,20,'月内最高値は維持');
recordPeaks(data,[channel('Aさん',40,{detail:'一番盛り上がった場面'})],tomorrow);
assert.equal(rankRows(data,'months','2026-11')[0].listeners,40);
assert.match(rankRows(data,'months','2026-11')[0].detail,/一番盛り上がった場面/);
assert.equal(rankRows(data,'months','2026-11')[0].at,tomorrow.getTime());
recordPeaks(data,[channel('Aさん',5)],new Date(2026,11,1,5));
assert.equal(data.months['2026-12'][0].listeners,5,'月境界');
const restored = normalizeRanking(JSON.parse(JSON.stringify(data)));
assert.deepEqual(restored,data,'再起動用の復元');
assert.deepEqual(normalizeRanking({days:{bad:[{}],'2026-11-09':[null,{name:'bad',listeners:-1,at:1} ]}}).days,{'2026-11-09':[]});
data.days['2020-01-01']=[]; data.months['2020-01']=[];
recordPeaks(data,[],new Date(2026,11,1,5));
assert.equal(data.days['2020-01-01'],undefined);
assert.equal(data.months['2020-01'],undefined);
// 長時間の配信：12時間以上で「長」。色は12時間でオレンジ、99時間で真っ赤
for(const [minutes,hours] of [[-1,0],[719,0],[720,12],[1439,23],[2880,48],[6000,100]]) assert.equal(longHours({uptimeMin:minutes}),hours);
assert.equal(longHours({uptimeMin:3000,info:true}),0);
assert.equal(longHours({uptimeMin:3000,event:true}),0);
assert.equal(longColor(12),'hsl(30 90% 48%)');
assert.equal(longColor(99),'hsl(0 90% 48%)');
assert.equal(longColor(200),'hsl(0 90% 48%)');
assert.ok(longColor(55).startsWith('hsl(15 '),'途中は少しずつ赤に近づく');
console.log('ranking and duration tests ok');

// 同日に配信詳細が違えば、人数が低くても別枠で残す。月別は配信者につき1枠。
const sessions = emptyRanking();
recordPeaks(sessions,[channel('Aさん',100,{detail:'朝のゲーム'})],now);
recordPeaks(sessions,[channel('Aさん',60,{detail:'夜の雑談'})],now);
assert.equal(sessions.days['2026-11-09'].length,2);
assert.equal(sessions.months['2026-11'].length,1);
assert.equal(sessions.months['2026-11'][0].listeners,100);
assert.match(sessions.months['2026-11'][0].detail,/朝のゲーム/);
recordPeaks(sessions,[channel('Aさん',150,{detail:'夜の雑談'})],tomorrow);
assert.equal(sessions.months['2026-11'].length,1);
assert.equal(sessions.months['2026-11'][0].listeners,150);
assert.match(sessions.months['2026-11'][0].detail,/夜の雑談/);
assert.equal(sessions.months['2026-11'][0].at,tomorrow.getTime());
recordPeaks(sessions,[channel('Ａさん',110,{detail:'朝のゲーム',ypName:'別YP'})],now);
assert.equal(sessions.days['2026-11-09'].length,2,'同じ詳細に戻ったときは既存枠を更新');
assert.equal(rankRows(sessions,'days','2026-11-09')[0].listeners,110);
const resumed = normalizeRanking(JSON.parse(JSON.stringify(sessions)));
recordPeaks(resumed,[channel('Aさん',90,{detail:'朝のゲーム'})],now);
assert.equal(resumed.days['2026-11-09'].length,2,'再起動後も詳細別の枠を維持');
assert.equal(resumed.months['2026-11'][0].listeners,150,'低い別配信で月の最高値を上書きしない');

// 月ごとのファイルに分けて保存し、読み直すと元に戻る
import { recentMonths, monthPart, mergeParts, monthsIn, monthFileName } from '../src/ranking.js';
const big = emptyRanking();
recordPeaks(big,[channel('Aさん',10)],new Date(2026,9,31,23));
recordPeaks(big,[channel('Aさん',20)],new Date(2026,10,1,4,59)); // 朝5時前なので10月31日の分
recordPeaks(big,[channel('Bさん',30)],new Date(2026,10,2,12));
assert.deepEqual(monthsIn(big).sort(),['2026-10','2026-11']);
const oct = monthPart(big,'2026-10'), nov = monthPart(big,'2026-11');
assert.deepEqual(Object.keys(oct.days),['2026-10-31']);
assert.equal(oct.days['2026-10-31'][0].listeners,20,'朝5時前の分は前の月のファイル');
assert.deepEqual(Object.keys(nov.days),['2026-11-02']);
assert.deepEqual(mergeParts([oct,nov]),normalizeRanking(JSON.parse(JSON.stringify(big))),'分けて読み直すと元どおり');
// 古い1ファイルの形と月ごとのファイルが両方あれば、月ごとのほうを優先
const stale = JSON.parse(JSON.stringify(big)); stale.days['2026-11-02'][0].listeners=1;
assert.equal(mergeParts([stale,nov]).days['2026-11-02'][0].listeners,30);
assert.deepEqual(recentMonths(new Date(2026,0,1,3),3),['2025-12','2025-11','2025-10'],'1月1日の朝5時前はまだ12月');
assert.deepEqual(recentMonths(new Date(2026,10,10,12),2,24),['2024-11','2024-10']);
assert.equal(monthFileName('2026-11'),'ranking-2026-11');
console.log('ranking monthly files ok');
