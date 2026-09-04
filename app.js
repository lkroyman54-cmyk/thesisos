const STORAGE_KEY = "thesisos_v2";
const LEGACY_KEY = "thesisos_v1";
let investments = loadInvestments();
let activeFilter = "all";
let currentResearch = null;
let currentResearchTicker = "";
let filingIntel = {};

const $ = id => document.getElementById(id);
const esc = (s="") => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const lines = (s="") => String(s).split(/\n+/).map(x => x.replace(/^[-•\d.)\s]+/,"").trim()).filter(Boolean);

function loadInvestments(){
  try {
    const v2 = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if(Array.isArray(v2)) return v2;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
    if(Array.isArray(legacy) && legacy.length){ localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy)); return legacy; }
  } catch(e){}
  return [];
}
function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(investments)); renderAll(); }
function nowISO(){ return new Date().toISOString(); }
function fmtTime(iso){ if(!iso) return "Never"; const d=new Date(iso); const mins=Math.floor((Date.now()-d.getTime())/60000); if(mins<1) return "Just now"; if(mins<60) return `${mins}m ago`; const h=Math.floor(mins/60); if(h<24) return `${h}h ago`; const days=Math.floor(h/24); if(days<7) return `${days}d ago`; return d.toLocaleDateString(); }
function toast(message, label="THESISOS"){
  const el=document.createElement("div"); el.className="toast"; el.innerHTML=`<strong>${esc(label)}</strong>${esc(message)}`; $("toastHost").appendChild(el);
  setTimeout(()=>el.remove(), 3300);
}
function setView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active-view"));
  const target = name==="research" ? $("researchView") : name==="library" ? $("libraryView") : $("dashboardView");
  target.classList.add("active-view");
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.toggle("active", n.dataset.view===name));
  if(name==="library") renderLibrary();
  window.scrollTo({top:0,behavior:"smooth"});
}

function openModal(id){ $(id).classList.remove("hidden"); }
function closeModal(id){ $(id).classList.add("hidden"); }
function resetThesisForm(){
  $("thesisForm").reset(); $("editingId").value=""; $("conviction").value=80; $("convictionValue").textContent="80"; $("thesisModalTitle").textContent="Define what must be true.";
}
function openThesisModal(prefill={}){
  resetThesisForm();
  $("ticker").value=(prefill.ticker||"").toUpperCase(); $("company").value=prefill.company||"";
  if(prefill.id){
    $("editingId").value=prefill.id; $("thesis").value=prefill.thesis||""; $("breakers").value=prefill.breakers||""; $("conviction").value=prefill.score??80; $("convictionValue").textContent=prefill.score??80; $("thesisModalTitle").textContent=`Edit ${prefill.ticker} thesis.`;
  }
  openModal("thesisModal"); setTimeout(()=>$(prefill.ticker?"thesis":"ticker").focus(),50);
}

async function openResearch(ticker, force=false){
  ticker=String(ticker||"").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g,"");
  if(!ticker) return;
  currentResearchTicker=ticker; $("researchTicker").value=ticker; setView("research");
  $("researchEmpty").classList.add("hidden"); $("researchContent").classList.add("hidden"); $("researchLoading").classList.remove("hidden");
  try{
    const resp=await fetch(`/api/company?ticker=${encodeURIComponent(ticker)}${force?`&_=${Date.now()}`:""}`);
    const data=await resp.json(); if(!resp.ok) throw new Error(data.error||"Could not load SEC evidence.");
    currentResearch=data; filingIntel={}; renderResearch(data); $("researchLoading").classList.add("hidden"); $("researchContent").classList.remove("hidden");
    rememberRecent(ticker); loadMarketContext(ticker);
  }catch(err){
    $("researchLoading").classList.add("hidden"); $("researchEmpty").classList.remove("hidden");
    $("researchEmpty").innerHTML=`<p class="eyebrow">RESEARCH ERROR</p><h2>${esc(ticker)} could not be opened.</h2><p>${esc(err.message)}</p>`;
    toast(err.message,"ERROR");
  }
}

