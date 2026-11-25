/* 실시간 시세 대시보드
 * 데이터: CNBC Quote(지수·주식·환율), 업비트(KRW-BTC), Coinbase(BTC-USD), gold-api(금·은 현물)
 * 폴백: Yahoo Finance(스파크) → r.jina.ai 텍스트 프록시, open.er-api.com(환율)
 */
'use strict';

const REFRESH_MS = 30_000;          // 자동 갱신 주기
const STALE_MS = 8 * 60 * 1000;     // 이보다 오래된 시세는 '지연' 표시
const OZ_TO_G = 31.1034768;
const DON_G = 3.75;

/* ── 표시 항목 정의 ───────────────────────────────── */
const GROUPS = ['국내증시', '미국증시', '암호화폐', '환율', '귀금속'];

const ITEMS = [
  { id: 'kospi',  group: '국내증시', name: '코스피',   sub: 'KOSPI',  ico: '🇰🇷', unit: 'p', dp: 2, digits: 0 },
  { id: 'kosdaq', group: '국내증시', name: '코스닥',   sub: 'KOSDAQ', ico: '🇰🇷', unit: 'p', dp: 2, digits: 0 },
  { id: 'nasdaq', group: '미국증시', name: '나스닥',   sub: 'NASDAQ', ico: '🇺🇸', unit: 'p', dp: 2, digits: 0 },
  { id: 'dow',    group: '미국증시', name: '다우존스', sub: 'DOW',    ico: '🇺🇸', unit: 'p', dp: 2, digits: 0 },
  { id: 'nvda',   group: '미국증시', name: '엔비디아', sub: 'NVDA',   ico: '🟩', unit: '',  dp: 2, digits: 2, pre: '$' },
  { id: 'btc',    group: '암호화폐', name: '비트코인', sub: 'BTC',    ico: '🪙', unit: '원', dp: 0, digits: 0, wide: true, cls: 'coin-card' },
  { id: 'usdkrw', group: '환율',     name: '원/달러',  sub: 'USD/KRW', ico: '💵', unit: '원', dp: 2, digits: 2 },
  { id: 'gold',   group: '귀금속',   name: '국제 금',  sub: 'XAU/USD', ico: '🥇', unit: '/oz', dp: 2, digits: 2, wide: true, cls: 'gold-card', pre: '$' },
  { id: 'silver', group: '귀금속',   name: '국제 은',  sub: 'XAG/USD', ico: '🥈', unit: '/oz', dp: 2, digits: 2, wide: true, cls: 'silver-card', pre: '$' },
];

/* ── 상태 ─────────────────────────────────────────── */
const Q = {};                        // 지수·주식·환율 (id → 시세)
const B = { krw: null, usd: null };  // 비트코인
const M = { gold: null, silver: null }; // 금·은 현물
const refs = {};                     // 카드 DOM 참조

let lastCycleAt = null;
let nextCycleAt = Date.now() + REFRESH_MS;
let running = false;
let lastError = null;

/* ── 유틸 ─────────────────────────────────────────── */
const $ = (s, el = document) => el.querySelector(s);

function num(v) {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(/[,\s%+]/g, ''));
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

function fmtChange(c, dp = 2) {
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

function kstTime(d) {
  const parts = Object.fromEntries(kstFmt.formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function ageMinutes(ts) {
  if (!ts) return null;
  return (Date.now() - ts.getTime()) / 60000;
}

async function fetchWithTimeout(url, ms = 9000, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal, cache: 'no-store', ...opts });
  } finally {
    clearTimeout(t);
  }
}

