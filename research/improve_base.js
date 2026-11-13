const E=require('/home/claude/engine.js');const fs=require('fs');const {smaX,simCustom,atr}=E._h;
const SP='/tmp/claude-0/-home-claude/75ca9259-01a1-5a33-9e25-571cf86f9a0b/scratchpad/';
function load(M){const d=JSON.parse(fs.readFileSync(SP+'ds2/data/'+M+'.json'));
 let st=d.stocks.filter(s=>M!=='KR'||s.symbol.endsWith('0')).map(s=>({symbol:s.symbol,name:s.name,market:M,bars:s.bars})).filter(s=>s.bars.length>=260);
 if(M==='US'){const best=new Map();for(const s of st){const k=String(s.name||s.symbol).replace(/\s*\(Class [A-Z]\)\s*$/,'').toLowerCase();const b=s.bars.slice(-60);const v=b.reduce((a,x)=>a+x[4]*x[5],0);if(!best.has(k)||v>best.get(k)[0])best.set(k,[v,s]);}st=[...best.values()].map(x=>x[1]);}
 E.attachRS(st,d.index?d.index.bars:null);const cfg=E.DEFAULT_CFG;const inds=st.map(s=>{const i=E.compute(s.bars);i._mk=M;i._sym=s.symbol;return i;});return {inds,cfg,index:d.index};}
function trades(inds,key,M,cfg){const S=E.strat(key);const tr=[];for(const ind of inds){let next=0;for(let t=253;t<ind.c.length-1;t++){if(t<next)continue;const e=S.evaluate(ind,t,cfg);if(!e.ready||!e.conds.every(Boolean))continue;const r=simCustom(ind,t,S,M,cfg);if(!r||r.skipped)continue;if(r.open){next=1e9;continue;}
 const x=e.x||{};const a=atr(ind,20)[t];
 tr.push({sym:ind._sym,key,entryDate:ind.dates[r.entryIdx],exitDate:ind.dates[r.exitIdx],sigDate:ind.dates[t],r:r.r,R:r.R,entry:r.entry,hold:r.hold,
  f:{vol:ind.v[t]/ind.volAvg20[t-1],rs:ind._x.rsPct?ind._x.rsPct[t]:NaN,atrp:a/ind.c[t],turn:ind.c[t]*ind.volAvg20[t-1],hi52:ind.c[t]/Math.max(...ind.h.slice(t-251,t+1)),ret20:ind.c[t]/ind.c[t-20]-1,depth:x.depth,rsi:ind.rsi[t]}});next=r.exitIdx+1;}}return tr;}
// 포트폴리오 (위험 조절 옵션 포함)
function pf(trs,o){const list=[...trs].sort((a,b)=>a.entryDate<b.entryDate?-1:a.entryDate>b.entryDate?1:(b.score||0)-(a.score||0));
 let eq=o.seed,pk=o.seed,mdd=0,n=0,w=0;const open=[];let losing=0;const fl=v=>o.frac?Math.floor(v*1e4)/1e4:Math.floor(v+1e-9);
 const real=u=>{open.sort((a,b)=>a.exitDate<b.exitDate?-1:1);while(open.length&&(u==null||open[0].exitDate<u)){const p=open.shift();eq+=p.pnl;if(p.pnl>0){w++;losing=0}else losing++;pk=Math.max(pk,eq);mdd=Math.max(mdd,(pk-eq)/pk);}};
 let first=null,last=null;
 for(const t of list){real(t.entryDate);if(open.length>=o.maxPos)continue;if(open.some(p=>p.sym===t.sym))continue;
  let risk=o.risk;const dd=(pk-eq)/pk;if(o.ddCut&&dd>=o.ddCut)risk*=o.ddMul;if(o.streak&&losing>=o.streak)risk*=o.ddMul;
  const cash=eq-open.reduce((s,p)=>s+p.inv,0);const q=Math.min(fl(eq*risk/100/t.R),fl(Math.min(eq*o.cap/100,cash)/t.entry));if(!(q>0))continue;
  open.push({sym:t.sym,exitDate:t.exitDate,inv:q*t.entry,pnl:q*t.R*t.r});n++;first=first||t.entryDate;last=t.exitDate>(last||'')?t.exitDate:last;}
 real(null);const yrs=Math.max(0.25,(new Date(last)-new Date(first))/31557600000);return {cagr:Math.pow(eq/o.seed,1/yrs)-1,mdd,n,win:w/(n||1)};}
const q=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(p*(s.length-1))];};const f=x=>(x*100).toFixed(1).padStart(6);
function mc(trs,o,scoreFn,k=200){const A=[],D=[];for(let i=0;i<k;i++){for(const t of trs)t.score=scoreFn?scoreFn(t)+Math.random()*1e-9:Math.random();const p=pf(trs,o);A.push(p.cagr);D.push(p.mdd);if(scoreFn&&i>=20)break;}return [q(A,.5),q(D,.5)];}
module.exports={E,load,trades,pf,mc,q,f};
