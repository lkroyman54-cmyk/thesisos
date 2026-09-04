#!/usr/bin/env python3
import os, json, re, time, html, csv, io, datetime, urllib.request, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SEC_UA = os.getenv("SEC_USER_AGENT", "ThesisOS/0.1 founder@example.com")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
CACHE = {}

def get_json(url, headers=None, ttl=3600):
    now=time.time()
    if url in CACHE and now-CACHE[url][0] < ttl:
        return CACHE[url][1]
    hdr={"User-Agent":SEC_UA, "Accept-Encoding":"identity"}
    if headers: hdr.update(headers)
    req=urllib.request.Request(url, headers=hdr)
    with urllib.request.urlopen(req, timeout=20) as r:
        data=json.load(r)
    CACHE[url]=(now,data)
    return data

def get_text(url):
    req=urllib.request.Request(url, headers={"User-Agent":SEC_UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req, timeout=25) as r:
        raw=r.read(1_500_000).decode("utf-8","ignore")
    raw=re.sub(r"(?is)<script.*?</script>|<style.*?</style>"," ",raw)
    raw=re.sub(r"(?s)<[^>]+>"," ",raw)
    raw=html.unescape(raw)
    raw=re.sub(r"\s+"," ",raw)
    return raw[:120_000]

def ticker_to_cik(ticker):
    data=get_json("https://www.sec.gov/files/company_tickers.json", ttl=86400)
    ticker=ticker.upper()
    for row in data.values():
        if row.get("ticker","").upper()==ticker:
            return int(row["cik_str"]), row.get("title", ticker)
    return None, None

def recent_filings(ticker):
    cik,title=ticker_to_cik(ticker)
    if not cik: raise ValueError("Ticker not found in SEC company ticker list.")
    sub=get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", ttl=120)
    rec=sub.get("filings",{}).get("recent",{})
    keep={"10-K","10-Q","8-K","10-K/A","10-Q/A","8-K/A","S-3","S-3/A","S-1","S-1/A","424B3","424B5","424B4","DEF 14A","SC 13D","SC 13D/A","SC 13G","SC 13G/A"}
    out=[]
    forms=rec.get("form",[])
    for i,form in enumerate(forms):
        if form not in keep: continue
        accession=rec["accessionNumber"][i]
        primary=rec["primaryDocument"][i]
        acc_no_dash=accession.replace("-","")
        url=f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc_no_dash}/{primary}"
        out.append({
            "form":form,
            "filingDate":rec["filingDate"][i],
            "reportDate":rec["reportDate"][i],
            "accessionNumber":accession,
            "primaryDocument":primary,
            "url":url
        })
        if len(out)>=14: break
    return {"ticker":ticker.upper(),"company":title,"cik":cik,"filings":out}


def company_facts(cik):
    return get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", ttl=300)

def _facts_for(facts, taxonomy, concept, units=None):
    node=facts.get("facts",{}).get(taxonomy,{}).get(concept,{})
    unit_map=node.get("units",{})
    rows=[]
    for unit, arr in unit_map.items():
        if units and unit not in units: continue
        for x in arr:
            if x.get("form") not in {"10-K","10-Q","10-K/A","10-Q/A"}: continue
            if x.get("val") is None or not x.get("end"): continue
            y=dict(x); y["unit"]=unit; rows.append(y)
    # Deduplicate same period/frame by keeping most recently filed version.
    best={}
    for x in rows:
        k=(x.get("end"),x.get("fp"),x.get("frame"),x.get("unit"))
        if k not in best or x.get("filed","") > best[k].get("filed",""):
            best[k]=x
    return sorted(best.values(), key=lambda x:(x.get("end",""),x.get("filed","")), reverse=True)