function compactNumber(v, unit=""){
  if(v===null||v===undefined||Number.isNaN(Number(v))) return "—";
  const n=Number(v), a=Math.abs(n); let out;
  if(a>=1e12) out=(n/1e12).toFixed(a>=10e12?1:2)+"T";
  else if(a>=1e9) out=(n/1e9).toFixed(a>=10e9?1:2)+"B";
  else if(a>=1e6) out=(n/1e6).toFixed(a>=10e6?1:2)+"M";
  else if(a>=1e3) out=(n/1e3).toFixed(a>=10e3?1:2)+"K";
  else out=Math.abs(n)<10?n.toFixed(2):n.toFixed(0);
  if(unit==="USD") return "$"+out;
  if(unit==="USD/shares"||unit==="USD-per-shares") return "$"+Number(n).toFixed(2);
  return out;
}
function changeHtml(m){
  if(!m || m.changePct===undefined || !Number.isFinite(Number(m.changePct))) return `<span class="metric-change neutral">latest</span>`;
  const v=Number(m.changePct), cls=v>0?"up":v<0?"down":"neutral";
  return `<span class="metric-change ${cls}">${v>0?"+":""}${v.toFixed(1)}%</span>`;
}
function metricCard(label,m){
  if(!m) return `<article class="metric-card muted-metric"><small>${esc(label)}</small><strong>—</strong><span>not standardized</span></article>`;
  return `<article class="metric-card"><small>${esc(label)}</small><strong>${esc(compactNumber(m.value,m.unit))}</strong>${changeHtml(m)}<span>${esc(((m.form||"")+" · "+(m.end||"")).replace(/^ · /,""))}</span></article>`;
}
function renderFundamentals(data){
  const f=data.financials||{};
  const cards=[["Revenue",f.revenue],["Net income",f.netIncome],["Operating cash flow",f.operatingCashFlow],["Cash",f.cash],["Assets",f.assets],["Liabilities",f.liabilities],["R&D",f.rd],["Diluted EPS",f.epsDiluted]];
  $("metricCards").innerHTML=cards.map(x=>metricCard(x[0],x[1])).join("");
  const pr=data.profile||{}, chips=[];
  if(pr.exchanges?.[0]) chips.push(pr.exchanges[0]); if(pr.industry) chips.push(pr.industry); if(pr.fiscalYearEnd) chips.push(`FY ${pr.fiscalYearEnd}`);
  $("profileChips").innerHTML=chips.slice(0,3).map(x=>`<span>${esc(x)}</span>`).join("");
}
function renderInsiders(data){
  const rows=data.insiders||[];
  $("insiderList").innerHTML=rows.length?rows.map((f,i)=>`<article class="filing-row insider-row"><span class="form-badge">${esc(f.form)}</span><span class="filing-date">${esc(f.filingDate)}</span><div class="filing-doc"><strong>${i===0?"Latest ownership filing":"Insider ownership filing"}</strong><small>Report date ${esc(f.reportDate||"—")} · accession ${esc(f.accessionNumber||"—")}</small></div><a class="open-link" href="${esc(f.url)}" target="_blank" rel="noreferrer">Open ↗</a></article>`).join(""):`<div class="evidence-item">No recent Form 4 filings found in the current SEC submission window.</div>`;
}

