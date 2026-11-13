const {load,trades,mc,f}=require('./improve_base.js');
for(const M of ['KR','US']){const {inds,cfg}=load(M);const key=M==='KR'?'pro|minervini':'pro|pullback5';const tr=trades(inds,key,M,cfg);
 const dates=[...new Set(tr.map(t=>t.entryDate))].sort();const split=dates[Math.floor(dates.length*0.6)];
 const o={seed:M==='KR'?1e7:1e7/1360,risk:1,cap:30,maxPos:3,frac:M==='US'};
 console.log('\n'+M,key,'거래',tr.length,'| 정렬기준: 전체 연수익/MDD | 앞60% | 뒤40%');
 const sc={'무작위(기준)':null,'거래량 배수 큰 순':t=>t.f.vol,'상대강도 높은 순':t=>t.f.rs,'변동성(ATR%) 작은 순':t=>-t.f.atrp,'변동성 큰 순':t=>t.f.atrp,'거래대금 큰 순':t=>t.f.turn,'52주 고가 근접 순':t=>t.f.hi52,'20일 수익률 큰 순':t=>t.f.ret20,'20일 수익률 작은 순':t=>-t.f.ret20,'RSI 낮은 순':t=>-t.f.rsi};
 for(const [nm,fn] of Object.entries(sc)){const a=mc(tr,o,fn),b=mc(tr.filter(t=>t.entryDate<split),o,fn),c=mc(tr.filter(t=>t.entryDate>=split),o,fn);console.log(nm.padEnd(18),f(a[0]),f(a[1]),'|',f(b[0]),'|',f(c[0]));}
 // 같은 날 신호가 몇 개나 겹치는지
 const by={};for(const t of tr)by[t.entryDate]=(by[t.entryDate]||0)+1;const v=Object.values(by);console.log('같은 날 신호 2개 이상 비율',(v.filter(x=>x>1).length/v.length*100).toFixed(0)+'%','평균',(tr.length/v.length).toFixed(2));
}
