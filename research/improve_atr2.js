const {load,trades,mc,f}=require('./improve_base.js');
for(const M of ['KR','US']){const {inds,cfg}=load(M);const key=M==='KR'?'pro|minervini':'pro|pullback5';const tr=trades(inds,key,M,cfg);
 const o={seed:M==='KR'?1e7:1e7/1360,risk:1,cap:30,maxPos:3,frac:M==='US'};const s=[...tr].sort((a,b)=>b.r-a.r);
 console.log(M,'상위 거래',s.slice(0,5).map(t=>t.sym+' '+t.r.toFixed(1)+'R atr'+(t.f.atrp*100).toFixed(1)).join(', '));
 for(const k of [0,3,5,10]){const sub=s.slice(k);console.log(' 상위',k,'건 제외: 무작위',mc(sub,o,null).map(f).join(''),'| ATR큰순',mc(sub,o,t=>t.f.atrp).map(f).join(''),'| 같은날 내 순위 효과(ATR큰-작은)',f(mc(sub,o,t=>t.f.atrp)[0]-mc(sub,o,t=>-t.f.atrp)[0]));}
 // 연도별 포트폴리오
 for(const y of ['2023','2024','2025','2026']){const sub=tr.filter(t=>t.entryDate.startsWith(y));console.log('  ',y,'무작위',f(mc(sub,o,null)[0]),'ATR큰순',f(mc(sub,o,t=>t.f.atrp)[0]));}
}