async function getJSON(url, ms = 9000) {
  const r = await fetchWithTimeout(url, ms);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* ── 소스 1. CNBC (지수·주식·환율, CORS 허용) ────────── */
const CNBC_SYMBOLS = '.KS11|.KQ11|.IXIC|.DJI|NVDA|@GC.1|@SI.1|KRW=';
const CNBC_MAP = {
  '.KS11': 'kospi', '.KQ11': 'kosdaq', '.IXIC': 'nasdaq', '.DJI': 'dow',
  'NVDA': 'nvda', '@GC.1': 'goldF', '@SI.1': 'silverF', 'KRW=': 'usdkrw',
};
const CNBC_URL =
  'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' +
  encodeURIComponent(CNBC_SYMBOLS) +
  '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1';

async function loadCnbc() {
  const j = await getJSON(CNBC_URL, 9000);
  const list = j?.FormattedQuoteResult?.FormattedQuote;
  if (!Array.isArray(list) || !list.length) throw new Error('CNBC 응답 비어 있음');

  let ok = 0;
  for (const q of list) {
    const id = CNBC_MAP[q.symbol];
    if (!id) continue;
    const price = num(q.last);
    if (!(price > 0)) continue;

    const change = num(q.change);
    const pct = num(q.change_pct);
    const prev = num(q.previous_day_closing) || (Number.isFinite(change) ? price - change : NaN);
    const ts = parseTs(q.last_time);

    Q[id] = {
      price,
      change,
      pct: Number.isFinite(pct) ? pct : (prev ? (change / prev) * 100 : NaN),
      prev,
      high: num(q.high),
      low: num(q.low),
      ts,
      dateOnly: !ts,
      source: 'CNBC',
      status: q.curmktstatus || '',
      delayed: q.realTime === 'false',
      live: true,
    };
    ok++;
  }
  if (!ok) throw new Error('CNBC 유효 시세 없음');
  return 'cnbc';
}

/* ── 소스 2. Yahoo Finance (폴백, r.jina.ai 경유) ───── */
const Y_SPARK =
  'https://query1.finance.yahoo.com/v7/finance/spark?symbols=' +
  encodeURIComponent('^KS11,^KQ11,^IXIC,^DJI,NVDA,KRW=X,GC=F,SI=F') +
  '&range=1d&interval=1d';
const Y_MAP = {
  '^KS11': 'kospi', '^KQ11': 'kosdaq', '^IXIC': 'nasdaq', '^DJI': 'dow',
  'NVDA': 'nvda', 'KRW=X': 'usdkrw', 'GC=F': 'goldF', 'SI=F': 'silverF',
};

async function loadYahoo() {
  const r = await fetchWithTimeout('https://r.jina.ai/' + Y_SPARK, 14000);
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
    const ts = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000) : null;

    Q[id] = {
      price,
      change,
      pct: Number.isFinite(pct) ? pct : (prev ? (change / prev) * 100 : NaN),
      prev,
      high: NaN,
      low: NaN,
      ts,
      dateOnly: false,
      source: 'Yahoo',
      status: '',
      delayed: true,
      live: true,
    };
    ok++;
  }
  if (!ok) throw new Error('Yahoo 유효 시세 없음');
  return 'yahoo';
}

/* ── 소스 3. 업비트 (원화 비트코인) ──────────────────── */
async function loadUpbit() {
  const j = await getJSON('https://api.upbit.com/v1/ticker?markets=KRW-BTC', 8000);
  const t = Array.isArray(j) ? j[0] : null;
  if (!t) throw new Error('업비트 응답 없음');
  B.krw = {
    price: num(t.trade_price),
    change: num(t.signed_change_price),
    pct: num(t.signed_change_rate) * 100,
    prev: num(t.prev_closing_price),
    high: num(t.high_price),
    low: num(t.low_price),
    ts: new Date(num(t.trade_timestamp) || Date.now()),
    source: '업비트',
  };
  return 'upbit';
}

/* ── 소스 4. BTC 달러 시세 (Coinbase → Binance) ───────── */
async function loadBtcUsd() {
  try {
    const j = await getJSON('https://api.coinbase.com/v2/prices/BTC-USD/spot', 7000);
    const p = num(j?.data?.amount);
    if (p > 0) {
      B.usd = { price: p, ts: new Date(), source: 'Coinbase' };
      return 'coinbase';
    }
  } catch (_) { /* 다음 제공자 */ }

  const j = await getJSON('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', 7000);
  const p = num(j?.price);
  if (!(p > 0)) throw new Error('달러 시세 없음');
  B.usd = { price: p, ts: new Date(), source: 'Binance' };
  return 'binance';
}

/* ── 소스 5. 금·은 현물 (gold-api.com) ──────────────── */
async function loadMetal(sym) {
  const j = await getJSON(`https://api.gold-api.com/price/${sym}`, 8000);
  const p = num(j?.price);
  if (!(p > 0)) throw new Error(sym + ' 시세 없음');
  return { price: p, ts: parseTs(j.updatedAt) || new Date(), source: 'gold-api' };
}