function pct(v){ if(v===null||v===undefined||!Number.isFinite(Number(v))) return "—"; const n=Number(v); return `${n>0?"+":""}${n.toFixed(1)}%`; }
function marketCard(label,value,detail=""){ return `<article class="market-card"><small>${esc(label)}</small><strong>${esc(value)}</strong><span>${esc(detail)}</span></article>`; }
async function loadMarketContext(ticker){
  $("marketSource").textContent="loading delayed market data…"; $("marketCards").innerHTML='<div class="skeleton slim"></div>';
  try{ const r=await fetch(`/api/market?ticker=${encodeURIComponent(ticker)}`); const m=await r.json(); if(!r.ok) throw new Error(m.error||"Market data unavailable"); if(!currentResearch||currentResearch.ticker!==ticker)return; currentResearch.market=m; $("marketSource").textContent=`${m.source||"Delayed market data"} · ${m.asOf||"—"}`; const pos=Number.isFinite(Number(m.rangePosition))?`${Number(m.rangePosition).toFixed(0)}% of 52w range`:"—"; $("marketCards").innerHTML=[marketCard("Last close",m.price?`$${Number(m.price).toFixed(2)}`:"—",m.asOf||""),marketCard("1 week",pct(m.weekPct),"price change"),marketCard("1 month",pct(m.monthPct),"price change"),marketCard("3 months",pct(m.threeMonthPct),"price change"),marketCard("52w range",m.low52w&&m.high52w?`$${Number(m.low52w).toFixed(2)} – $${Number(m.high52w).toFixed(2)}`:"—",pos)].join(""); $("marketNarrative").textContent=`Current price is ${pos}. Filing cards can now show the delayed 1/3/5-session price reaction around each filing date. Reaction is context—not proof that the filing caused the move.`; }
  catch(e){ if(currentResearch) currentResearch.market=null; $("marketSource").textContent="market layer unavailable"; $("marketCards").innerHTML=marketCard("Market context","Unavailable","SEC intelligence still works"); $("marketNarrative").textContent="The SEC research layer is fully available. The optional delayed market-price layer could not be reached."; }
}
function reactionHtml(r){ if(!r)return `<span class="reaction neutral">reaction unavailable</span>`; return `<span class="reaction ${Number(r.fiveDayPct)>=0?"positive":"negative"}">1D ${esc(pct(r.oneDayPct))} · 3D ${esc(pct(r.threeDayPct))} · 5D ${esc(pct(r.fiveDayPct))}</span>`; }
function intelBody(a){ const risks=a.risks||[],cats=a.catalysts||[],watch=a.watch_next||[],nums=a.key_numbers||[]; return `<div class="intel-summary"><div><span class="materiality ${esc(String(a.materiality||"MEDIUM").toLowerCase())}">${esc(a.materiality||"MEDIUM")}</span><span class="thesis-impact">${esc((a.thesis_impact||"NEEDS REVIEW").replaceAll("_"," "))}</span></div><h3>${esc(a.headline||"Filing intelligence")}</h3><p>${esc(a.plain_english||"")}</p></div><div class="intel-grid"><div><small>WHY IT MATTERS</small><p>${esc(a.why_it_matters||"—")}</p></div><div><small>MARKET CONTEXT</small><p>${esc(a.market_context||"—")}</p>${reactionHtml(a.reaction)}</div><div><small>MANAGEMENT SIGNAL</small><p>${esc(a.management_signal||"—")}</p></div><div><small>CAPITAL STRUCTURE</small><p>${esc(a.capital_structure||"—")}</p></div></div>${nums.length?`<div class="intel-tags"><small>KEY NUMBERS</small>${nums.map(v=>`<span>${esc(v)}</span>`).join("")}</div>`:""}<div class="intel-columns"><div><small>RISKS</small>${risks.length?risks.map(v=>`<p>− ${esc(v)}</p>`).join(""):`<p>No new material risk identified.</p>`}</div><div><small>CATALYSTS</small>${cats.length?cats.map(v=>`<p>+ ${esc(v)}</p>`).join(""):`<p>No explicit catalyst identified.</p>`}</div><div><small>WATCH NEXT</small>${watch.map(v=>`<p>→ ${esc(v)}</p>`).join("")||`<p>Monitor next primary-source update.</p>`}</div></div>`; }
async function analyzeFiling(index,quiet=false){ const f=currentResearch?.filings?.[index]; if(!f)return; const box=$(`intel-${index}`),btn=$(`analyze-${index}`); if(box){box.classList.remove("hidden");box.innerHTML='<div class="intel-loading"><span></span> Reading the full filing and building context…</div>';} if(btn)btn.disabled=true; const saved=investments.find(x=>x.ticker===currentResearch.ticker); try{ const r=await fetch('/api/filing-intel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticker:currentResearch.ticker,filing:f,thesis:saved?.thesis||'',breakers:saved?.breakers||'',market:currentResearch.market||null})}); const out=await r.json(); if(!r.ok)throw new Error(out.error||'Filing analysis failed'); if(box)box.innerHTML=intelBody(out.analysis); if(btn)btn.textContent='Refresh analysis'; if(!quiet)toast(`${f.form} dissected.`,out.ai?'AI INTELLIGENCE':'RULE SCAN'); return true;}catch(e){if(box)box.innerHTML=`<div class="intel-error">${esc(e.message)}</div>`;if(!quiet)toast(e.message,'ERROR');return false;}finally{if(btn)btn.disabled=false;} }
async function deepScanFilings(){ const files=(currentResearch?.filings||[]).slice(0,8); if(!files.length)return; const btn=$("deepScanBtn"),status=$("deepScanStatus");btn.disabled=true;status.classList.remove("hidden");let ok=0;for(let i=0;i<files.length;i++){status.textContent=`Deep scan ${i+1}/${files.length} · ${files[i].form} filed ${files[i].filingDate}`;if(await analyzeFiling(i,true))ok++;}status.textContent=`Deep scan complete · ${ok}/${files.length} filings dissected.`;btn.disabled=false;toast(`${ok} filings dissected.`,'DEEP SCAN');}

function renderResearch(data){
  const filings=data.filings||[];
  renderFundamentals(data);
  renderInsiders(data);
  $("researchTickerLabel").textContent=data.ticker||currentResearchTicker;
  $("researchCompany").textContent=data.company||data.ticker||currentResearchTicker;
  const pr=data.profile||{};
  $("researchMeta").textContent=[`CIK ${String(data.cik||"").padStart(10,"0")}`, ...(pr.exchanges||[]).slice(0,1), pr.industry, "SEC EDGAR + XBRL"].filter(Boolean).join(" · ");
  $("researchFilingCount").textContent=filings.length;
  $("researchUpdated").textContent=`Retrieved ${new Date().toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})}`;
  $("filingList").innerHTML=filings.length ? filings.map((f,i)=>`<article class="filing-intel-row"><div class="filing-row"><span class="form-badge">${esc(f.form)}</span><span class="filing-date">${esc(f.filingDate)}</span><div class="filing-doc"><strong>${i===0?"Latest material filing":esc(f.primaryDocument||"SEC filing")}</strong><small>Report date ${esc(f.reportDate||"—")} · accession ${esc(f.accessionNumber||"—")}</small></div><div class="filing-actions"><button class="analyze-link" id="analyze-${i}" onclick="analyzeFiling(${i})">Dissect</button><a class="open-link" href="${esc(f.url)}" target="_blank" rel="noreferrer">Source ↗</a></div></div><div id="intel-${i}" class="filing-analysis hidden"></div></article>`).join("") : `<div class="evidence-item">No recent material SEC filings found.</div>`;
  const existing=investments.find(x=>x.ticker===data.ticker);
  if(existing){
    $("existingThesisTitle").textContent=existing.statusText||"Thesis saved"; $("existingThesisScore").textContent=existing.score; $("existingThesisText").textContent=lines(existing.thesis)[0]||"Saved thesis";
    $("existingThesisAction").textContent="Open thesis"; $("saveThesisFromResearch").textContent="Open thesis";
  }else{
    $("existingThesisTitle").textContent="Not saved"; $("existingThesisScore").textContent="—"; $("existingThesisText").textContent="Create a thesis when this company earns a place on your watchtower.";
    $("existingThesisAction").textContent="Create thesis"; $("saveThesisFromResearch").textContent="Save thesis";
  }
}
function researchToThesis(){
  if(!currentResearch) return;
  const existing=investments.find(x=>x.ticker===currentResearch.ticker);
  if(existing) viewThesis(existing.id); else openThesisModal({ticker:currentResearch.ticker,company:currentResearch.company});
}
function copyResearchBrief(){
  if(!currentResearch) return;
  const fs=(currentResearch.filings||[]).slice(0,6).map(f=>`${f.form} — ${f.filingDate} — ${f.url}`).join("\n");
  const f=currentResearch.financials||{};
  const metrics=[["Revenue",f.revenue],["Net income",f.netIncome],["Operating cash flow",f.operatingCashFlow],["Cash",f.cash],["Assets",f.assets],["Liabilities",f.liabilities],["R&D",f.rd],["Diluted EPS",f.epsDiluted]].filter(x=>x[1]).map(([k,m])=>`${k}: ${compactNumber(m.value,m.unit)} (${m.form||""} ${m.end||""})`).join("\n");
  const text=`THESISOS RESEARCH BRIEF\n${currentResearch.ticker} — ${currentResearch.company}\nCIK: ${currentResearch.cik}\nIndustry: ${currentResearch.profile?.industry||"—"}\n\nLatest reported fundamentals:\n${metrics||"No standardized XBRL metrics available."}\n\nLatest material SEC filings:\n${fs}\n\nAnalyze these primary sources for material changes, management language changes, risks, catalysts, dilution, KPI trends, and anything that could strengthen or weaken a long-term investment thesis.`;
  navigator.clipboard.writeText(text).then(()=>toast("Research brief copied for Claude or your group.","COPIED")).catch(()=>toast("Clipboard permission unavailable.","ERROR"));
}

function renderAll(){ renderDashboard(); if($("libraryView").classList.contains("active-view")) renderLibrary(); if(currentResearch) renderResearch(currentResearch); renderRecentPalette(); }
function renderDashboard(){
  const cards=$("cards"), empty=$("emptyState"); empty.classList.toggle("hidden",investments.length>0);
  const filtered=investments.filter(x=>activeFilter==="all"||(activeFilter==="changed"&&x.status!=="healthy")||(activeFilter==="healthy"&&x.status==="healthy"));
  cards.innerHTML=filtered.map(cardHtml).join("");
  const avg=investments.length?Math.round(investments.reduce((a,b)=>a+Number(b.score||0),0)/investments.length):null;
  $("portfolioScore").textContent=avg===null?"—":avg; $("orbValue").textContent=avg===null?"0":avg;
  $("portfolioCaption").textContent=avg===null?"Initialize your first thesis.":`${investments.length} thesis${investments.length===1?"":"es"} under active monitoring.`;
  $("activeCount").textContent=investments.length; $("changedCount").textContent=investments.filter(x=>x.status!=="healthy").length;
  const latest=investments.map(x=>x.lastChecked).filter(Boolean).sort().reverse()[0]; $("lastPortfolioCheck").textContent=latest?fmtTime(latest):"—";
}
function cardHtml(x){
  const pts=lines(x.thesis).slice(0,3).map(v=>`<li>${esc(v)}</li>`).join("");
  return `<article class="thesis-card ${esc(x.status||"healthy")}"><div class="card-top"><div><div class="ticker-name">${esc(x.ticker)}</div><div class="company-name">${esc(x.company||"Tracked investment")}</div></div><div class="card-score">${Number(x.score||0)}<small>/100</small></div></div>
  <div class="status-row"><span class="status-pill">${esc(x.statusText||"Thesis established")}</span><span class="checked-time">${x.lastChecked?fmtTime(x.lastChecked):"Not checked"}</span></div>
  <h4>Core thesis</h4><ul class="thesis-points">${pts||"<li>No thesis points yet.</li>"}</ul>
  <div class="card-actions"><button class="btn primary" onclick="checkThesis('${x.id}')">Check thesis</button><button class="tiny-btn" title="Open research" onclick="openResearch('${esc(x.ticker)}')">⌕</button><button class="tiny-btn" title="More" onclick="viewThesis('${x.id}')">•••</button></div></article>`;
}
function renderLibrary(){
  const host=$("libraryList");
  host.innerHTML=investments.length?investments.map(x=>`<article class="library-row"><div><strong>${esc(x.ticker)}</strong><p>${esc(x.company||"Tracked investment")}</p></div><div><span class="library-meta">${esc(lines(x.thesis)[0]||"No summary")} · Score ${x.score}/100 · ${x.lastChecked?`checked ${fmtTime(x.lastChecked)}`:"not checked"}</span></div><div class="library-buttons"><button class="btn secondary" onclick="openResearch('${esc(x.ticker)}')">Research</button><button class="btn secondary" onclick="editThesis('${x.id}')">Edit</button></div></article>`).join(""):`<div class="empty-state"><div><p class="eyebrow">EMPTY LIBRARY</p><h3>No saved theses yet.</h3></div></div>`;
}

function viewThesis(id){
  const x=investments.find(i=>i.id===id); if(!x) return;
  $("analysisTitle").textContent=`${x.ticker} thesis file`;
  $("analysisContent").innerHTML=`<div class="analysis-summary"><div class="analysis-verdict">${esc(x.statusText||"THESIS SAVED")}</div><p>${esc(x.company||x.ticker)} · conviction ${x.score}/100</p></div>
  <div class="analysis-grid"><section class="analysis-section"><h4>Why I own it</h4>${lines(x.thesis).map(v=>`<div class="evidence-item">${esc(v)}</div>`).join("")}</section><section class="analysis-section"><h4>What breaks it</h4>${(lines(x.breakers).length?lines(x.breakers):["No thesis breakers defined."]).map(v=>`<div class="evidence-item">${esc(v)}</div>`).join("")}</section></div>
  ${x.lastAnalysis?`<section class="analysis-section" style="margin-top:10px"><h4>Last AI read</h4><div class="evidence-item">${esc(x.lastAnalysis.summary||"")}</div></section>`:""}
  <div class="modal-actions"><button class="btn secondary" onclick="removeThesis('${x.id}')">Delete</button><button class="btn secondary" onclick="closeModal('analysisModal');editThesis('${x.id}')">Edit thesis</button><button class="btn primary" onclick="closeModal('analysisModal');checkThesis('${x.id}')">Check evidence</button></div>`;
  openModal("analysisModal");
}
function editThesis(id){ const x=investments.find(i=>i.id===id); if(x) openThesisModal(x); }
function removeThesis(id){ if(confirm("Delete this thesis file?")){ investments=investments.filter(x=>x.id!==id); save(); closeModal("analysisModal"); toast("Thesis removed."); } }

async function checkThesis(id){
  const x=investments.find(i=>i.id===id); if(!x) return;
  $("analysisTitle").textContent=`${x.ticker} evidence check`;
  $("analysisContent").innerHTML=`<div class="analysis-summary"><div class="analysis-verdict">READING PRIMARY SOURCES…</div><p>Comparing the latest SEC evidence with your saved thesis.</p></div><div class="skeleton"></div>`;
  openModal("analysisModal");
  try{
    const filingsResp=await fetch(`/api/sec?ticker=${encodeURIComponent(x.ticker)}`); const sec=await filingsResp.json(); if(!filingsResp.ok) throw new Error(sec.error||"Could not retrieve SEC filings.");
    const analysisResp=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker:x.ticker,thesis:x.thesis,breakers:x.breakers,filings:sec.filings})});
    const result=await analysisResp.json(); if(!analysisResp.ok) throw new Error(result.error||"Analysis failed.");
    x.lastChecked=nowISO();
    if(result.ai){
      const a=result.analysis||{}; const verdict=String(a.verdict||"UNCHANGED").toUpperCase(); x.score=Math.max(0,Math.min(100,Number(a.score??x.score))); x.status=verdict==="BROKEN"?"bad":verdict==="WEAKER"?"changed":"healthy"; x.statusText=verdict==="STRONGER"?"Thesis strengthened":verdict==="WEAKER"?"Material change":verdict==="BROKEN"?"Thesis at risk":"Thesis intact"; x.lastAnalysis=a; showAIAnalysis(x,a,sec.filings);
    }else{ x.status="healthy"; x.statusText="Filings checked"; showNoAI(x,sec.filings,result.message); }
    save();
  }catch(err){ $("analysisContent").innerHTML=`<div class="analysis-summary"><div class="analysis-verdict broken">CHECK FAILED</div><p>${esc(err.message)}</p></div>`; }
}
function sourceRows(filings=[]){ return filings.slice(0,6).map(f=>`<div class="evidence-item"><strong>${esc(f.form)}</strong> · ${esc(f.filingDate)} · <a href="${esc(f.url)}" target="_blank" rel="noreferrer" style="color:var(--blue)">Open SEC source ↗</a></div>`).join("")||`<div class="evidence-item">No recent material filings.</div>`; }
function showNoAI(x,filings,message){
  $("analysisContent").innerHTML=`<div class="analysis-summary"><div class="analysis-verdict">EVIDENCE RETRIEVED</div><p>${esc(message||"AI analysis is off until OPENAI_API_KEY is set.")}</p></div><div class="analysis-grid"><section class="analysis-section"><h4>Latest material filings</h4>${sourceRows(filings)}</section><section class="analysis-section"><h4>System status</h4><div class="evidence-item">SEC pipeline is working.</div><div class="evidence-item">Add OPENAI_API_KEY before launching the server to enable thesis-specific analysis.</div></section></div>`;
}
function showAIAnalysis(x,a,filings){
  const verdict=String(a.verdict||"UNCHANGED").toLowerCase();
  $("analysisContent").innerHTML=`<div class="analysis-summary"><div class="analysis-verdict ${esc(verdict)}">${esc(String(a.verdict||"UNCHANGED").toUpperCase())} · ${x.score}/100</div><p>${esc(a.summary||"")}</p></div>
  <div class="analysis-grid"><section class="analysis-section"><h4>What changed</h4>${(a.changes||[]).map(v=>`<div class="evidence-item">${esc(v)}</div>`).join("")||`<div class="evidence-item">No material thesis change identified.</div>`}</section><section class="analysis-section"><h4>Risks / thesis pressure</h4>${(a.risks||[]).map(v=>`<div class="evidence-item">${esc(v)}</div>`).join("")||`<div class="evidence-item">No new breaker-level evidence identified.</div>`}</section><section class="analysis-section"><h4>Watch next</h4>${(a.watch_next||[]).map(v=>`<div class="evidence-item">${esc(v)}</div>`).join("")}</section><section class="analysis-section"><h4>Primary sources</h4>${sourceRows(filings)}</section></div>`;
}

