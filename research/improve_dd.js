const {load,trades,mc,f}=require('./improve_base.js');
for(const M of ['KR','US']){const {inds,cfg}=load(M);const key=M==='KR'?'pro|minervini':'pro|pullback5';const tr=trades(inds,key,M,cfg);
 const base={seed:M==='KR'?1e7:1e7/1360,risk:1,cap:30,maxPos:3,frac:M==='US'};const sc=t=>t.f.atrp;
 console.log('\n'+M,'위험 조절 (ATR 큰 순 정렬) 연수익 MDD | 상위3건 제외');const s3=[...tr].sort((a,b)=>b.r-a.r).slice(3);
 const V=[['기본 1%',{}],['낙폭 5%↑면 위험 절반',{ddCut:0.05,ddMul:0.5}],['낙폭 8%↑면 위험 절반',{ddCut:0.08,ddMul:0.5}],['낙폭 10%↑면 위험 절반',{ddCut:0.10,ddMul:0.5}],['3연속 손실이면 절반',{streak:3,ddMul:0.5}],['5연속 손실이면 절반',{streak:5,ddMul:0.5}],['위험 0.75%',{risk:0.75}],['위험 1.25%',{risk:1.25}],['위험 1.5%',{risk:1.5}],['위험 2%',{risk:2,cap:40}]];
 for(const [nm,x] of V){const o=Object.assign({},base,x);console.log(' ',nm.padEnd(20),mc(tr,o,sc).map(f).join(''),'|',mc(s3,o,sc).map(f).join(''));}
 // 다른 전략 섞기
 const key2=M==='KR'?'pro|pullback5':'pro|minervini';const tr2=trades(inds,key2,M,cfg);
 for(const [nm,set,fn] of [['주 전략만',tr,sc],['두 전략 섞기(동등)',tr.concat(tr2),sc],['두 전략·주 전략 우선',tr.concat(tr2),t=>(t.key===key?10:0)+t.f.atrp]]){for(const mp of [3,5]){const o=Object.assign({},base,{maxPos:mp,cap:mp===5?20:30});console.log('  ',nm.padEnd(18),mp+'종목',mc(set,o,fn).map(f).join(''));}}
}