/* ── 환율 폴백 ────────────────────────────────────── */
async function loadFxFallback() {
  const j = await getJSON('https://open.er-api.com/v6/latest/USD', 8000);
  const p = num(j?.rates?.KRW);
  if (!(p > 0)) throw new Error('환율 없음');
  Q.usdkrw = {
    price: p, change: NaN, pct: NaN, prev: NaN, high: NaN, low: NaN,
    ts: new Date(j.time_last_update_unix ? j.time_last_update_unix * 1000 : Date.now()),
    dateOnly: false, source: 'er-api', status: '', delayed: true, live: true,
  };
}

/* ── 전체 갱신 ────────────────────────────────────── */
async function refreshAll(manual = false) {
  if (running) return;
  running = true;
  $('#refreshBtn').classList.add('spin');

  const fail = [];

  // 1) 지수·주식·환율: CNBC → Yahoo 폴백
  try {
    await loadCnbc();
  } catch (e1) {
    try {
      await loadYahoo();
    } catch (e2) {
      fail.push('지수·환율');
      lastError = (e1 && e1.message) || '알 수 없는 오류';
    }
  }

  // 2) 환율이 비어 있으면 보조 소스
  if (!Q.usdkrw || !(Q.usdkrw.price > 0)) {
    try { await loadFxFallback(); } catch (_) { /* 무시 */ }
  }

  // 3) 코인·귀금속 (서로 독립)
  const tasks = [
    loadUpbit().catch(() => fail.push('업비트')),
    (B.usd ? Promise.resolve() : loadBtcUsd()).catch(() => fail.push('BTC 달러')),
    loadMetal('XAU').then(m => { M.gold = m; }).catch(() => fail.push('금')),
    loadMetal('XAG').then(m => { M.silver = m; }).catch(() => fail.push('은')),
  ];
  await Promise.allSettled(tasks);

  running = false;
  lastCycleAt = new Date();
  nextCycleAt = Date.now() + REFRESH_MS;
  $('#refreshBtn').classList.remove('spin');

  renderAll();
  updateStatus(fail, manual);
}

function updateStatus(fail, manual) {
  const dot = $('#statusDot');
  const txt = $('#statusText');
  dot.className = 'sd';

  const time = lastCycleAt ? kstClock.format(lastCycleAt) : '--:--:--';

  if (manual) flash('새로고침 완료');

  if (!fail.length) {
    txt.textContent = `${time} 갱신 완료`;
  } else if (fail.length >= 5) {
    dot.classList.add('err');
    txt.textContent = `${time} · 시세를 불러오지 못했어요 (자동 재시도 중)`;
  } else {
    dot.classList.add('warn');
    txt.textContent = `${time} · 일부 지연 (${fail.join(', ')})`;
  }
}

/* ── 렌더 ─────────────────────────────────────────── */
function renderAll() {
  renderQuotes();
  renderBtc();
  renderMetals();
}

function paintIndex(id) {
  const it = ITEMS.find(i => i.id === id);
  const r = refs[id];
  if (!r) return;
  const q = Q[id];

  if (!q || !(q.price > 0)) {
    r.card.classList.add('stale');
    r.num.textContent = '–';
    r.delta.textContent = '불러오는 중…';
    r.src.textContent = '연결 중';
    return;
  }

  const dir = dirOf(q.change, q.pct);
  r.card.classList.remove('up', 'down', 'flat', 'stale');
  r.card.classList.add(dir);

  const age = ageMinutes(q.ts);
  const stale = Number.isFinite(age) && age > STALE_MS / 60000;

  r.num.textContent = fmt(q.price, it.dp);
  r.pre.textContent = it.pre || '';
  r.unit.textContent = it.unit;

  r.delta.innerHTML =
    `<span class="ar">${arrow(q.change)}</span>` +
    `<span class="ab">${fmtChange(q.change, it.digits)}</span>` +
    `<span class="pc">(${fmtPct(q.pct)})</span>`;

  // 일중 범위
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

  // 상태 태그
  const st = marketTag(q);
  if (st) {
    r.tag.hidden = false;
    r.tag.className = 'tag ' + st.cls;
    r.tag.textContent = st.label;
  } else {
    r.tag.hidden = true;
  }

  if (st && st.cls === 'closed') r.card.classList.add('stale');

  // 출처 / 시각
  const t = q.ts ? kstTime(q.ts) : null;
  const bits = [q.source];
  if (q.dateOnly) bits.push('전일 종가');
  else if (t) bits.push(t);
  if (stale || q.delayed) {
    if (Number.isFinite(age) && age >= 1) bits.push(`${Math.round(age)}분 지연`);
    else bits.push('지연');
    r.srcDot.classList.add('old');
  } else {
    r.srcDot.classList.remove('old');
  }
  r.src.textContent = bits.join(' · ');
}

