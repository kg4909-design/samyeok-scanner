// 영상 기법: 횡보 후 첫 장대양봉 / 거래량 마른 조정 뒤 거래량 실린 반등 양봉(변곡점) 종가 매수
const E=require('/home/claude/engine.js');const fs=require('fs');const {smaX,simCustom}=E._h;
const M=process.argv[2];const SP='/tmp/claude-0/-home-claude/75ca9259-01a1-5a33-9e25-571cf86f9a0b/scratchpad/';
const d=JSON.parse(fs.readFileSync(SP+'ds2/data/'+M+'.json'));
let st=d.stocks.filter(s=>M!=='KR'||s.symbol.endsWith('0')).map(s=>({symbol:s.symbol,market:M,bars:s.bars})).filter(s=>s.bars.length>=260);
if(M==='US')st=st.filter(s=>!['GOOG','FOX','NWS'].includes(s.symbol));E.attachRS(st,null);
const cfg=E.DEFAULT_CFG;const inds=st.map(s=>{const i=E.compute(s.bars);i._mk=M;i._sym=s.symbol;return i;});
const cost=(M==='KR'?cfg.costKR:cfg.costUS)/100;
let minD='9999',maxD='0';for(const ind of inds){const a=ind.dates[253];if(a&&a<minD)minD=a;const b=ind.dates.at(-1);if(b>maxD)maxD=b;}
const split=new Date(new Date(minD).getTime()+(new Date(maxD)-new Date(minD))*0.7).toISOString().slice(0,10);
const q=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(p*(s.length-1))];};const f=x=>(x*100).toFixed(1).padStart(6);
const avgV=(ind,a,b)=>{let s=0;for(let k=a;k<=b;k++)s+=ind.v[k];return s/(b-a+1);};
// 장대양봉: +chg 이상, 거래량 vm배 이상, 직전 N일 횡보(고저폭 <= box), 직전 60일 안에 다른 장대양봉 없음(첫 번째)
function bigs(ind,o){return E._h.X(ind,'vb'+JSON.stringify(o),()=>{const n=ind.c.length,B=new Array(n).fill(false);
 for(let t=70;t<n;t++){const chg=ind.c[t]/ind.c[t-1]-1;if(!(chg>=o.chg&&ind.c[t]>ind.o[t]&&ind.v[t]>=o.vm*ind.volAvg20[t-1]))continue;
  let hi=-1e18,lo=1e18;for(let k=t-o.N;k<t;k++){hi=Math.max(hi,ind.h[k]);lo=Math.min(lo,ind.l[k]);}
  if(o.box&&(hi/lo-1)>o.box)continue; if(o.brk&&!(ind.c[t]>hi))continue;
  let first=true;for(let k=t-60;k<t;k++){const c2=ind.c[k]/ind.c[k-1]-1;if(c2>=o.chg&&ind.v[k]>=o.vm*ind.volAvg20[k-1]){first=false;break;}}
  if(o.first&&!first)continue;B[t]=true;}return B;});}
// 변곡점: 장대양봉(b) 뒤 2~maxD일 조정(그 동안 종가가 장대양봉 종가 아래로, 평균 거래량 <= dry*장대양봉 거래량), 오늘 양봉 + 전일보다 상승 + 거래량 >= surge*조정기 평균
function pivot(ind,t,o){const B=bigs(ind,o);for(let b=t-2;b>=t-o.maxD;b--){if(b<70||!B[b])continue;
  const pb=[b+1,t-1];if(pb[1]-pb[0]+1<o.minPb)continue;
  // 조정: 조정기 최고 종가 < 장대양봉 종가 기준 고점, 조정기 마지막 종가가 장대양봉 종가보다 낮음
  if(!(ind.c[t-1]<ind.c[b]))continue;
  let lowest=1e18;for(let k=pb[0];k<=pb[1];k++)lowest=Math.min(lowest,ind.l[k]);
  if(o.hold&&lowest<ind.o[b])continue;   // 장대양봉 시가 아래로 깨지면 실패
  const dv=avgV(ind,pb[0],pb[1]);if(!(dv<=o.dry*ind.v[b]))continue;
  if(!(ind.c[t]>ind.o[t]&&ind.c[t]>ind.c[t-1]&&ind.v[t]>=o.surge*dv))continue;
  if(o.ma10&&!(ind.c[t]>smaX(ind,10)[t]))continue;
  return b;}return -1;}