function exportLibrary(){
  const payload={product:"ThesisOS",version:2,exportedAt:nowISO(),investments}; const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`thesisos-library-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url); toast("Research library exported.","BACKUP");
}
function importLibrary(file){
  const reader=new FileReader(); reader.onload=()=>{ try{ const parsed=JSON.parse(reader.result); const list=Array.isArray(parsed)?parsed:parsed.investments; if(!Array.isArray(list)) throw new Error("No ThesisOS investments found."); investments=list; save(); toast(`${list.length} thesis files imported.`,"IMPORT"); }catch(e){toast(e.message,"ERROR");}}; reader.readAsText(file);
}
function rememberRecent(ticker){ const key="thesisos_recent"; let r=[]; try{r=JSON.parse(localStorage.getItem(key)||"[]");}catch(e){} r=[ticker,...r.filter(x=>x!==ticker)].slice(0,6); localStorage.setItem(key,JSON.stringify(r)); renderRecentPalette(); }
function renderRecentPalette(){ let r=[]; try{r=JSON.parse(localStorage.getItem("thesisos_recent")||"[]");}catch(e){} $("paletteRecent").innerHTML=r.length?`<div class="palette-label">RECENT TICKERS</div>${r.map(t=>`<button class="palette-item" onclick="closeModal('commandPalette');openResearch('${esc(t)}')"><span>↗</span><div><strong>${esc(t)}</strong><small>Open research workspace</small></div></button>`).join("")}`:""; }

// Events
$("homeBtn").onclick=()=>setView("dashboard");
document.querySelectorAll(".nav-item").forEach(n=>n.onclick=()=>setView(n.dataset.view));
$("addBtn").onclick=()=>openThesisModal();
$("emptyResearchBtn").onclick=()=>{ $("quickTicker").focus(); window.scrollTo({top:0,behavior:"smooth"}); };
$("tickerCommand").onsubmit=e=>{e.preventDefault();openResearch($("quickTicker").value)};
$("researchSearch").onsubmit=e=>{e.preventDefault();openResearch($("researchTicker").value)};
$("backBtn").onclick=()=>setView("dashboard");
$("refreshResearchBtn").onclick=()=>currentResearchTicker&&openResearch(currentResearchTicker,true);
$("deepScanBtn").onclick=deepScanFilings;
$("saveThesisFromResearch").onclick=researchToThesis; $("utilitySave").onclick=researchToThesis; $("existingThesisAction").onclick=researchToThesis; $("utilityCopy").onclick=copyResearchBrief;
$("utilityOpenLatest").onclick=()=>{ const f=currentResearch?.filings?.[0]; if(f) window.open(f.url,"_blank","noopener"); else toast("No filing available."); };
$("conviction").oninput=e=>$("convictionValue").textContent=e.target.value;
$("thesisForm").onsubmit=e=>{ e.preventDefault(); const id=$("editingId").value; const existing=id?investments.find(x=>x.id===id):null; const item={...(existing||{}),id:id||crypto.randomUUID(),ticker:$("ticker").value.trim().toUpperCase(),company:$("company").value.trim(),thesis:$("thesis").value.trim(),breakers:$("breakers").value.trim(),score:Number($("conviction").value),status:existing?.status||"healthy",statusText:existing?.statusText||"Thesis established",lastChecked:existing?.lastChecked||null,lastAnalysis:existing?.lastAnalysis||null,updatedAt:nowISO()}; if(existing) investments=investments.map(x=>x.id===id?item:x); else investments.unshift(item); save(); closeModal("thesisModal"); toast(existing?"Thesis updated.":`${item.ticker} added to watchtower.`,"SAVED"); if(currentResearch?.ticker===item.ticker) renderResearch(currentResearch); };
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
document.querySelectorAll(".chip").forEach(ch=>ch.onclick=()=>{document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));ch.classList.add("active");activeFilter=ch.dataset.filter;renderDashboard();});
$("exportBtn").onclick=exportLibrary; $("libraryExportBtn").onclick=exportLibrary; $("importFile").onchange=e=>e.target.files[0]&&importLibrary(e.target.files[0]);
$("commandBtn").onclick=()=>{openModal("commandPalette");setTimeout(()=>$("paletteInput").focus(),40)};
$("paletteInput").onkeydown=e=>{if(e.key==="Enter"){const q=e.target.value.trim();if(q){closeModal("commandPalette");openResearch(q)}}};
document.querySelectorAll(".palette-item[data-command]").forEach(b=>b.onclick=()=>{closeModal("commandPalette");if(b.dataset.command==="research"){setView("dashboard");setTimeout(()=>$("quickTicker").focus(),80)}if(b.dataset.command==="new")openThesisModal();if(b.dataset.command==="export")exportLibrary();});
document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openModal("commandPalette");setTimeout(()=>$("paletteInput").focus(),40)}if(e.key==="Escape")document.querySelectorAll(".modal:not(.hidden)").forEach(m=>m.classList.add("hidden"));});
window.onclick=e=>{if(e.target.classList.contains("modal")) e.target.classList.add("hidden");};

window.openResearch=openResearch; window.analyzeFiling=analyzeFiling; window.checkThesis=checkThesis; window.viewThesis=viewThesis; window.editThesis=editThesis; window.removeThesis=removeThesis; window.closeModal=closeModal;
renderAll();