function marketTag(q) {
  const s = (q.status || '').toUpperCase();
  if (s === 'REG_MKT') return { label: '장중', cls: 'open' };
  if (s === 'PRE_MKT') return { label: '장전', cls: 'after' };
  if (s === 'POST_MKT') return { label: '시간외', cls: 'after' };
  if (s.startsWith('CLOSED')) return { label: '마감', cls: 'closed' };
  return null;
}

function renderQuotes() {
  ['kospi', 'kosdaq', 'nasdaq', 'dow', 'nvda', 'usdkrw'].forEach(paintIndex);
}

function renderBtc() {
  const r = refs.btc;
  if (!r) return;
  const k = B.krw;
  if (!k) {
    r.card.classList.add('stale');
    r.num.textContent = '–';
    r.delta.textContent = '불러오는 중…';
    return;
  }

  const dir = dirOf(k.change, k.pct);
  r.card.classList.remove('up', 'down', 'flat', 'stale');
  r.card.classList.add(dir);

  r.num.textContent = fmt(k.price, 0);
  r.delta.innerHTML =
    `<span class="ar">${arrow(k.change)}</span>` +
    `<span class="ab">${fmtChange(k.change, 0)}</span>` +
    `<span class="pc">(${fmtPct(k.pct)})</span>`;

  // 김치 프리미엄
  const fx = Q.usdkrw && Q.usdkrw.price;
  const usd = B.usd && B.usd.price;
  if (fx && usd) {
    const prem = (k.price / (usd * fx) - 1) * 100;
    r.prem.textContent = fmtPct(prem);
    r.premBox.classList.remove('up', 'down');
    r.premBox.classList.add(prem >= 0 ? 'up' : 'down');
    r.premBox.style.display = '';
  } else {
    r.premBox.style.display = 'none';
  }

  r.usd.textContent = usd ? '$' + fmt(usd, 2) : '–';
  r.usdLb.textContent = B.usd ? B.usd.source : 'USD';

  const when = kstClock.format(k.ts);
  r.src.textContent = `${k.source} · ${when} · 24시간 거래`;
  r.srcDot.classList.remove('old');
}

function renderMetals() {
  const fx = Q.usdkrw && Q.usdkrw.price;
  for (const [id, metal, futId] of [['gold', M.gold, 'goldF'], ['silver', M.silver, 'silverF']]) {
    const r = refs[id];
    if (!r) continue;
    const fut = Q[futId];

    if (!metal) {
      r.card.classList.add('stale');
      r.num.textContent = '–';
      r.delta.textContent = '불러오는 중…';
      continue;
    }

    // 등락은 COMEX 선물 기준(현물 가격 자체에는 전일 종가가 없음)
    const dir = fut ? dirOf(fut.change, fut.pct) : 'flat';
    r.card.classList.remove('up', 'down', 'flat', 'stale');
    r.card.classList.add(dir);

    r.num.textContent = fmt(metal.price, 2);
    if (fut && Number.isFinite(fut.pct)) {
      r.delta.innerHTML =
        `<span class="ar">${arrow(fut.change)}</span>` +
        `<span class="pc">${fmtPct(fut.pct)}</span>` +
        `<span class="ar" style="opacity:.6">· 선물 기준</span>`;
    } else {
      r.delta.textContent = '등락 정보 없음';
    }

    if (fx) {
      const perG = (metal.price * fx) / OZ_TO_G;
      r.g.textContent = fmt(perG, 0) + '원';
      r.don.textContent = fmt(perG * DON_G, 0) + '원';
    } else {
      r.g.textContent = '–';
      r.don.textContent = '–';
    }

    const when = kstClock.format(metal.ts);
    r.src.textContent = `${metal.source} · ${when} · 현물`;
    r.srcDot.classList.remove('old');
  }
}