def _metric(facts, concepts, units=None, prefer_duration=True):
    rows=[]
    used=None
    for taxonomy, concept in concepts:
        r=_facts_for(facts,taxonomy,concept,units)
        if r:
            rows=r; used=concept; break
    if not rows: return None
    # Prefer framed quarterly/annual facts when available to avoid YTD ambiguity.
    framed=[x for x in rows if x.get("frame")]
    if framed: rows=framed
    cur=rows[0]
    # Previous comparable period: same fp if possible, otherwise next distinct end.
    prev=None
    for x in rows[1:]:
        if x.get("end")==cur.get("end"): continue
        if cur.get("fp") and x.get("fp")==cur.get("fp"):
            prev=x; break
    if not prev:
        for x in rows[1:]:
            if x.get("end")!=cur.get("end"):
                prev=x; break
    out={"concept":used,"value":cur.get("val"),"unit":cur.get("unit"),"end":cur.get("end"),"filed":cur.get("filed"),"form":cur.get("form"),"fp":cur.get("fp"),"frame":cur.get("frame")}
    if prev:
        out["previous"]={"value":prev.get("val"),"end":prev.get("end"),"fp":prev.get("fp"),"frame":prev.get("frame")}
        try:
            if prev.get("val") not in (None,0): out["changePct"]=(cur.get("val")/prev.get("val")-1)*100
        except Exception: pass
    return out

def extract_financials(cik):
    facts=company_facts(cik)
    m={}
    m["revenue"]=_metric(facts,[("us-gaap","RevenueFromContractWithCustomerExcludingAssessedTax"),("us-gaap","Revenues"),("us-gaap","SalesRevenueNet")],["USD"])
    m["netIncome"]=_metric(facts,[("us-gaap","NetIncomeLoss")],["USD"])
    m["operatingIncome"]=_metric(facts,[("us-gaap","OperatingIncomeLoss")],["USD"])
    m["grossProfit"]=_metric(facts,[("us-gaap","GrossProfit")],["USD"])
    m["operatingCashFlow"]=_metric(facts,[("us-gaap","NetCashProvidedByUsedInOperatingActivities")],["USD"])
    m["capex"]=_metric(facts,[("us-gaap","PaymentsToAcquirePropertyPlantAndEquipment")],["USD"])
    m["cash"]=_metric(facts,[("us-gaap","CashAndCashEquivalentsAtCarryingValue"),("us-gaap","CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents")],["USD"],False)
    m["assets"]=_metric(facts,[("us-gaap","Assets")],["USD"],False)
    m["liabilities"]=_metric(facts,[("us-gaap","Liabilities")],["USD"],False)
    m["equity"]=_metric(facts,[("us-gaap","StockholdersEquity")],["USD"],False)
    m["rd"]=_metric(facts,[("us-gaap","ResearchAndDevelopmentExpense")],["USD"])
    m["epsDiluted"]=_metric(facts,[("us-gaap","EarningsPerShareDiluted")],["USD/shares","USD-per-shares"])
    m["shares"]=_metric(facts,[("dei","EntityCommonStockSharesOutstanding"),("us-gaap","CommonStocksIncludingAdditionalPaidInCapital")],["shares"],False)
    return {k:v for k,v in m.items() if v is not None}

def recent_insiders_from_submission(cik, sub, limit=10):
    rec=sub.get("filings",{}).get("recent",{})
    out=[]
    for i,form in enumerate(rec.get("form",[])):
        if form not in {"4","4/A"}: continue
        accession=rec["accessionNumber"][i]
        primary=rec["primaryDocument"][i]
        url=f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-','')}/{primary}"
        out.append({"form":form,"filingDate":rec["filingDate"][i],"reportDate":rec["reportDate"][i],"accessionNumber":accession,"primaryDocument":primary,"url":url})
        if len(out)>=limit: break
    return out

def company_snapshot(ticker):
    cik,title=ticker_to_cik(ticker)
    if not cik: raise ValueError("Ticker not found in SEC company ticker list.")
    sub=get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", ttl=120)
    base=recent_filings(ticker)
    try: financials=extract_financials(cik)
    except Exception as e: financials={"_error":str(e)}
    insiders=recent_insiders_from_submission(cik,sub)
    return {
        **base,
        "profile":{
            "sic":sub.get("sic"),"industry":sub.get("sicDescription"),"fiscalYearEnd":sub.get("fiscalYearEnd"),
            "stateOfIncorporation":sub.get("stateOfIncorporation"),"exchanges":sub.get("exchanges",[]),"tickers":sub.get("tickers",[]),
            "website":sub.get("website"),"investorWebsite":sub.get("investorWebsite")
        },
        "financials":financials,
        "insiders":insiders,
        "dataSources":["SEC EDGAR submissions","SEC XBRL companyfacts","SEC Forms 4"]
    }


