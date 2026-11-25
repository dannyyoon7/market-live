/* 실시간 시세 대시보드 (18종목 · 3초 갱신)
 * 데이터: CNBC Quote(지수·선물·환율·원유), 업비트(KRW-BTC), Coinbase(BTC-USD), gold-api(금·은 현물)
 * 폴백: Yahoo Finance 스파크 → r.jina.ai 텍스트 프록시 (CNBC 연속 실패 시에만, 30초 간격)
 */
'use strict';

const REFRESH_MS = 3_000;        // 자동 갱신 주기
const STALE_MIN = 8;             // 이보다 오래된 시세는 '지연' 표시
const YAHOO_MIN_GAP = 30_000;    // 프록시 폴백 최소 간격
const OZ_TO_G = 31.1034768;
const DON_G = 3.75;

/* ── 그룹 / 항목 ─────────────────────────────────── */
const GROUPS = [
  { key: 'kr',   flag: '🇰🇷', name: '국내증시 · 선물' },
  { key: 'us',   flag: '🇺🇸', name: '미국증시 · 선물' },
  { key: 'jp',   flag: '🇯🇵', name: '일본증시 · 선물' },
  { key: 'fx',   flag: '💱', name: '환율 · 달러' },
  { key: 'coin', flag: '🪙', name: '암호화폐' },
  { key: 'cmd',  flag: '🛢️', name: '원유 · 귀금속' },
];

const ITEMS = [
  { id: 'kospi',   group: 'kr', name: '코스피',        sub: 'KOSPI',      kick: 'KR', kcls: 'k-kr',  unit: 'p', dp: 2, digits: 2, market: 'KR' },
  { id: 'kosdaq',  group: 'kr', name: '코스닥',        sub: 'KOSDAQ',     kick: 'KR', kcls: 'k-kr',  unit: 'p', dp: 2, digits: 2, market: 'KR' },
  { id: 'kospi200',group: 'kr', name: '코스피200',     sub: 'KOSPI200',   kick: 'KR', kcls: 'k-kr',  unit: 'p', dp: 2, digits: 2, market: 'KR' },

  { id: 'nasdaq',  group: 'us', name: '나스닥',        sub: 'NASDAQ',     kick: 'US', kcls: 'k-us',  unit: 'p', dp: 2, digits: 2, market: 'US' },
  { id: 'dow',     group: 'us', name: '다우존스',      sub: 'DOW',        kick: 'US', kcls: 'k-us',  unit: 'p', dp: 2, digits: 2, market: 'US' },
  { id: 'ndx',     group: 'us', name: '나스닥100 선물', sub: 'NQ 선물',   kick: 'US', kcls: 'k-us',  unit: 'p', dp: 2, digits: 2, market: 'FUT' },
  { id: 'sox',     group: 'us', name: '반도체 SOX',    sub: 'PHLX',       kick: 'US', kcls: 'k-us',  unit: 'p', dp: 2, digits: 2, market: 'US' },
  { id: 'vix',     group: 'us', name: 'VIX',           sub: '공포지수',   kick: 'US', kcls: 'k-us',  unit: 'p', dp: 2, digits: 2, market: 'US' },

  { id: 'n225',    group: 'jp', name: '닛케이225',     sub: 'Nikkei',     kick: 'JP', kcls: 'k-jp',  unit: 'p', dp: 2, digits: 2, market: 'JP' },
  { id: 'n225f',   group: 'jp', name: '닛케이 선물',   sub: 'CME 선물',   kick: 'JP', kcls: 'k-jp',  unit: 'p', dp: 2, digits: 2, market: 'FUT' },

  { id: 'usdkrw',  group: 'fx', name: '원/달러',       sub: 'USD/KRW',    kick: 'FX', kcls: 'k-fx',  unit: '원', dp: 2, digits: 2, market: 'FX' },
  { id: 'jpy100',  group: 'fx', name: '100엔/원',      sub: 'JPY/KRW',    kick: 'JP', kcls: 'k-jp',  unit: '원', dp: 2, digits: 2, market: 'FX', extra: 'jpy' },
  { id: 'dxy',     group: 'fx', name: '달러인덱스',    sub: 'DXY',        kick: 'FX', kcls: 'k-fx',  unit: 'p', dp: 2, digits: 2, market: 'FX' },

  { id: 'btc',     group: 'coin', name: '비트코인',    sub: 'BTC · 업비트', kick: '₿', kcls: 'k-btc', unit: '원', dp: 0, digits: 0, wide: true, cls: 'coin-card' },

  { id: 'wti',     group: 'cmd', name: 'WTI 유',       sub: 'WTI',        kick: 'OIL', kcls: 'k-oil', unit: '/bbl', dp: 2, digits: 2, market: 'FUT', pre: '$' },
  { id: 'brent',   group: 'cmd', name: '브렌트유',     sub: 'Brent',      kick: 'OIL', kcls: 'k-oil', unit: '/bbl', dp: 2, digits: 2, market: 'FUT', pre: '$' },
  { id: 'gold',    group: 'cmd', name: '국제 금',      sub: 'XAU/USD',    kick: 'Au', kcls: 'k-au',  unit: '/oz', dp: 2, digits: 2, wide: true, cls: 'gold-card', pre: '$' },
  { id: 'silver',  group: 'cmd', name: '국제 은',      sub: 'XAG/USD',    kick: 'Ag', kcls: 'k-ag',  unit: '/oz', dp: 2, digits: 2, wide: true, cls: 'silver-card', pre: '$' },
];