/* ── 카드 DOM 구성 ────────────────────────────────── */
function buildCards() {
  const root = $('#cards');
  root.innerHTML = '';

  for (const g of GROUPS) {
    const section = document.createElement('section');
    const h = document.createElement('h2');
    h.className = 'grp';
    h.textContent = g;
    const grid = document.createElement('div');
    grid.className = 'grid';
    section.append(h, grid);

    for (const it of ITEMS.filter(i => i.group === g)) {
      grid.insertAdjacentHTML('beforeend', template(it));
      cacheRefs(it);
    }
    root.appendChild(section);
  }
}

function template(it) {
  const head =
    `<div class="card-head"><span class="ico">${it.ico}</span>` +
    `<span class="nm">${it.name}</span><span class="tag mkt" hidden></span>` +
    `<span class="sub">${it.sub}</span></div>`;

  const delta = `<div class="delta"><span class="ar"></span><span class="ab"></span><span class="pc"></span></div>`;
  const src = `<div class="src"><span class="d"></span><span class="tx">연결 중</span></div>`;

  if (it.id === 'btc') {
    return `<article class="card wide ${it.cls || ''}" data-id="${it.id}">
      ${head}
      <div class="price"><span class="pre"></span><span class="num">–</span><span class="unit">원</span></div>
      ${delta}
      <div class="chips">
        <span class="chip prem" style="display:none"><span class="lb">김치프리미엄</span><b class="pv">–</b></span>
        <span class="chip usd"><span class="lb">USD</span><b class="uv">–</b></span>
      </div>
      ${src}
    </article>`;
  }

  if (it.id === 'gold' || it.id === 'silver') {
    return `<article class="card wide ${it.cls || ''}" data-id="${it.id}">
      ${head}
      <div class="price"><span class="pre">$</span><span class="num">–</span><span class="unit">/oz</span></div>
      ${delta}
      <div class="conv">
        <div><span class="lb">1g 환산</span><b class="g">–</b></div>
        <div><span class="lb">1돈 (3.75g)</span><b class="don">–</b></div>
      </div>
      ${src}
    </article>`;
  }

  return `<article class="card" data-id="${it.id}">
    ${head}
    <div class="price"><span class="pre"></span><span class="num">–</span><span class="unit">${it.unit}</span></div>
    ${delta}
    <div class="range"><div class="bar"><i></i><b></b></div><div class="rl"><span class="lo"></span><span class="hi"></span></div></div>
    ${src}
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
  if (it.id !== 'btc' && it.id !== 'gold' && it.id !== 'silver') {
    r.barFill = $('.bar i', card);
    r.barDot = $('.bar b', card);
    r.lo = $('.rl .lo', card);
    r.hi = $('.rl .hi', card);
    r.range = $('.range', card);
  }
  if (it.id === 'btc') {
    r.premBox = $('.chip.prem', card);
    r.prem = $('.chip.prem b', card);
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
function lineIndex(id, name, dp) {
  const q = Q[id];
  if (!q || !(q.price > 0)) return null;
  return `${name} ${fmt(q.price, dp)} ${arrow(q.change)}${fmtChange(q.change, dp)} (${fmtPct(q.pct)})`;
}

function buildShareText() {
  const now = lastCycleAt || new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(now).map(x => [x.type, x.value])
  );

  const L = [];
  L.push(`📈 ${p.month}/${p.day} ${p.hour}:${p.minute} 실시간 시세`);
  L.push('');

  const kr = [lineIndex('kospi', '코스피', 2), lineIndex('kosdaq', '코스닥', 2)].filter(Boolean);
  if (kr.length) {
    L.push('🇰🇷 국내증시');
    kr.forEach(t => L.push('· ' + t));
    L.push('');
  }

  const us = [
    lineIndex('nasdaq', '나스닥', 2),
    lineIndex('dow', '다우존스', 2),
    (Q.nvda && Q.nvda.price > 0)
      ? `엔비디아 $${fmt(Q.nvda.price, 2)} ${arrow(Q.nvda.change)}${fmtChange(Q.nvda.change, 2)} (${fmtPct(Q.nvda.pct)})`
      : null,
  ].filter(Boolean);
  if (us.length) {
    L.push('🇺🇸 미국증시');
    us.forEach(t => L.push('· ' + t));
    L.push('');
  }

  if (B.krw) {
    L.push('🪙 코인');
    L.push(`· 비트코인 ${fmt(B.krw.price, 0)}원 ${arrow(B.krw.change)}${fmtPct(B.krw.pct)} (업비트)`);
    const fx = Q.usdkrw && Q.usdkrw.price;
    const usd = B.usd && B.usd.price;
    if (usd && fx) {
      const prem = (B.krw.price / (usd * fx) - 1) * 100;
      L.push(`· 김치프리미엄 ${fmtPct(prem)} · $${fmt(usd, 2)} (${B.usd.source})`);
    }
    L.push('');
  }

  if (Q.usdkrw && Q.usdkrw.price > 0) {
    L.push('💵 환율');
    L.push(`· 원/달러 ${fmt(Q.usdkrw.price, 2)}원 ${arrow(Q.usdkrw.change)}${fmtChange(Q.usdkrw.change, 2)} (${fmtPct(Q.usdkrw.pct)})`);
    L.push('');
  }

  const fx = Q.usdkrw && Q.usdkrw.price;
  const metalLines = [];
  for (const [m, nm] of [[M.gold, '금'], [M.silver, '은']]) {
    if (!m) continue;
    let s = `· ${nm} $${fmt(m.price, 2)}/oz`;
    if (fx) {
      const perG = (m.price * fx) / OZ_TO_G;
      s += ` (1g ${fmt(perG, 0)}원 · 1돈 ${fmt(perG * DON_G, 0)}원)`;
    }
    metalLines.push(s);
  }
  if (metalLines.length) {
    L.push('🥇 귀금속');
    metalLines.forEach(t => L.push(t));
    L.push('');
  }

  L.push(`출처 ${[...new Set([Q.kospi?.source, '업비트', B.usd?.source, 'gold-api'].filter(Boolean))].join('·')}`);

  return L.join('\n');
}

/* ── 클립보드 ─────────────────────────────────────── */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* 폴백으로 */ }

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
  } catch (_) {
    return false;
  }
}

let toastTimer = null;
function flash(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
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

/* ── 이벤트 ───────────────────────────────────────── */
function bind() {
  $('#copyBtn').addEventListener('click', async () => {
    const text = buildShareText();
    const ok = await copyText(text);
    if (ok) {
      const b = $('#copyBtn');
      b.classList.add('done');
      setTimeout(() => b.classList.remove('done'), 1500);
      flash('복사했어요! 단톡방에 붙여넣기 하세요 📋');
    } else {
      openModal(text);
    }
  });

  $('#modalClose').addEventListener('click', () => { $('#modal').hidden = true; });
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') $('#modal').hidden = true;
  });
  $('#modalCopy').addEventListener('click', async () => {
    const ok = await copyText($('#modalText').value);
    flash(ok ? '복사했어요!' : '길게 눌러 직접 복사해 주세요');
  });

  $('#refreshBtn').addEventListener('click', () => refreshAll(true));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (Date.now() - (lastCycleAt?.getTime() || 0) > REFRESH_MS) refreshAll();
    }
  });
}

/* ── 시계·카운트다운 ──────────────────────────────── */
function startClock() {
  const clockEl = $('#clock');
  const cdEl = $('#countdown');

  setInterval(() => {
    const now = new Date();
    clockEl.textContent = kstClock.format(now);

    const left = Math.max(0, Math.ceil((nextCycleAt - Date.now()) / 1000));
    cdEl.textContent = document.visibilityState === 'visible'
      ? `${left}초 후 갱신`
      : '일시정지';
  }, 1000);
}

/* ── 시작 ─────────────────────────────────────────── */
function init() {
  buildCards();
  bind();
  startClock();
  refreshAll();
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshAll();
    else nextCycleAt = Date.now() + REFRESH_MS;
  }, REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', init);