def filing_kind(form):
    f=(form or '').upper()
    if f.startswith('10-K'): return 'Annual report'
    if f.startswith('10-Q'): return 'Quarterly report'
    if f.startswith('8-K'): return 'Current event'
    if f.startswith('S-3'): return 'Shelf registration'
    if f.startswith('S-1'): return 'Securities registration'
    if f.startswith('424B'): return 'Prospectus / offering terms'
    if f == 'DEF 14A': return 'Proxy / governance'
    if '13D' in f: return 'Activist / strategic ownership'
    if '13G' in f: return 'Large-holder ownership'
    if f.startswith('4'): return 'Insider transaction'
    return 'SEC filing'

def _url_text(url, user_agent=None, max_bytes=1800000):
    headers={"User-Agent":user_agent or SEC_UA,"Accept-Encoding":"identity"}
    req=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(req,timeout=25) as r:
        return r.read(max_bytes).decode('utf-8','ignore')

def _market_history_yahoo(ticker, days=430):
    # Yahoo's public chart endpoint is used as a convenience fallback/primary source.
    # No API key is stored in the client. If unavailable, ThesisOS falls back to Stooq.
    period2=int(time.time())
    period1=period2-(days*86400)
    symbol=ticker.upper().replace('.', '-')
    url=(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}"
         f"?period1={period1}&period2={period2}&interval=1d&events=history&includeAdjustedClose=true")
    data=get_json(url, headers={'User-Agent':'Mozilla/5.0 ThesisOS/1.0'}, ttl=300)
    result=((data.get('chart') or {}).get('result') or [None])[0]
    if not result: raise ValueError('Yahoo market data unavailable.')
    ts=result.get('timestamp') or []
    quotes=(((result.get('indicators') or {}).get('quote') or [{}])[0])
    rows=[]
    for i,t in enumerate(ts):
        try:
            close=quotes.get('close',[None]*len(ts))[i]
            if close is None: continue
            d=datetime.datetime.fromtimestamp(t, tz=datetime.timezone.utc).date().isoformat()
            def v(name):
                arr=quotes.get(name) or []
                x=arr[i] if i < len(arr) else None
                return float(x) if x is not None else None
            rows.append({'date':d,'close':float(close),'open':v('open'),'high':v('high'),'low':v('low'),'volume':v('volume') or 0})
        except Exception: pass
    rows.sort(key=lambda x:x['date'])
    if not rows: raise ValueError('Yahoo returned no usable daily bars.')
    return rows, 'Yahoo delayed daily data'

def _market_history_stooq(ticker, days=430):
    end=datetime.date.today(); start=end-datetime.timedelta(days=days)
    symbol=ticker.lower().replace('.','-')+'.us'
    url=(f"https://stooq.com/q/d/l/?s={urllib.parse.quote(symbol)}&i=d"
         f"&d1={start.strftime('%Y%m%d')}&d2={end.strftime('%Y%m%d')}")
    raw=_url_text(url, user_agent='Mozilla/5.0 ThesisOS/1.0', max_bytes=900000)
    rows=[]
    for r in csv.DictReader(io.StringIO(raw)):
        try:
            d=datetime.date.fromisoformat(r['Date']); close=float(r['Close'])
            rows.append({'date':d.isoformat(),'close':close,'open':float(r['Open']),'high':float(r['High']),'low':float(r['Low']),'volume':float(r.get('Volume') or 0)})
        except Exception: pass
    rows.sort(key=lambda x:x['date'])
    if not rows: raise ValueError('Stooq returned no usable daily bars.')
    return rows, 'Stooq delayed daily data'

def market_history(ticker, days=430):
    errors=[]
    for fn in (_market_history_yahoo, _market_history_stooq):
        try:
            return fn(ticker, days)
        except Exception as e:
            errors.append(str(e))
    raise ValueError('Delayed market history unavailable. ' + ' | '.join(errors))

def _pct(a,b):
    try: return (a/b-1)*100 if b else None
    except Exception: return None

def market_snapshot(ticker):
    rows,source=market_history(ticker); latest=rows[-1]
    def ago(n): return rows[-1-n]['close'] if len(rows)>n else None
    closes=[x['close'] for x in rows[-252:]]
    out={'source':source,'asOf':latest['date'],'price':latest['close'],
         'dayPct':_pct(latest['close'],ago(1)),'weekPct':_pct(latest['close'],ago(5)),
         'monthPct':_pct(latest['close'],ago(21)),'threeMonthPct':_pct(latest['close'],ago(63)),
         'yearPct':_pct(latest['close'],ago(252)) if len(rows)>252 else None,
         'high52w':max(closes) if closes else None,'low52w':min(closes) if closes else None,'history':rows[-280:]}
    if out['high52w'] and out['low52w']:
        span=out['high52w']-out['low52w']; out['rangePosition']=((latest['close']-out['low52w'])/span*100) if span else 50
    return out