/* ── 상태 ─────────────────────────────────────────── */
const Q = {};                            // 지수·선물·환율 (id → 시세)
const B = { krw: null, usd: null };      // 비트코인
const M = { gold: null, silver: null };  // 금·은 현물
const refs = {};
const SRC = { cnbc: { lock: false, fails: 0, nextAt: 0 },
              crypto: { lock: false, fails: 0, nextAt: 0 },
              metals: { lock: false, fails: 0, nextAt: 0 } };

let lastOkAt = null;
let lastYahooAt = 0;
let nextTickAt = Date.now() + REFRESH_MS;

/* ── 유틸 ─────────────────────────────────────────── */
const $ = (s, el = document) => el.querySelector(s);

function num(v) {
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  if (/^unch(anged)?$/i.test(s)) return 0;
  if (/^(n\/?a|-)$/i.test(s)) return NaN;
  const n = parseFloat(s.replace(/[,\s%+]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function fmt(n, dp = 2) {
  if (n == null || !Number.isFinite(n)) return '–';
  return n.toLocaleString('ko-KR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtPct(p) {
  if (p == null || !Number.isFinite(p)) return '–';
  return (p > 0 ? '+' : '') + p.toFixed(2) + '%';
}
function fmtPctAbs(p) {
  if (p == null || !Number.isFinite(p)) return '–';
  return Math.abs(p).toFixed(2) + '%';
}
function fmtAbs(c, dp = 2) {
  if (c == null || !Number.isFinite(c)) return '–';
  return Math.abs(c).toLocaleString('ko-KR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function arrow(c) {
  if (c > 0) return '▲';
  if (c < 0) return '▼';
  return '–';
}
function dirOf(change, pct) {
  const v = Number.isFinite(change) ? change : pct;
  if (!Number.isFinite(v) || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}
function parseTs(s) {
  if (!s) return null;
  const v = String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const kstFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const kstClock = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
function kstParts(d) {
  return Object.fromEntries(kstFmt.formatToParts(d).map(p => [p.type, p.value]));
}
function kstTime(d) {
  const p = kstParts(d);
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}
function ageMinutes(ts) { return ts ? (Date.now() - ts.getTime()) / 60000 : NaN; }

function clockIn(tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const mins = (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10);
  return { dow, mins, weekend: dow === 0 || dow === 6 };
}

function marketTag(it) {
  if (it.market === 'KR') {
    const t = clockIn('Asia/Seoul');
    if (!t.weekend && t.mins >= 540 && t.mins < 930) return { label: '장중', cls: 'open' };
    return { label: '마감', cls: 'closed' };
  }
  if (it.market === 'JP') {
    const t = clockIn('Asia/Tokyo');
    if (!t.weekend && t.mins >= 540 && t.mins < 930) return { label: '장중', cls: 'open' };
    return { label: '마감', cls: 'closed' };
  }
  if (it.market === 'US') {
    const t = clockIn('America/New_York');
    if (t.weekend) return { label: '마감', cls: 'closed' };
    if (t.mins >= 570 && t.mins < 960) return { label: '장중', cls: 'open' };
    if (t.mins >= 240 && t.mins < 570) return { label: '장전', cls: 'pre' };
    if (t.mins >= 960 && t.mins < 1200) return { label: '시간외', cls: 'after' };
    return { label: '마감', cls: 'closed' };
  }
  if (it.market === 'FUT') return { label: '선물', cls: 'after' };
  return { label: '24시간', cls: 'open' };
}

async function fetchWithTimeout(url, ms = 6000, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal, cache: 'no-store', ...opts });
  } finally {
    clearTimeout(t);
  }
}
async function getJSON(url, ms = 6000) {
  const r = await fetchWithTimeout(url, ms);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* ── 소스 1. CNBC (지수·선물·환율·원유) ─────────────── */
const CNBC_MAP = {
  '.KS11': 'kospi', '.KQ11': 'kosdaq', '.KS200': 'kospi200',
  '.IXIC': 'nasdaq', '.DJI': 'dow', '@ND.1': 'ndx', '.SOX': 'sox', '.VIX': 'vix',
  '.N225': 'n225', '@NK.1': 'n225f',
  'KRW=': 'usdkrw', 'JPY=': 'jpy', '.DXY': 'dxy',
  '@CL.1': 'wti', '@LCO.1': 'brent', '@GC.1': 'goldF', '@SI.1': 'silverF',
};
const CNBC_URL =
  'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' +
  encodeURIComponent(Object.keys(CNBC_MAP).join('|')) +
  '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1';

async function loadCnbc() {
  const j = await getJSON(CNBC_URL, 6000);
  const list = j?.FormattedQuoteResult?.FormattedQuote;
  if (!Array.isArray(list) || !list.length) throw new Error('CNBC 응답 비어 있음');

  let ok = 0;
  for (const q of list) {
    const id = CNBC_MAP[q.symbol];
    if (!id || q.code !== 0) continue;
    const price = num(q.last);
    if (!(price > 0)) continue;

    const change = num(q.change);
    const pct = num(q.change_pct);
    const prev = num(q.previous_day_closing) || (Number.isFinite(change) ? price - change : NaN);

    const raw = q.last_time || '';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const ts = dateOnly ? null : parseTs(raw);

    Q[id] = {
      price,
      change: Number.isFinite(change) ? change : (prev ? price - prev : NaN),
      pct: Number.isFinite(pct) ? pct : (prev ? ((price - prev) / prev) * 100 : NaN),
      prev,
      high: num(q.high),
      low: num(q.low),
      ts,
      dateOnly,
      dayLabel: dateOnly ? raw.slice(5, 7) + '/' + raw.slice(8, 10) : null,
      source: 'CNBC',
      delayed: q.realTime === 'false',
    };
    ok++;
  }
  if (!ok) throw new Error('CNBC 유효 시세 없음');
  computeJpy100();
  return 'cnbc';
}

/* 100엔/원 = 100 × (USD/KRW) ÷ (USD/JPY) */
function computeJpy100() {
  const krw = Q.usdkrw, jpy = Q.jpy;
  if (!krw || !jpy || !(krw.price > 0) || !(jpy.price > 0)) return;
  const price = (100 * krw.price) / jpy.price;
  const prev = krw.prev > 0 && jpy.prev > 0 ? (100 * krw.prev) / jpy.prev : NaN;
  Q.jpy100 = {
    price,
    change: Number.isFinite(prev) ? price - prev : NaN,
    pct: Number.isFinite(prev) && prev > 0 ? (price / prev - 1) * 100 : NaN,
    prev,
    high: NaN, low: NaN,
    ts: krw.ts, dateOnly: false, dayLabel: null,
    source: 'CNBC', delayed: true,
  };
}

/* ── 소스 2. Yahoo 스파크 (CNBC 연속 실패 시, 30초 간격) ── */
const Y_MAP = {
  '^KS11': 'kospi', '^KQ11': 'kosdaq', '^KS200': 'kospi200',
  '^IXIC': 'nasdaq', '^DJI': 'dow', 'NQ=F': 'ndx', '^SOX': 'sox', '^VIX': 'vix',
  '^N225': 'n225', 'NIY=F': 'n225f',
  'KRW=X': 'usdkrw', 'JPY=X': 'jpy', 'DX-Y.NYB': 'dxy',
  'CL=F': 'wti', 'BZ=F': 'brent', 'GC=F': 'goldF', 'SI=F': 'silverF',
};
const Y_SPARK =
  'https://query1.finance.yahoo.com/v7/finance/spark?symbols=' +
  encodeURIComponent(Object.keys(Y_MAP).join(',')) +
  '&range=1d&interval=1d';

async function loadYahoo() {
  const r = await fetchWithTimeout('https://r.jina.ai/' + Y_SPARK, 12000);
  if (!r.ok) throw new Error('프록시 HTTP ' + r.status);
  const text = await r.text();
  const at = text.indexOf('{"spark"');
  if (at < 0) throw new Error('프록시 응답 형식 오류');
  const j = JSON.parse(text.slice(at));

  let ok = 0;
  for (const row of j?.spark?.result || []) {
    const id = Y_MAP[row.symbol];
    const meta = row?.response?.[0]?.meta;
    if (!id || !meta) continue;
    const price = num(meta.regularMarketPrice);
    if (!(price > 0)) continue;
    const prev = num(meta.chartPreviousClose) || num(meta.previousClose);
    const pct = num(meta.regularMarketChangePercent);
    const change = Number.isFinite(prev) ? price - prev : NaN;

    Q[id] = {
      price, change,
      pct: Number.isFinite(pct) ? pct : (prev ? (change / prev) * 100 : NaN),
      prev, high: NaN, low: NaN,
      ts: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000) : null,
      dateOnly: false, dayLabel: null,
      source: 'Yahoo', delayed: true,
    };
    ok++;
  }
  if (!ok) throw new Error('Yahoo 유효 시세 없음');
  computeJpy100();
  return 'yahoo';
}

/* ── 소스 3. 업비트(WebSocket 실시간) · Coinbase ─────── */
let upbitWS = null;
let upbitWSLast = 0;
let upbitRSLast = 0;

function connectUpbit() {
  try {
    upbitWS = new WebSocket('wss://api.upbit.com/websocket/v1');
  } catch (_) { return; }
  upbitWS.binaryType = 'arraybuffer';

  upbitWS.addEventListener('open', () => {
    upbitWS.send(JSON.stringify([{ ticket: 'market-live' }, { type: 'ticker', codes: ['KRW-BTC'] }]));
  });

  upbitWS.addEventListener('message', (ev) => {
    try {
      const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
      const d = JSON.parse(text);
      if (d.type !== 'ticker' || !d.trade_price) return;
      upbitWSLast = Date.now();
      B.krw = {
        price: num(d.trade_price),
        change: num(d.signed_change_price),
        pct: num(d.signed_change_rate) * 100,
        prev: num(d.prev_closing_price),
        ts: new Date(num(d.trade_timestamp) || Date.now()),
        source: '업비트',
      };
      renderBtc();
      lastOkAt = new Date();
      updateStatus();
    } catch (_) { /* 형식 오류 무시 */ }
  });

  upbitWS.addEventListener('close', () => setTimeout(connectUpbit, 5000));
  upbitWS.addEventListener('error', () => { try { upbitWS.close(); } catch (_) {} });
}

/* WS가 15초 이상 조용하면 REST 폴백(10초에 1회, 429 방지) */
async function loadUpbit() {
  if (Date.now() - upbitWSLast < 15000) return;
  if (Date.now() - upbitRSLast < 10000) return;
  upbitRSLast = Date.now();
  const j = await getJSON('https://api.upbit.com/v1/ticker?markets=KRW-BTC', 6000);
  const t = Array.isArray(j) ? j[0] : null;
  if (!t) throw new Error('업비트 응답 없음');
  B.krw = {
    price: num(t.trade_price),
    change: num(t.signed_change_price),
    pct: num(t.signed_change_rate) * 100,
    prev: num(t.prev_closing_price),
    ts: new Date(num(t.trade_timestamp) || Date.now()),
    source: '업비트',
  };
}

async function loadBtcUsd() {
  try {
    const j = await getJSON('https://api.coinbase.com/v2/prices/BTC-USD/spot', 5000);
    const p = num(j?.data?.amount);
    if (p > 0) { B.usd = { price: p, ts: new Date(), source: 'Coinbase' }; return; }
  } catch (_) { /* Binance 폴백 */ }
  const j = await getJSON('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', 5000);
  const p = num(j?.price);
  if (!(p > 0)) throw new Error('달러 시세 없음');
  B.usd = { price: p, ts: new Date(), source: 'Binance' };
}

/* ── 소스 4. 금·은 현물 ────────────────────────────── */
async function loadMetal(sym) {
  const j = await getJSON(`https://api.gold-api.com/price/${sym}`, 6000);
  const p = num(j?.price);
  if (!(p > 0)) throw new Error(sym + ' 시세 없음');
  return { price: p, ts: parseTs(j.updatedAt) || new Date(), source: 'gold-api' };
}

/* ── 환율 폴백 ────────────────────────────────────── */
async function loadFxFallback() {
  const j = await getJSON('https://open.er-api.com/v6/latest/USD', 6000);
  const p = num(j?.rates?.KRW);
  if (!(p > 0)) throw new Error('환율 없음');
  if (!Q.usdkrw || !(Q.usdkrw.price > 0)) {
    Q.usdkrw = {
      price: p, change: NaN, pct: NaN, prev: NaN, high: NaN, low: NaN,
      ts: new Date(j.time_last_update_unix ? j.time_last_update_unix * 1000 : Date.now()),
      dateOnly: false, dayLabel: null, source: 'er-api', delayed: true,
    };
  }
}

/* ── 갱신 스케줄러 (소스별 잠금 + 지수 백오프) ───────── */
function schedule(key, work) {
  const s = SRC[key];
  if (s.lock || Date.now() < s.nextAt) return;
  s.lock = true;
  work()
    .then(() => { s.fails = 0; s.nextAt = 0; lastOkAt = new Date(); })
    .catch(() => {
      s.fails += 1;
      s.nextAt = Date.now() + Math.min(30_000, REFRESH_MS * Math.pow(2, s.fails));
    })
    .finally(() => { s.lock = false; renderAll(); updateStatus(); });
}

function tick() {
  if (document.visibilityState !== 'visible') return;

  schedule('cnbc', async () => {
    try {
      await loadCnbc();
    } catch (e) {
      if (Date.now() - lastYahooAt > YAHOO_MIN_GAP) {
        lastYahooAt = Date.now();
        await loadYahoo();
      } else {
        await loadFxFallback().catch(() => {});
        throw e;
      }
    }
  });

  schedule('crypto', async () => {
    const res = await Promise.allSettled([loadUpbit(), loadBtcUsd()]);
    // 업비트 WS가 살아 있으면 REST는 건너뛰므로 둘 다 실패해도 정상으로 본다
    if (res.every(r => r.status === 'rejected') && Date.now() - upbitWSLast > 15000) {
      throw new Error('코인 시세 실패');
    }
  });

  schedule('metals', async () => {
    const [g, s] = await Promise.allSettled([loadMetal('XAU'), loadMetal('XAG')]);
    if (g.status === 'fulfilled') M.gold = g.value;
    if (s.status === 'fulfilled') M.silver = s.value;
    if (g.status === 'rejected' && s.status === 'rejected') throw new Error('귀금속 실패');
  });

  nextTickAt = Date.now() + REFRESH_MS;
}

/* ── 상태 표시 ────────────────────────────────────── */
function updateStatus(manual) {
  if (manual) flash('새로고침 완료');
  const dot = $('#statusDot');
  const txt = $('#statusText');
  const now = Date.now();
  const late = lastOkAt ? (now - lastOkAt.getTime()) / 1000 : 999;

  if (late < 15) {
    dot.className = 'sd';
    txt.textContent = `${kstClock.format(lastOkAt || new Date())} 갱신`;
  } else if (late < 60) {
    dot.className = 'sd warn';
    txt.textContent = '일부 시세 지연 · 재시도 중';
  } else {
    dot.className = 'sd err';
    txt.textContent = '연결이 끊겼어요 · 재시도 중';
  }
}

/* ── 렌더 ─────────────────────────────────────────── */
function renderAll() {
  ITEMS.forEach(it => {
    if (it.id === 'btc') return renderBtc();
    if (it.id === 'gold' || it.id === 'silver') return renderMetal(it);
    paintIndex(it);
  });
}

function paintIndex(it) {
  const r = refs[it.id];
  if (!r) return;
  const q = Q[it.id];

  if (!q || !(q.price > 0)) {
    r.num.textContent = '–';
    r.delta.textContent = lastOkAt ? '불러오지 못했어요' : '불러오는 중…';
    r.src.textContent = lastOkAt ? '연결 실패 · 재시도 중' : '연결 중';
    r.srcDot.classList.add('old');
    return;
  }

  const dir = dirOf(q.change, q.pct);
  r.card.classList.remove('up', 'down', 'flat');
  r.card.classList.add(dir);

  r.num.textContent = fmt(q.price, it.dp);
  r.pre.textContent = it.pre || '';
  r.unit.textContent = it.unit;

  r.delta.innerHTML = q.change === 0
    ? `<span class="pc">보합</span>`
    : `<span class="ar">${arrow(q.change)}</span>` +
      `<span class="ab">${fmtAbs(q.change, it.digits)}</span>` +
      `<span class="pc">(${fmtPct(q.pct)})</span>`;

  const hi = q.high, lo = q.low;
  if (Number.isFinite(hi) && Number.isFinite(lo) && hi > lo) {
    const p = Math.min(100, Math.max(0, ((q.price - lo) / (hi - lo)) * 100));
    r.barFill.style.width = p.toFixed(1) + '%';
    r.barDot.style.left = p.toFixed(1) + '%';
    r.lo.textContent = '저 ' + fmt(lo, it.dp);
    r.hi.textContent = '고 ' + fmt(hi, it.dp);
    r.range.style.display = '';
  } else {
    r.range.style.display = 'none';
  }

  const st = marketTag(it);
  r.tag.hidden = false;
  r.tag.className = 'tag ' + st.cls;
  r.tag.textContent = st.label;

  if (it.extra === 'jpy' && r.usd) {
    r.usd.textContent = Q.jpy && Q.jpy.price > 0 ? fmt(Q.jpy.price, 2) : '–';
  }

  const bits = [q.source];
  if (q.dateOnly) bits.push(`${q.dayLabel} 종가`);
  else if (q.ts) bits.push(kstTime(q.ts));

  const age = ageMinutes(q.ts);
  const stale = Number.isFinite(age) && age > STALE_MIN;
  if (st.cls !== 'closed' && stale) {
    bits.push(`${Math.round(age)}분 지연`);
    r.srcDot.classList.add('old');
  } else {
    r.srcDot.classList.remove('old');
  }
  r.src.textContent = bits.join(' · ');
}

function renderBtc() {
  const r = refs.btc;
  if (!r) return;
  const k = B.krw;
  if (!k) {
    r.num.textContent = '–';
    r.delta.textContent = lastOkAt ? '불러오지 못했어요' : '불러오는 중…';
    r.src.textContent = lastOkAt ? '연결 실패 · 재시도 중' : '연결 중';
    return;
  }

  r.card.classList.remove('up', 'down', 'flat');
  r.card.classList.add(dirOf(k.change, k.pct));

  r.num.textContent = fmt(k.price, 0);
  r.delta.innerHTML =
    `<span class="ar">${arrow(k.change)}</span>` +
    `<span class="ab">${fmtAbs(k.change, 0)}</span>` +
    `<span class="pc">(${fmtPct(k.pct)})</span>`;

  const fx = Q.usdkrw && Q.usdkrw.price;
  const usd = B.usd && B.usd.price;
  if (fx && usd) {
    const prem = (k.price / (usd * fx) - 1) * 100;
    r.prem.textContent = fmtPct(prem);
    r.premBox.classList.remove('up', 'down', 'flat');
    r.premBox.classList.add(dirOf(prem));
    r.premBox.style.display = '';
  } else {
    r.premBox.style.display = 'none';
  }
  r.usd.textContent = usd ? '$' + fmt(usd, 2) : '–';
  r.usdLb.textContent = B.usd ? B.usd.source : 'USD';

  r.src.textContent = `${k.source} · ${kstClock.format(k.ts)} · 24시간 거래`;
  r.srcDot.classList.remove('old');
}

function renderMetal(it) {
  const r = refs[it.id];
  if (!r) return;
  const metal = it.id === 'gold' ? M.gold : M.silver;
  const fut = Q[it.id === 'gold' ? 'goldF' : 'silverF'];
  const fx = Q.usdkrw && Q.usdkrw.price;

  if (!metal) {
    r.num.textContent = '–';
    r.delta.textContent = lastOkAt ? '불러오지 못했어요' : '불러오는 중…';
    r.src.textContent = lastOkAt ? '연결 실패 · 재시도 중' : '연결 중';
    return;
  }

  const dir = fut ? dirOf(fut.change, fut.pct) : 'flat';
  r.card.classList.remove('up', 'down', 'flat');
  r.card.classList.add(dir);

  r.num.textContent = fmt(metal.price, 2);
  if (fut && Number.isFinite(fut.pct)) {
    r.delta.innerHTML =
      `<span class="ar">${arrow(fut.change)}</span>` +
      `<span class="pc">${fmtPctAbs(fut.pct)}</span>` +
      `<span class="note">COMEX 선물</span>`;
  } else {
    r.delta.innerHTML = `<span class="note">등락 정보 없음</span>`;
  }

  if (fx) {
    const perG = (metal.price * fx) / OZ_TO_G;
    r.g.textContent = fmt(perG, 0) + '원';
    r.don.textContent = fmt(perG * DON_G, 0) + '원';
  } else {
    r.g.textContent = '–';
    r.don.textContent = '–';
  }

  r.src.textContent = `${metal.source} · ${kstClock.format(metal.ts)} · 현물`;
  r.srcDot.classList.remove('old');
}

/* ── 카드 DOM ─────────────────────────────────────── */
function buildCards() {
  const root = $('#cards');
  root.innerHTML = '';

  for (const g of GROUPS) {
    const section = document.createElement('section');
    const h = document.createElement('h2');
    h.className = 'grp';
    h.innerHTML = `<span class="gflag">${g.flag}</span>${g.name}`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    section.append(h, grid);
    root.appendChild(section);

    for (const it of ITEMS.filter(i => i.group === g.key)) {
      grid.insertAdjacentHTML('beforeend', template(it));
      cacheRefs(it);
    }
  }
}

function headHtml(it) {
  return `<div class="card-head"><span class="kick ${it.kcls}">${it.kick}</span>` +
    `<span class="nm">${it.name}</span><span class="tag mkt" hidden></span>` +
    `<span class="sub">${it.sub}</span></div>`;
}
const SRC_HTML = `<div class="src"><span class="d"></span><span class="tx">연결 중</span></div>`;
const DELTA_HTML = `<div class="delta"><span class="ar"></span><span class="ab"></span><span class="pc"></span></div>`;

function template(it) {
  if (it.id === 'btc') {
    return `<article class="card wide ${it.cls || ''}" data-id="${it.id}">
      <div class="card-head"><span class="kick ${it.kcls}">${it.kick}</span>
        <span class="nm">${it.name}</span><span class="tag open">24시간</span>
        <span class="sub">${it.sub}</span></div>
      <div class="price"><span class="pre"></span><span class="num">–</span><span class="unit">원</span></div>
      ${DELTA_HTML}
      <div class="chips">
        <span class="chip prem" style="display:none"><span class="lb">김치프리미엄</span><b class="pv">–</b></span>
        <span class="chip usd"><span class="lb">USD</span><b class="uv">–</b></span>
      </div>
      ${SRC_HTML}
    </article>`;
  }

  if (it.id === 'gold' || it.id === 'silver') {
    return `<article class="card wide ${it.cls || ''}" data-id="${it.id}">
      <div class="card-head"><span class="kick ${it.kcls}">${it.kick}</span>
        <span class="nm">${it.name}</span><span class="tag open">현물</span>
        <span class="sub">${it.sub}</span></div>
      <div class="price"><span class="pre">$</span><span class="num">–</span><span class="unit">/oz</span></div>
      ${DELTA_HTML}
      <div class="conv">
        <div><span class="lb">1g 환산</span><b class="g">–</b></div>
        <div><span class="lb">1돈 (3.75g)</span><b class="don">–</b></div>
      </div>
      ${SRC_HTML}
    </article>`;
  }

  const chips = it.extra === 'jpy'
    ? `<div class="chips"><span class="chip usd"><span class="lb">USD/JPY</span><b class="uv">–</b></span></div>`
    : '';

  return `<article class="card" data-id="${it.id}">
    ${headHtml(it)}
    <div class="price"><span class="pre"></span><span class="num">–</span><span class="unit">${it.unit}</span></div>
    ${DELTA_HTML}
    ${chips}
    <div class="range"><div class="bar"><i></i><b></b></div><div class="rl"><span class="lo"></span><span class="hi"></span></div></div>
    ${SRC_HTML}
  </article>`;
}

function cacheRefs(it) {
  const card = document.querySelector(`.card[data-id="${it.id}"]`);
  const r = {
    card,
    num: $('.num', card),
    pre: $('.pre', card),
    unit: $('.unit', card),
    delta: $('.delta', card),
    tag: $('.tag', card),
    src: $('.src .tx', card),
    srcDot: $('.src .d', card),
  };
  if (!it.wide) {
    r.barFill = $('.bar i', card);
    r.barDot = $('.bar b', card);
    r.lo = $('.rl .lo', card);
    r.hi = $('.rl .hi', card);
    r.range = $('.range', card);
  }
  if (it.id === 'btc') {
    r.premBox = $('.chip.prem', card);
    r.prem = $('.chip.prem b', card);
  }
  if (it.extra === 'jpy' || it.id === 'btc') {
    r.usd = $('.chip.usd b', card);
    r.usdLb = $('.chip.usd .lb', card);
  }
  if (it.id === 'gold' || it.id === 'silver') {
    r.g = $('.conv .g', card);
    r.don = $('.conv .don', card);
  }
  refs[it.id] = r;
}

/* ── 공유 문구 ────────────────────────────────────── */
function line(id, name, dp) {
  const q = Q[id];
  if (!q || !(q.price > 0)) return null;
  const d = dp ?? (ITEMS.find(i => i.id === id)?.dp || 2);
  if (q.change === 0) return `${name} ${fmt(q.price, d)} 보합`;
  return `${name} ${fmt(q.price, d)} ${arrow(q.change)}${fmtAbs(q.change, d)} (${fmtPct(q.pct)})`;
}

function buildShareText() {
  const now = lastOkAt || new Date();
  const p = kstParts(now);
  const L = [];
  L.push(`📈 ${p.month}/${p.day} ${p.hour}:${p.minute} 실시간 시세`);
  L.push('');

  const block = (title, rows) => {
    const list = rows.filter(Boolean);
    if (!list.length) return;
    L.push(title);
    list.forEach(t => L.push('· ' + t));
    L.push('');
  };

  block('🇰🇷 국내증시', [
    line('kospi', '코스피'),
    line('kosdaq', '코스닥'),
    line('kospi200', '코스피200(현물)'),
  ]);

  block('🇺🇸 미국증시 · 선물', [
    line('nasdaq', '나스닥'),
    line('dow', '다우존스'),
    line('ndx', '나스닥100 선물'),
    line('sox', '반도체(SOX)'),
    line('vix', 'VIX'),
  ]);

  block('🇯🇵 일본증시 · 선물', [
    line('n225', '닛케이225'),
    line('n225f', '닛케이 선물'),
  ]);

  const fxRows = [
    line('usdkrw', '원/달러'),
    (Q.jpy100 && Q.jpy100.price > 0)
      ? `100엔/원 ${fmt(Q.jpy100.price, 2)}원 ${arrow(Q.jpy100.change)}${fmtAbs(Q.jpy100.change, 2)} (${fmtPct(Q.jpy100.pct)}) · USD/JPY ${fmt(Q.jpy?.price, 2)}`
      : null,
    line('dxy', '달러인덱스'),
  ];
  block('💱 환율 · 달러', fxRows);

  if (B.krw) {
    L.push('🪙 코인');
    L.push(`· 비트코인 ${fmt(B.krw.price, 0)}원 ${arrow(B.krw.change)}${fmtPctAbs(B.krw.pct)} (업비트)`);
    const fx = Q.usdkrw && Q.usdkrw.price;
    const usd = B.usd && B.usd.price;
    if (usd && fx) {
      const prem = (B.krw.price / (usd * fx) - 1) * 100;
      L.push(`· 김치프리미엄 ${fmtPct(prem)} · $${fmt(usd, 2)} (${B.usd.source})`);
    }
    L.push('');
  }

  const cmd = [
    line('wti', 'WTI'),
    line('brent', '브렌트'),
  ].map(t => (t ? t.replace(' ', ' $') : t));
  const fx = Q.usdkrw && Q.usdkrw.price;
  for (const [m, nm] of [[M.gold, '금'], [M.silver, '은']]) {
    if (!m) continue;
    let s = `${nm} $${fmt(m.price, 2)}/oz`;
    if (fx) {
      const perG = (m.price * fx) / OZ_TO_G;
      s += ` (1g ${fmt(perG, 0)}원 · 1돈 ${fmt(perG * DON_G, 0)}원)`;
    }
    cmd.push(s);
  }
  block('🛢️ 원유 · 귀금속', cmd);

  const sources = [...new Set([Q.kospi?.source, '업비트', B.usd?.source, Q.dxy?.source, 'gold-api'].filter(Boolean))];
  L.push(`출처 ${sources.join('·')}`);
  return L.join('\n');
}

/* ── 클립보드 ─────────────────────────────────────── */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* 폴백 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) { return false; }
}

let toastTimer = null;
function flash(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

function openModal(text) {
  $('#modalText').value = text;
  $('#modal').hidden = false;
  setTimeout(() => {
    const ta = $('#modalText');
    ta.focus();
    ta.select();
  }, 60);
}

function hasAnyData() {
  return Object.keys(Q).some(k => Q[k] && Q[k].price > 0) || !!(B.krw && B.krw.price > 0) || !!(M.gold || M.silver);
}

/* ── 이벤트 ───────────────────────────────────────── */
function bind() {
  $('#copyBtn').addEventListener('click', async () => {
    if (!hasAnyData()) {
      flash('아직 시세를 못 불러왔어요. 잠시 후 다시 시도해 주세요');
      return;
    }
    const ok = await copyText(buildShareText());
    if (ok) {
      const b = $('#copyBtn');
      b.classList.add('done');
      setTimeout(() => b.classList.remove('done'), 1500);
      flash('복사했어요! 단톡방에 붙여넣기 하세요 📋');
    } else {
      openModal(buildShareText());
    }
  });

  $('#modalClose').addEventListener('click', () => { $('#modal').hidden = true; });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });
  $('#modalCopy').addEventListener('click', async () => {
    const ok = await copyText($('#modalText').value);
    flash(ok ? '복사했어요!' : '길게 눌러 직접 복사해 주세요');
  });

  $('#refreshBtn').addEventListener('click', () => {
    Object.values(SRC).forEach(s => { s.nextAt = 0; });
    tick();
    updateStatus(true);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      Object.values(SRC).forEach(s => { s.nextAt = 0; });
      tick();
    }
  });
}

/* ── 시계·카운트다운 ──────────────────────────────── */
function startClock() {
  const clockEl = $('#clock');
  const cdEl = $('#countdown');
  setInterval(() => {
    clockEl.textContent = kstClock.format(new Date());
    if (document.visibilityState !== 'visible') { cdEl.textContent = '일시정지'; return; }
    const left = Math.max(0, Math.ceil((nextTickAt - Date.now()) / 1000));
    cdEl.textContent = `${left}초 후 갱신`;
  }, 1000);
}

/* ── 시작 ─────────────────────────────────────────── */
function init() {
  buildCards();
  bind();
  startClock();
  connectUpbit();
  tick();
  updateStatus();
  setInterval(() => {
    tick();
    // 끊긴 소스가 있으면 상태 문구도 갱신
    if (Date.now() - (lastOkAt?.getTime() || 0) > 12000) updateStatus();
  }, REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', init);