// 종가 매수 시뮬레이션: 손절 = 변곡점 양봉 저가(또는 %) · 종가가 maN일선 아래면 다음 날 시가 매도 · cap
function simClose(ind,t,o){const n=ind.c.length;if(t+1>=n)return null;const entry=o.nextOpen?ind.o[t+1]:ind.c[t];const f=o.nextOpen?t+1:t+1;
 let sl=o.stopPct?entry*(1-o.stopPct):Math.min(ind.l[t],ind.l[t-1]);if(o.stopMax&&sl<entry*(1-o.stopMax))sl=entry*(1-o.stopMax);if(!(entry>sl))return null;const R=entry-sl;const S=smaX(ind,o.maN);let be=false,stop=sl;
 for(let j=f;j<n;j++){if(o.be&&be)stop=Math.max(stop,entry);if(ind.l[j]<=stop){const px=ind.o[j]<stop?ind.o[j]:stop;return{entryIdx:o.nextOpen?t+1:t,exitIdx:j,entry,R,r:(px-entry-cost*entry)/R};}
  if(o.be&&ind.h[j]>=entry*o.be)be=true;
  if(ind.c[j]<S[j]){if(j+1<n)return{entryIdx:t,exitIdx:j+1,entry,R,r:(ind.o[j+1]-entry-cost*entry)/R};return{open:true};}
  if(o.cap&&j-t>=o.cap)return{entryIdx:t,exitIdx:j,entry,R,r:(ind.c[j]-entry-cost*entry)/R};}
 return{open:true};}
function evalTrades(sig,sim,label){const tr=[];for(const ind of inds){let next=0;for(let t=253;t<ind.c.length-1;t++){if(t<next)continue;const s=sig(ind,t);if(s<0||s===false)continue;const r=sim(ind,t);if(!r||r.skipped)continue;if(r.open){next=1e9;continue;}
  tr.push({symbol:ind._sym,entryDate:ind.dates[r.entryIdx],exitDate:ind.dates[r.exitIdx],r:r.r,R:r.R,entry:r.entry});next=r.exitIdx+1;}}
 return report(tr,label);}
function report(tr,label){const A=[],D=[],I=[],O=[];const seed=M==='KR'?1e6:735;
 for(let k=0;k<200;k++){for(const t of tr)t.score=Math.random();const o={seed,riskPct:1,capPct:30,maxPos:3,fractional:M==='US'};const p=E.portfolio(tr,o);A.push(p.cagr);D.push(p.mdd);I.push(E.portfolio(tr.filter(t=>t.entryDate<split),o).cagr);O.push(E.portfolio(tr.filter(t=>t.entryDate>=split),o).cagr);}
 const rs=tr.map(t=>t.r),m=rs.reduce((a,b)=>a+b,0)/(rs.length||1),sd=Math.sqrt(rs.reduce((a,b)=>a+(b-m)**2,0)/(rs.length-1||1));const win=rs.filter(x=>x>0).length/(rs.length||1);
 const yr={};for(const t of tr){const y=t.entryDate.slice(0,4);(yr[y]=yr[y]||[]).push(t.r);}
 console.log(label.padEnd(44),String(tr.length).padStart(4),m.toFixed(2).padStart(6),('t'+(m/sd*Math.sqrt(rs.length)).toFixed(2)).padStart(7),(win*100).toFixed(0).padStart(4)+'%','|',f(q(A,.5)),f(q(I,.5)),f(q(O,.5)),'|',f(q(D,.5)),'|',Object.keys(yr).sort().map(y=>y.slice(2)+':'+(yr[y].reduce((a,b)=>a+b,0)/yr[y].length).toFixed(2)).join(' '));return tr;}