def filing_reaction(market, filing_date):
    rows=market.get('history',[]) if market else []
    if not rows or not filing_date: return None
    try: fd=datetime.date.fromisoformat(filing_date)
    except Exception: return None
    dates=[datetime.date.fromisoformat(x['date']) for x in rows]
    before=[i for i,d in enumerate(dates) if d < fd]; after=[i for i,d in enumerate(dates) if d >= fd]
    if not before or not after: return None
    bi=before[-1]; ai=after[0]; base=rows[bi]['close']
    def ret(offset):
        j=min(ai+offset,len(rows)-1); return _pct(rows[j]['close'],base)
    return {'baseDate':rows[bi]['date'],'eventDate':rows[ai]['date'],'oneDayPct':ret(0),'threeDayPct':ret(2),'fiveDayPct':ret(4)}

def keyword_signals(text):
    t=text.lower(); groups={
      'financing / dilution':['at-the-market','at the market','shelf registration','common stock offering','public offering','private placement','dilution','prospectus supplement'],
      'liquidity pressure':['going concern','substantial doubt','liquidity','cash runway','covenant','default'],
      'restructuring':['restructuring','workforce reduction','layoff','impairment','strategic alternatives'],
      'guidance / outlook':['guidance','outlook','forecast','expects','anticipates'],
      'legal / regulatory':['investigation','subpoena','litigation','antitrust','regulatory','settlement'],
      'acquisition / strategic':['acquisition','merger','definitive agreement','joint venture','strategic partnership']}
    found=[]
    for label,terms in groups.items():
        hits=[x for x in terms if x in t]
        if hits: found.append({'signal':label,'matches':hits[:4]})
    return found[:6]

def fallback_filing_intel(filing, text, market=None):
    form=filing.get('form',''); signals=keyword_signals(text); reaction=filing_reaction(market or {}, filing.get('filingDate'))
    form_notes={'10-K':'Full-year operating, risk, liquidity and strategy update.','10-Q':'Quarterly operating and financial update; useful for trajectory changes.','8-K':'Event-driven disclosure. Materiality depends on the item disclosed.','S-3':'Shelf registration creates financing flexibility and can increase future dilution risk; registration itself is not issuance.','S-1':'Registration statement for a securities transaction; review offering purpose, use of proceeds and dilution.','424B5':'Prospectus supplement often contains actual offering terms; review shares, price, proceeds and use of funds.','DEF 14A':'Governance, executive compensation, ownership and shareholder-vote disclosure.','SC 13D':'A holder crossed a material ownership threshold with potential strategic/control intent.','SC 13G':'Large beneficial ownership disclosure, typically more passive than 13D.'}
    base=next((v for k,v in form_notes.items() if form.startswith(k)), f'{filing_kind(form)} filed with the SEC.')
    return {'headline':f'{form}: {filing_kind(form)}','plain_english':base,'why_it_matters':'Primary-source filing retrieved. AI is off, so ThesisOS is showing rule-based materiality signals rather than interpreting company-specific language.','market_context':'Market-reaction data is shown separately when available.' if market else 'Market data is currently unavailable.','management_signal':'Needs AI analysis for company-specific management-language interpretation.','capital_structure':'Potential financing/dilution language detected.' if any(x['signal']=='financing / dilution' for x in signals) else 'No obvious financing/dilution phrase flag from the rule-based scan.','thesis_impact':'NEEDS REVIEW','materiality':'MEDIUM','confidence':0.45,'risks':[x['signal'] for x in signals if x['signal'] in {'financing / dilution','liquidity pressure','legal / regulatory','restructuring'}],'catalysts':[x['signal'] for x in signals if x['signal'] in {'acquisition / strategic','guidance / outlook'}],'watch_next':['Enable OPENAI_API_KEY for filing-specific interpretation.'],'key_numbers':[],'reaction':reaction,'signals':signals}

def response_output_text(data):
    if isinstance(data.get('output_text'),str): return data['output_text']
    text=''
    for item in data.get('output',[]):
        for c in item.get('content',[]):
            if c.get('type')=='output_text': text += c.get('text','')
    return text.strip()

def call_openai_filing_intel(ticker, company, filing, text, thesis='', breakers='', market=None):
    if not OPENAI_API_KEY: return None
    reaction=filing_reaction(market or {}, filing.get('filingDate')); market_summary={k:v for k,v in (market or {}).items() if k!='history'}
    schema={'type':'object','additionalProperties':False,'properties':{'headline':{'type':'string'},'plain_english':{'type':'string'},'why_it_matters':{'type':'string'},'market_context':{'type':'string'},'management_signal':{'type':'string'},'capital_structure':{'type':'string'},'thesis_impact':{'type':'string','enum':['STRONGER','UNCHANGED','WEAKER','BROKEN','NOT_SAVED']},'materiality':{'type':'string','enum':['LOW','MEDIUM','HIGH','CRITICAL']},'confidence':{'type':'number','minimum':0,'maximum':1},'risks':{'type':'array','items':{'type':'string'},'maxItems':5},'catalysts':{'type':'array','items':{'type':'string'},'maxItems':5},'watch_next':{'type':'array','items':{'type':'string'},'maxItems':5},'key_numbers':{'type':'array','items':{'type':'string'},'maxItems':8}},'required':['headline','plain_english','why_it_matters','market_context','management_signal','capital_structure','thesis_impact','materiality','confidence','risks','catalysts','watch_next','key_numbers']}
    prompt=("Analyze this SEC filing as a professional long-term equity research analyst. Use ONLY the filing text plus the supplied market data. Do not invent facts, price targets, or buy/sell recommendations. Distinguish registration from actual issuance, routine insider sales from discretionary behavior, and filing-date price reaction from causal attribution. Be concise but specific.\n\n"
            f"Company: {company} ({ticker})\nForm: {filing.get('form')}\nFiled: {filing.get('filingDate')}\nReport date: {filing.get('reportDate')}\nFiling URL: {filing.get('url')}\nSaved thesis: {thesis or 'No saved thesis.'}\nThesis breakers: {breakers or 'None supplied.'}\nDelayed market snapshot: {json.dumps(market_summary)}\nPrice reaction around filing: {json.dumps(reaction)}\n\nFILING TEXT:\n{text[:105000]}")
    payload=json.dumps({'model':OPENAI_MODEL,'input':prompt,'text':{'verbosity':'low','format':{'type':'json_schema','name':'filing_intelligence','strict':True,'schema':schema}}}).encode()
    req=urllib.request.Request('https://api.openai.com/v1/responses',data=payload,method='POST',headers={'Authorization':f'Bearer {OPENAI_API_KEY}','Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=90) as r: data=json.load(r)
    return json.loads(response_output_text(data))

def analyze_single_filing(ticker, filing, thesis='', breakers='', market=None):
    cik,company=ticker_to_cik(ticker)
    if not cik: raise ValueError('Ticker not found in SEC company ticker list.')
    url=filing.get('url','')
    if not url.startswith('https://www.sec.gov/Archives/edgar/data/'): raise ValueError('Invalid SEC filing URL.')
    text=get_text(url)
    if OPENAI_API_KEY:
        result=call_openai_filing_intel(ticker,company,filing,text,thesis,breakers,market); result['reaction']=filing_reaction(market or {}, filing.get('filingDate')); result['signals']=keyword_signals(text); return {'ai':True,'analysis':result}
    return {'ai':False,'analysis':fallback_filing_intel(filing,text,market),'message':'AI analysis is off. Showing filing-type intelligence and rule-based flags.'}


def call_openai(ticker, thesis, breakers, filings):
    if not OPENAI_API_KEY:
        return None
    source_chunks=[]
    for f in filings[:3]:
        try:
            txt=get_text(f["url"])
            source_chunks.append(f"FORM {f['form']} FILED {f['filingDate']}\n{txt[:45000]}")
        except Exception as e:
            source_chunks.append(f"FORM {f['form']} FILED {f['filingDate']} [text unavailable: {e}]")
    source="\n\n--- FILING ---\n\n".join(source_chunks)
    prompt=f"""
You are the thesis-monitoring engine for a long-term investor.
Analyze ONLY evidence supplied from SEC filings. Do not give investment advice, price targets, or buy/sell instructions.

Ticker: {ticker}

INVESTOR THESIS:
{thesis}

THESIS BREAKERS:
{breakers or "None explicitly supplied."}

LATEST SEC FILING TEXT:
{source}

Return STRICT JSON with exactly:
{{
  "verdict": "STRONGER" | "UNCHANGED" | "WEAKER" | "BROKEN",
  "score": integer 0-100,
  "summary": "one concise sentence",
  "changes": ["up to 4 concrete filing-grounded changes"],
  "risks": ["up to 4 items that weaken or threaten the thesis"],
  "watch_next": ["up to 4 specific future evidence points"]
}}

Score means strength of the evidence relative to the stated thesis, not expected stock return.
If the filings do not contain enough evidence, prefer UNCHANGED and say so.
"""
    payload=json.dumps({
        "model":OPENAI_MODEL,
        "input":prompt,
        "text":{"verbosity":"low"}
    }).encode()
    req=urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=payload, method="POST",
        headers={"Authorization":f"Bearer {OPENAI_API_KEY}","Content-Type":"application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        data=json.load(r)
    text=""
    for item in data.get("output",[]):
        for content in item.get("content",[]):
            if content.get("type")=="output_text":
                text += content.get("text","")
    text=text.strip()
    text=re.sub(r"^```(?:json)?\s*|\s*```$","",text)
    return json.loads(text)

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def translate_path(self, path):
        clean=urllib.parse.urlparse(path).path.lstrip("/")
        return str(ROOT / (clean or "index.html"))

    def send_json(self, obj, status=200):
        data=json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed=urllib.parse.urlparse(self.path)
        if parsed.path == '/healthz':
            return self.send_json({'ok': True, 'service': 'ThesisOS', 'aiEnabled': bool(OPENAI_API_KEY)})
        if parsed.path in {"/api/sec","/api/company","/api/market"}:
            try:
                qs=urllib.parse.parse_qs(parsed.query); ticker=qs.get("ticker",[""])[0].strip().upper()
                if not ticker: return self.send_json({"error":"Ticker is required."},400)
                if parsed.path=="/api/company": return self.send_json(company_snapshot(ticker))
                if parsed.path=="/api/market": return self.send_json(market_snapshot(ticker))
                return self.send_json(recent_filings(ticker))
            except Exception as e: return self.send_json({"error":str(e)},500)
        return super().do_GET()

    def do_POST(self):
        path=urllib.parse.urlparse(self.path).path
        if path not in {"/api/analyze","/api/filing-intel"}: return self.send_json({"error":"Not found"},404)
        try:
            n=int(self.headers.get("Content-Length","0")); body=json.loads(self.rfile.read(n) or b"{}")
            if path=="/api/filing-intel":
                ticker=body.get('ticker','').strip().upper(); filing=body.get('filing') or {}
                if not ticker or not filing: return self.send_json({'error':'Ticker and filing are required.'},400)
                return self.send_json(analyze_single_filing(ticker,filing,body.get('thesis',''),body.get('breakers',''),body.get('market')))
            filings=body.get("filings",[])
            if not filings: return self.send_json({"error":"No SEC filings available to analyze."},400)
            if not OPENAI_API_KEY: return self.send_json({"ai":False,"message":"SEC filings are live. Set OPENAI_API_KEY before starting the server to enable thesis-specific AI analysis."})
            return self.send_json({"ai":True,"analysis":call_openai(body.get("ticker",""), body.get("thesis",""), body.get("breakers",""), filings)})
        except urllib.error.HTTPError as e:
            detail=e.read().decode("utf-8","ignore")[:1000]; return self.send_json({"error":f"Upstream API error {e.code}: {detail}"},502)
        except Exception as e: return self.send_json({"error":str(e)},500)

if __name__=="__main__":
    os.chdir(ROOT)
    port=int(os.getenv("PORT","8000"))
    print(f"ThesisOS listening on 0.0.0.0:{port}")
    if not OPENAI_API_KEY:
        print("AI analysis OFF — set OPENAI_API_KEY to enable it.")
    print("Tip: set SEC_USER_AGENT='YourName your@email.com' for SEC-compliant identification.")
    ThreadingHTTPServer(("0.0.0.0",port),Handler).serve_forever()