console.log(M,'기간',minD,'~',maxD,'앞/뒤 나눔',split);
console.log('전략'.padEnd(44),'거래','평균R','  t값',' 승률','| 연수익 전체   앞     뒤  |  MDD  | 연도별 평균R');
// 비교: 지금 전략
{const key=M==='KR'?'pro|minervini':'pro|pullback5';const S=E.strat(key);evalTrades((ind,t)=>{const e=S.evaluate(ind,t,cfg);return e.ready&&e.conds.every(Boolean)?1:-1;},(ind,t)=>simCustom(ind,t,S,M,cfg),'[지금] '+S.short);
 const S2=E.strat(M==='KR'?'pro|pullback5':'pro|minervini');evalTrades((ind,t)=>{const e=S2.evaluate(ind,t,cfg);return e.ready&&e.conds.every(Boolean)?1:-1;},(ind,t)=>simCustom(ind,t,S2,M,cfg),'[참고] '+S2.short);}
const chg=M==='KR'?0.07:0.05;
const BO={chg,vm:2,N:40,box:0.25,brk:true,first:true};
// 1) 첫 장대양봉 당일 종가/다음날 시가 추격
for(const ex of [{maN:10},{maN:20}]){evalTrades((ind,t)=>bigs(ind,BO)[t]?1:-1,(ind,t)=>simClose(ind,t,Object.assign({stopPct:0.07,cap:60},ex)),'첫 장대양봉 종가 매수 · 손절7% · '+ex.maN+'일선 이탈');}
// 2) 변곡점 기본형
const PV=Object.assign({},BO,{maxD:12,minPb:2,dry:0.5,surge:1.5,hold:true});
for(const ex of [{maN:10},{maN:20},{maN:10,stopMax:0.08},{maN:20,stopMax:0.08,be:1.1}])
 evalTrades((ind,t)=>pivot(ind,t,PV),(ind,t)=>simClose(ind,t,Object.assign({cap:60},ex)),'변곡점 종가 · 손절=양봉저가'+(ex.stopMax?'(최대8%)':'')+' · '+ex.maN+'일선'+(ex.be?' · 본절10%':''));
evalTrades((ind,t)=>pivot(ind,t,PV),(ind,t)=>simClose(ind,t,{maN:10,cap:60,nextOpen:true}),'변곡점 다음날 시가 · 10일선');
evalTrades((ind,t)=>pivot(ind,t,Object.assign({},PV,{ma10:true})),(ind,t)=>simClose(ind,t,{maN:10,cap:60}),'변곡점 + 10일선 위 · 10일선');
// 3) 조건 민감도
for(const [nm,o] of [['횡보 조건 없음',{box:0}],['횡보 15%',{box:0.15}],['횡보 35%',{box:0.35}],['신고가 돌파 조건 없음',{brk:false}],['첫번째 조건 없음',{first:false}],['거래량 3배',{vm:3}],['마름 0.35',{dry:0.35}],['마름 0.7',{dry:0.7}],['반등 거래량 1.2',{surge:1.2}],['반등 거래량 2',{surge:2}],['조정 1일 이상',{minPb:1}],['조정 20일까지',{maxD:20}],['장대양봉 기준 '+(chg*100+3)+'%',{chg:chg+0.03}]])
 evalTrades((ind,t)=>pivot(ind,t,Object.assign({},PV,o)),(ind,t)=>simClose(ind,t,{maN:10,cap:60}),'  변곡점 · '+nm);
if(process.argv[3]==='top'){const tr=evalTrades((ind,t)=>pivot(ind,t,PV),(ind,t)=>simClose(ind,t,{maN:10,cap:60}),'변곡점 기본');const s=[...tr].sort((a,b)=>b.r-a.r);console.log('상위5',s.slice(0,5).map(t=>t.symbol+' '+t.entryDate+' '+t.r.toFixed(1)+'R').join(', '));const rs=tr.map(t=>t.r).sort((a,b)=>a-b);console.log('중앙값',rs[rs.length>>1].toFixed(2));report(s.slice(1),'최고 1건 빼면');report(s.slice(2),'최고 2건 빼면');}
