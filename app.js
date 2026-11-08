'use strict';
(() => {
// ================= Yardımcılar =================
const $ = id => document.getElementById(id);
const TL = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
const TL2 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 });
const N2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat('tr-TR', { notation: 'compact' });
const today = () => new Date().toLocaleDateString('sv-SE');
const thisMonth = () => today().slice(0, 7);
// Türkçe yazımı anlar: "1.250,50" → 1250.5, "450.000" → 450000, "12.5" → 12.5
const parseNum = s => {
  s = String(s ?? '').trim().replace(/[\s₺]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s); return s && isFinite(n) ? n : NaN;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dShort = d => new Date(d + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
const dLong = d => d.split('-').reverse().join('.');
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const monthName = m => new Date(m + '-15T12:00:00').toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
const monthShort = m => new Date(m + '-15T12:00:00').toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' });
const daysInMonth = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const CATS = [
  ['yemek', '☕', 'Yemek & kahve'], ['ulasim', '🚌', 'Ulaşım'], ['alisveris', '🛍️', 'Alışveriş'],
  ['eglence', '🎮', 'Eğlence'], ['abonelik', '📱', 'Abonelik'], ['duzenli', '🏦', 'Düzenli birikim'],
  ['gelir', '💼', 'Ek gelir'], ['diger', '✨', 'Diğer']
];
const WCATS = [['harcama', '💸', 'Harcama'], ['acil', '🚑', 'Acil durum'], ['diger', '✨', 'Diğer']];
// Nakit <-> altın aktarımları: toplam nakdi değiştirir ama aylık hedefi/aylık birikimi etkilemez.
const XCATS = [['altin', '🪙', 'Altın alımı'], ['altinsatis', '🪙', 'Altın satışı']];
const TRANSFER = new Set(['altin', 'altinsatis']);
const catInfo = (k, kind) => (kind === 'withdraw' ? WCATS : CATS).find(c => c[0] === k)
  || CATS.concat(WCATS, XCATS).find(c => c[0] === k) || ['diger', '✨', 'Diğer'];

const GOLD = {
  GRA: ['Gram altın', 'gram'], CEYREKALTIN: ['Çeyrek altın', 'adet'], YARIMALTIN: ['Yarım altın', 'adet'],
  TAMALTIN: ['Tam altın', 'adet'], CUMHURIYETALTINI: ['Cumhuriyet altını', 'adet'], ATAALTIN: ['Ata altın', 'adet'],
  YIA: ['22 ayar bilezik', 'gram'], '18AYARALTIN': ['18 ayar', 'gram'], '14AYARALTIN': ['14 ayar', 'gram'], HAS: ['Has altın', 'gram']
};
const SHOW_PRICES = ['GRA', 'CEYREKALTIN', 'YARIMALTIN', 'TAMALTIN', 'CUMHURIYETALTINI', 'YIA'];
const MILESTONES = [10, 25, 50, 75, 100];
const PRICE_API = 'https://finans.truncgil.com/v4/today.json';

// ================= Durum & yerel depolama (IndexedDB) =================
const EMPTY = () => ({ v: 1, entries: [], gold: [], settings: { includeGold: true }, monthGoals: {}, prices: null, hist: {} });
let S = EMPTY();
let view = 'ozet', charts = {}, lastPct = null, lastMonthPct = null, armed = false;

const IDB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('birikimim', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  get(key) {
    return new Promise((res, rej) => {
      const q = this.db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  },
  put(key, val) {
    return new Promise((res, rej) => {
      const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    });
  }
};
let saveChain = Promise.resolve();
function save() {
  const snapshot = JSON.parse(JSON.stringify(S));
  saveChain = saveChain.then(() => IDB.put('state', snapshot)).catch(e => { console.error(e); toast('⚠️ Kaydedilemedi: depolama hatası'); });
  return saveChain;
}
function normalize(d) {
  const s = Object.assign(EMPTY(), d || {});
  s.settings = Object.assign({ includeGold: true }, s.settings || {});
  s.monthGoals = s.monthGoals || {}; s.hist = s.hist || {};
  s.entries = (s.entries || []).filter(e => e && e.date && isFinite(e.amount)).map(e => ({ id: e.id || uid(), kind: e.kind === 'withdraw' ? 'withdraw' : 'save', amount: +e.amount, category: e.category || 'diger', note: String(e.note || '').slice(0, 120), date: String(e.date).slice(0, 10), ts: +e.ts || Date.now(), ...(e.link ? { link: String(e.link) } : {}) }));
  s.gold = (s.gold || []).filter(g => g && GOLD[g.type] && isFinite(g.qty)).map(g => ({ id: g.id || uid(), type: g.type, qty: +g.qty, unit: +g.unit || 0, date: String(g.date).slice(0, 10), ts: +g.ts || Date.now(), ...(g.link ? { link: String(g.link) } : {}) }));
  sortEntries(s);
  return s;
}
const sortEntries = (s = S) => s.entries.sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);

// ================= Hesaplamalar =================
let histDays = [];
const refreshHistDays = () => { histDays = Object.keys(S.hist).sort(); };
function priceOf(type, date) {
  if (date && date < today()) {
    for (let i = histDays.length - 1; i >= 0; i--) { if (histDays[i] <= date && S.hist[histDays[i]][type]) return S.hist[histDays[i]][type]; }
  }
  const p = S.prices?.items?.[type]?.buy; if (p) return p;
  for (let i = histDays.length - 1; i >= 0; i--) { if (S.hist[histDays[i]][type]) return S.hist[histDays[i]][type]; }
  const buys = S.gold.filter(g => g.type === type && g.unit > 0);
  return buys.length ? buys.reduce((a, b) => a + b.unit, 0) / buys.length : 0;
}
const signed = e => e.kind === 'withdraw' ? -e.amount : e.amount;
const cashTotal = upTo => S.entries.reduce((a, e) => a + (!upTo || e.date <= upTo ? signed(e) : 0), 0);
function holdings(upTo) { const h = {}; S.gold.forEach(g => { if (!upTo || g.date <= upTo) h[g.type] = (h[g.type] || 0) + g.qty; }); return h; }
function goldValue(upTo) { const h = holdings(upTo); let v = 0; for (const t in h) v += h[t] * priceOf(t, upTo); return v; }
function goldCost() {
  const per = {};
  [...S.gold].sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts).forEach(g => {
    const p = per[g.type] || (per[g.type] = { q: 0, c: 0 });
    if (g.qty > 0) { p.q += g.qty; p.c += g.qty * (g.unit || priceOf(g.type, g.date)); }
    else { const avg = p.q ? p.c / p.q : 0; p.q += g.qty; p.c += g.qty * avg; }
  });
  return Object.values(per).reduce((a, p) => a + p.c, 0);
}
// Aylık/haftalık "gerçek birikim": aktarımlar hariç
const sumRange = (from, to) => S.entries.reduce((a, e) => a + (e.date >= from && e.date <= to && !TRANSFER.has(e.category) ? signed(e) : 0), 0);
function monthNet(m) { return sumRange(m + '-01', m + '-31'); }
const monthOnly = m => new Date(m + '-15T12:00:00').toLocaleDateString('tr-TR', { month: 'long' });
function prevMonth(m) { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; }
function addMonths(m, n) { const [y, mo] = m.split('-').map(Number); const t = y * 12 + (mo - 1) + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; }
function monthsBetween(a, b) { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); }
// Aylık hız: tamamlanmış takvim aylarının gerçek toplamlarının ortalaması (günlük hızdan türetilmez).
// Henüz tamamlanmış ay yoksa bu ayın şu ana kadarki toplamı kullanılır.
function monthlyPace() {
  const m = thisMonth(), cur = monthNet(m);
  const done = monthsRange().filter(x => x < m);
  if (done.length) return { cur, pace: done.reduce((a, x) => a + monthNet(x), 0) / done.length, n: done.length, basis: 'avg' };
  return { cur, pace: cur, n: 0, basis: 'current' };
}
function monthGoal(m) { return S.monthGoals[m] ?? S.settings.monthlyGoal ?? 0; }
const saveDates = () => [...new Set(S.entries.filter(e => e.kind !== 'withdraw' && !TRANSFER.has(e.category)).map(e => e.date))].sort();
function streaks() {
  const dates = saveDates(), set = new Set(dates); let cur = 0, d = today();
  if (!set.has(d)) d = addDays(d, -1);
  while (set.has(d)) { cur++; d = addDays(d, -1); }
  let best = 0, run = 0, prev = null;
  dates.forEach(x => { run = (prev && addDays(prev, 1) === x) ? run + 1 : 1; best = Math.max(best, run); prev = x; });
  return { cur, best };
}
const startDate = () => [...S.entries.map(e => e.date), ...S.gold.map(g => g.date)].sort()[0] || today();
function monthsRange() {
  const out = []; let m = startDate().slice(0, 7); const end = thisMonth();
  while (m <= end) { out.push(m); const [y, mo] = m.split('-').map(Number); m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; }
  return out;
}
function monthGoalStats() {
  const past = monthsRange().filter(m => m < thisMonth() && monthGoal(m) > 0);
  const hit = past.filter(m => monthNet(m) >= monthGoal(m));
  let run = 0; for (let i = past.length - 1; i >= 0; i--) { if (monthNet(past[i]) >= monthGoal(past[i])) run++; else break; }
  return { total: past.length, hit: hit.length, run };
}

// ================= Arayüz temelleri =================
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }
function openSheet(id) { $('sheetbg').style.display = 'block'; requestAnimationFrame(() => $(id).classList.add('open')); }
function closeSheets() { document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open')); setTimeout(() => { $('sheetbg').style.display = 'none'; }, 220); }
$('sheetbg').onclick = closeSheets;
function confirmDlg(html, yesText = 'Onayla') {
  return new Promise(res => {
    $('dlgText').innerHTML = html; $('dlgYes').textContent = yesText; $('dlg').style.display = 'flex';
    const done = v => { $('dlg').style.display = 'none'; $('dlgYes').onclick = $('dlgNo').onclick = null; res(v); };
    $('dlgYes').onclick = () => done(true); $('dlgNo').onclick = () => done(false);
  });
}
function route() {
  const h = (location.hash || '#ozet').slice(1);
  view = ['ozet', 'altin', 'istatistik', 'gecmis'].includes(h) ? h : 'ozet';
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('act', v.id === 'v-' + view));
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('act', a.dataset.v === view));
  render(); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function confetti() {
  const c = $('confetti'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const cols = ['#34d399', '#f5c542', '#60a5fa', '#a78bfa', '#f87171'];
  const P = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: Math.random() * -14 - 4, s: Math.random() * 6 + 4, c: cols[Math.random() * 5 | 0], r: Math.random() * 6 }));
  let f = 0; (function tick() {
    x.clearRect(0, 0, c.width, c.height);
    P.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .45; p.vx *= .99; p.r += .2; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); x.restore(); });
    if (++f < 150) requestAnimationFrame(tick); else x.clearRect(0, 0, c.width, c.height);
  })();
}

// ================= Çizim =================
function notices() {
  const out = [];
  const lb = S.settings.lastBackup, hasData = S.entries.length + S.gold.length > 0;
  if (hasData && (!lb || daysBetween(lb.slice(0, 10), today()) >= 7))
    out.push(`<div class="notice warn">☁️ ${lb ? `Son yedek ${daysBetween(lb.slice(0, 10), today())} gün önce.` : 'Henüz hiç yedek almadın.'}<button data-act="backup">Yedekle</button></div>`);
  if (!navigator.onLine) out.push('<div class="notice info">📴 Çevrimdışısın. Kayıtların yine cihazına kaydediliyor.</div>');
  $('notices').innerHTML = out.join('');
}

function render() {
  const cash = cashTotal(), gv = goldValue(), total = cash + gv;
  const st = S.settings; const incGold = st.includeGold !== false;
  const base = incGold ? total : cash, goal = st.goalAmount || 0;
  const pct = goal ? Math.min(100, base / goal * 100) : 0;
  const m = thisMonth(), mg = monthGoal(m), mn = monthNet(m), mPct = mg ? Math.min(100, Math.max(0, mn / mg * 100)) : 0;

  // Kutlamalar yalnızca kullanıcının kendi işleminden sonra
  if (armed) {
    if (lastPct !== null && goal && pct > lastPct) {
      const hit = [...MILESTONES].reverse().find(x => lastPct < x && pct >= x);
      if (hit) { confetti(); setTimeout(() => toast(hit === 100 ? '🎉 BÜYÜK HEDEFE ULAŞTIN!' : `🏅 Hedefin %${hit}'ine ulaştın!`), 900); }
    }
    if (lastMonthPct !== null && mg && lastMonthPct < 100 && mPct >= 100) { confetti(); setTimeout(() => toast('🎯 Bu ayın hedefini tutturdun!'), 900); }
    armed = false;
  }
  lastPct = pct; lastMonthPct = mPct;

  $('hTitle').textContent = st.goalName || 'Birikimim';
  $('hSub').textContent = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  notices();

  if (view === 'ozet') {
    $('oTotal').textContent = TL.format(total); $('oCash').textContent = TL.format(cash); $('oGold').textContent = TL.format(gv);
    $('oPct').textContent = goal ? (pct < 10 ? pct.toFixed(1) : Math.floor(pct)) + '%' : '—';
    $('oRing').style.strokeDashoffset = 295.3 * (1 - pct / 100);
    $('oGoalName').textContent = goal ? (st.goalName || 'Hedefim') : 'Büyük hedefini belirle';
    $('oGoalAmt').textContent = goal ? `${TL.format(base)} / ${TL.format(goal)}${incGold ? '' : ' (altın hariç)'}` : 'Sağ üstteki ⚙️ ayarlardan gir';
    $('oRemain').innerHTML = goal ? (base >= goal ? '<span class="pos">Hedef tamamlandı ✓</span>' : `Kalan: <b>${TL.format(goal - base)}</b>`) : '';
    let eta = '';
    if (goal && base < goal) {
      // Referans: içinde bulunulan takvim ayı (1'inden bugüne). Bu ay henüz net birikim yoksa geçen ayın tamamı.
      const r = monthlyPace(), rem = goal - base;
      const cap = s => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
      const lines = [`${cap(monthOnly(m))} birikimi: ${TL.format(r.cur)}`];
      lines.push(r.basis === 'avg'
        ? `Aylık ortalaman: ${TL.format(r.pace)} (${r.n} ay)`
        : 'İlk ay bitince aylık ortalaman hesaplanacak; şimdilik bu ay baz alındı');
      if (r.pace > 0) {
        const k = Math.ceil(rem / r.pace);
        lines.push(`Bu hızla hedefe ${k} ay sonra, ${monthName(addMonths(m, k))} civarı ulaşırsın`);
      } else lines.push('Tahmin için aylık birikimin artıda olmalı');
      if (st.goalDate && st.goalDate > today()) {
        const left = Math.max(1, monthsBetween(m, st.goalDate.slice(0, 7)));
        lines.push(`Hedef tarihe yetişmek için ayda ~${TL.format(rem / left)} gerekli (${left} ay)`);
      }
      eta = lines.join('\n');
    }
    $('oEta').textContent = eta;
    $('oBadges').innerHTML = goal ? MILESTONES.map(x => `<span class="badge ${pct >= x ? 'on' : ''}">${pct >= x ? '🏅' : '○'} %${x}</span>`).join('') : '';

    // Aylık hedef kartı
    $('mTitle').textContent = `${monthName(m)} hedefi`;
    if (mg) {
      const left = daysInMonth(m) - Number(today().slice(8)) + 1, need = Math.max(0, mg - mn);
      const gs = monthGoalStats();
      $('mBody').innerHTML = `<div class="bar ${mPct >= 100 ? 'done' : ''}"><div style="width:${mPct}%"></div></div>
        <div class="mrow"><span><b class="${mn >= 0 ? 'pos' : 'neg'}">${TL.format(mn)}</b> / ${TL.format(mg)}</span><b>${Math.floor(mPct)}%</b></div>
        <div class="small muted" style="margin-top:6px">${mn >= mg ? '🎯 Bu ayın hedefi tamam! Fazlası büyük hedefe katkı.' : `Ay sonuna ${left} gün · günde ${TL.format(need / left)} biriktirmen yeterli`}</div>
        ${gs.total ? `<div class="small muted" style="margin-top:4px">Geçmiş aylar: ${gs.hit}/${gs.total} tutturuldu${gs.run > 1 ? ` · üst üste ${gs.run} ay 🔥` : ''}</div>` : ''}`;
    } else $('mBody').innerHTML = '<div class="small muted" style="margin-top:8px">Aylık bir hedef koy; her ay sıfırdan başlayan kısa bir yarış gibi motive eder.</div>';

    const { cur } = streaks(); $('oStreak').textContent = cur + ' gün';
    const dow = (new Date().getDay() + 6) % 7, wStart = addDays(today(), -dow);
    const fm = v => `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${TL.format(v)}</span>`;
    $('oMonth').innerHTML = fm(mn); $('oWeek').innerHTML = fm(sumRange(wStart, today()));
    $('oRecent').innerHTML = entryList(S.entries.slice(0, 5)) || '<div class="empty">Henüz kayıt yok. Aşağıdaki + ile ilk birikimini ekle!</div>';
    $('quick').innerHTML = [50, 100, 250, 500, 1000].map(v => `<button class="chip" data-q="${v}">+${v} ₺</button>`).join('');
  }
  if (view === 'altin') renderGold();
  if (view === 'istatistik') renderStats();
  if (view === 'gecmis') renderHistory();
  drawPriceAge();
}

function entryList(arr, withDel) {
  return arr.map(e => {
    const c = catInfo(e.category, e.kind), w = e.kind === 'withdraw';
    return `<div class="it tap" data-edit="${e.id}"><div class="ic">${c[1]}</div><div class="t"><b>${esc(e.note || c[2])}</b><span>${c[2]} · ${dShort(e.date)}</span></div>
    <div class="a ${w ? 'neg' : 'pos'}">${w ? '−' : '+'}${TL.format(e.amount)}</div>${withDel ? `<button class="del" data-del="${e.id}" aria-label="Sil">✕</button>` : ''}</div>`;
  }).join('');
}

function priceAge() {
  const up = S.prices?.updated; if (!up) return null;
  return Math.round((Date.now() - new Date(up.replace(' ', 'T') + '+03:00')) / 6e4);
}
function ageLabel() {
  const m = priceAge();
  return m === null ? 'fiyat yok' : m < 2 ? 'şimdi' : m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`;
}
function drawPriceAge() {
  const m = priceAge(), stale = m === null || m > 240;
  document.querySelectorAll('.updLabel').forEach(el => { el.textContent = fetching ? 'güncelleniyor…' : ageLabel(); });
  document.querySelectorAll('.refresh').forEach(el => el.classList.toggle('stale', stale));
  document.querySelectorAll('[data-act="refresh"]').forEach(el => el.classList.toggle('loading', fetching));
}
function renderGold() {
  const gv = goldValue(), cost = goldCost(), gp = priceOf('GRA');
  $('aTotal').textContent = TL.format(gv);
  $('aGram').textContent = gp ? N2.format(gv / gp) : '—';
  const pl = gv - cost;
  $('aPL').innerHTML = cost > 0 ? `<span class="${pl >= 0 ? 'pos' : 'neg'}">${pl >= 0 ? '▲' : '▼'} ${TL.format(Math.abs(pl))} (${(pl / cost * 100).toFixed(1)}%)</span>` : '';
  // Makas: şu an alıp hemen bozdursan kaybedeceğin tutar (bilgi amaçlı)
  const h0 = holdings(); let spread = 0;
  for (const t in h0) { const p = S.prices?.items?.[t]; if (p && h0[t] > 0) spread += h0[t] * (p.sell - p.buy); }
  $('aCost').innerHTML = cost > 0
    ? `Ödediğin: <b>${TL.format(cost)}</b> · Bozdursan alacağın: <b>${TL.format(gv)}</b>${spread > 0 ? `<br>Bugünkü alış-satış farkı (makas): ${TL.format(spread)}. Altın yeni alındıysa görünen zararın büyük kısmı bu farktır; fiyat yükseldikçe kapanır.` : ''}`
    : '';
  const mins = priceAge();
  $('aUpd').textContent = ageLabel();
  $('aUpd').classList.toggle('stale', mins === null || mins > 240);
  $('aPrices').innerHTML = S.prices ? SHOW_PRICES.map(t => {
    const p = S.prices.items[t]; if (!p) return '';
    return `<div class="it"><div class="ic">🪙</div><div class="t"><b>${GOLD[t][0]}</b><span>Alış ${TL2.format(p.buy)} · Satış ${TL2.format(p.sell)}</span></div>
    <div class="a ${p.change >= 0 ? 'pos' : 'neg'}">${p.change >= 0 ? '▲' : '▼'} %${Math.abs(p.change).toFixed(2)}</div></div>`;
  }).join('') : '<div class="empty">Fiyatlar alınamadı. İnternet bağlantını kontrol edip ↻ Yenile\'ye bas.</div>';
  const h = holdings();
  const rows = Object.keys(h).filter(t => Math.abs(h[t]) > 1e-9).map(t => {
    const v = h[t] * priceOf(t);
    return `<div class="it tap" data-gtype="${t}"><div class="ic">🟡</div><div class="t"><b>${GOLD[t][0]}</b><span>${N2.format(h[t])} ${GOLD[t][1]} × ${TL.format(priceOf(t))} · düzenlemek için dokun</span></div><div class="a goldc">${TL.format(v)}</div></div>`;
  }).join('');
  const tx = [...S.gold].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts).map(g => `<div class="it tap" data-gedit="${g.id}"><div class="ic">${g.qty > 0 ? '⬇️' : '⬆️'}</div><div class="t"><b>${g.qty > 0 ? 'Alış' : 'Satış'}: ${N2.format(Math.abs(g.qty))} ${GOLD[g.type][1]} ${GOLD[g.type][0]}</b><span>${dShort(g.date)}${g.unit ? ` · birim ${TL.format(g.unit)}` : ''}</span></div><button class="del" data-gdel="${g.id}" aria-label="Sil">✕</button></div>`).join('');
  $('aHold').innerHTML = rows ? rows + `<div class="small muted" style="margin:14px 0 4px">İşlemler</div>${tx}` : (tx || '<div class="empty">Altınlarını ekle; anlık değerini ve kâr/zararını takip edelim.</div>');
  const days = histDays.filter(d => S.hist[d].GRA);
  const has = days.length >= 2;
  $('cGoldPriceEmpty').style.display = has ? 'none' : 'block';
  $('cGoldPriceW').style.display = has ? '' : 'none';
  if (has) mkChart('cGoldPrice', { type: 'line', data: { labels: days.map(dShort), datasets: [{ data: days.map(d => S.hist[d].GRA), borderColor: '#f5c542', backgroundColor: 'rgba(245,197,66,.12)', fill: true, tension: .3, pointRadius: 0 }] }, options: baseOpts() });
}

const axisY = (stacked) => ({ stacked, grid: { color: '#232833' }, ticks: { color: '#8b93a3', font: { size: 10 }, callback: v => COMPACT.format(v) } });
const axisX = { grid: { display: false }, ticks: { color: '#8b93a3', maxTicksLimit: 6, font: { size: 10 } } };
function baseOpts(extra = {}) {
  return Object.assign({
    responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + TL.format(c.parsed.y ?? c.parsed) } } },
    scales: { x: axisX, y: axisY(false) }
  }, extra);
}
function mkChart(id, cfg) { if (!window.Chart) return; charts[id]?.destroy(); charts[id] = new Chart($(id), cfg); }

function renderStats() {
  const start = startDate(), t = today(), n = Math.max(0, daysBetween(start, t));
  // Varlık zaman çizelgesi
  const step = Math.max(1, Math.ceil(n / 90)), labels = [], cashS = [], goldS = [];
  for (let i = 0; i <= n; i += step) { const d = addDays(start, i); labels.push(dShort(d)); cashS.push(cashTotal(d)); goldS.push(goldValue(d)); }
  if (labels[labels.length - 1] !== dShort(t)) { labels.push(dShort(t)); cashS.push(cashTotal()); goldS.push(goldValue()); }
  mkChart('cNet', { type: 'line', data: { labels, datasets: [
    { label: 'Altın', data: goldS, borderColor: '#f5c542', backgroundColor: 'rgba(245,197,66,.25)', fill: 'origin', tension: .3, pointRadius: 0 },
    { label: 'Nakit', data: cashS, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,.25)', fill: '-1', tension: .3, pointRadius: 0 }] },
    options: baseOpts({ plugins: { legend: { display: true, labels: { color: '#8b93a3', boxWidth: 10 } }, tooltip: { mode: 'index', intersect: false, callbacks: { label: c => ` ${c.dataset.label}: ${TL.format(c.parsed.y)}` } } }, scales: { x: axisX, y: axisY(true) } }) });
  // Aylık net + hedef çizgisi
  const months = monthsRange().slice(-12), nets = months.map(monthNet), goals = months.map(monthGoal);
  const anyGoal = goals.some(g => g > 0);
  mkChart('cMonth', { data: { labels: months.map(monthShort), datasets: [
    { type: 'bar', label: 'Net birikim', data: nets, backgroundColor: nets.map((v, i) => v < 0 ? '#f87171' : goals[i] && v >= goals[i] ? '#f5c542' : '#34d399'), borderRadius: 6, order: 2 },
    ...(anyGoal ? [{ type: 'line', label: 'Hedef', data: goals.map(g => g || null), borderColor: '#eef0f4', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, stepped: 'middle', order: 1 }] : [])] },
    options: baseOpts({ plugins: { legend: { display: anyGoal, labels: { color: '#8b93a3', boxWidth: 10 } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${TL.format(c.parsed.y)}` } } } }) });
  // Kategoriler
  const saves = S.entries.filter(e => e.kind !== 'withdraw' && !TRANSFER.has(e.category));
  const cat = {}; saves.forEach(e => { cat[e.category] = (cat[e.category] || 0) + e.amount; });
  const ck = Object.keys(cat).sort((a, b) => cat[b] - cat[a]);
  mkChart('cCat', { type: 'doughnut', data: { labels: ck.map(k => catInfo(k)[1] + ' ' + catInfo(k)[2]), datasets: [{ data: ck.map(k => cat[k]), backgroundColor: ['#34d399', '#f5c542', '#60a5fa', '#a78bfa', '#f87171', '#fb923c', '#2dd4bf', '#e879f9'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { color: '#c5cad4', boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: c => ' ' + TL.format(c.parsed) } } } } });
  // Haftanın günleri
  const dowN = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'], dw = Array(7).fill(0);
  saves.forEach(e => { dw[(new Date(e.date + 'T12:00:00').getDay() + 6) % 7] += e.amount; });
  mkChart('cDow', { type: 'bar', data: { labels: dowN, datasets: [{ data: dw, backgroundColor: '#60a5fa', borderRadius: 6 }] }, options: baseOpts() });
  // Göstergeler
  const { cur, best } = streaks(), amounts = saves.map(e => e.amount);
  const totalSaved = amounts.reduce((a, b) => a + b, 0);
  const withdrawn = S.entries.filter(e => e.kind === 'withdraw' && !TRANSFER.has(e.category)).reduce((a, e) => a + e.amount, 0);
  const allM = monthsRange(), bestM = [...allM].sort((a, b) => monthNet(b) - monthNet(a))[0];
  const prevM = allM[allM.length - 2], ch = prevM && monthNet(prevM) ? (monthNet(thisMonth()) - monthNet(prevM)) / Math.abs(monthNet(prevM)) * 100 : null;
  const gv = goldValue(), tot = cashTotal() + gv, cost = goldCost(), gs = monthGoalStats();
  const bestDow = totalSaved ? dowN[dw.indexOf(Math.max(...dw))] : '—';
  const K = [
    ['Toplam biriktirilen', TL.format(totalSaved), 'pos'], ['Toplam çekilen', TL.format(withdrawn), 'neg'],
    ['Kayıt sayısı', saves.length + ' kayıt'], ['Ortalama kayıt', amounts.length ? TL.format(totalSaved / amounts.length) : '—'],
    ['En büyük tek kayıt', amounts.length ? TL.format(Math.max(...amounts)) : '—'], ['Günlük ortalama', TL.format((totalSaved - withdrawn) / (n + 1))],
    ['Mevcut seri', cur + ' gün'], ['En uzun seri', best + ' gün'],
    ['Aylık hedef başarısı', gs.total ? `${gs.hit}/${gs.total} ay` : '—', gs.total && gs.hit === gs.total ? 'pos' : ''], ['Üst üste tutturulan', gs.run + ' ay'],
    ['Aktif gün', saveDates().length + ' / ' + (n + 1)], ['Bu ay vs geçen ay', ch === null ? '—' : (ch >= 0 ? '▲ ' : '▼ ') + Math.abs(ch).toFixed(0) + '%', ch === null ? '' : ch >= 0 ? 'pos' : 'neg'],
    ['En iyi ay', bestM && monthNet(bestM) > 0 ? monthName(bestM) : '—'], ['En verimli gün', bestDow],
    ['Altın payı', tot ? (gv / tot * 100).toFixed(0) + '%' : '—', 'goldc'], ['Altın kâr/zarar', cost > 0 ? TL.format(gv - cost) : '—', gv - cost >= 0 ? 'pos' : 'neg'],
  ];
  $('kpis').innerHTML = K.map(k => `<div class="stat"><div class="l">${k[0]}</div><div class="v ${k[2] || ''}">${k[1]}</div></div>`).join('');
  // Isı haritası
  const byDay = {}; saves.forEach(e => { byDay[e.date] = (byDay[e.date] || 0) + e.amount; });
  const max = Math.max(1, ...Object.values(byDay)), weeks = 15;
  const end = addDays(t, 6 - ((new Date().getDay() + 6) % 7)), first = addDays(end, -(weeks * 7 - 1));
  let html = `<div style="display:grid;grid-template-columns:repeat(${weeks},1fr);grid-auto-flow:column;grid-template-rows:repeat(7,1fr);gap:3px">`;
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(first, i), v = byDay[d] || 0;
    html += `<div title="${dLong(d)}: ${TL.format(v)}" style="aspect-ratio:1;border-radius:3px;background:${d > t ? 'transparent' : v ? `rgba(52,211,153,${0.25 + 0.75 * (v / max)})` : '#232833'}"></div>`;
  }
  $('heat').innerHTML = html + '</div><div class="small muted" style="margin-top:8px">Her kare bir gün; koyu yeşil = o gün daha çok biriktirdin.</div>';
}

let gFilter = 'all';
function renderHistory() {
  const used = [...new Set(S.entries.map(e => e.category))];
  $('gFilter').innerHTML = [['all', '📋', 'Tümü'], ['save', '➕', 'Birikim'], ['withdraw', '➖', 'Çekim'], ...used.map(k => catInfo(k))]
    .filter((c, i, a) => a.findIndex(x => x[0] === c[0]) === i)
    .map(c => `<button class="chip ${gFilter === c[0] ? 'sel' : ''}" data-f="${c[0]}">${c[1]} ${c[2]}</button>`).join('');
  const arr = S.entries.filter(e => gFilter === 'all' || (gFilter === 'save' && e.kind !== 'withdraw') || (gFilter === 'withdraw' && e.kind === 'withdraw') || e.category === gFilter);
  $('gList').innerHTML = entryList(arr, true) || '<div class="empty">Kayıt yok.</div>';
}

// ================= Veri işlemleri =================
function commit(msg) { armed = true; sortEntries(); refreshHistDays(); render(); save(); if (msg) toast(msg); }
function addEntry(e, msg) {
  S.entries.push({ id: uid(), ts: Date.now(), ...e });
  commit(msg ?? (e.kind === 'withdraw' ? `−${TL.format(e.amount)} kaydedildi` : `+${TL.format(e.amount)} biriktirdin 💪`));
}

document.addEventListener('click', async ev => {
  const q = ev.target.closest('[data-q]'); if (q) { addEntry({ kind: 'save', amount: +q.dataset.q, category: 'diger', note: '', date: today() }); return; }
  const f = ev.target.closest('[data-f]'); if (f) { gFilter = f.dataset.f; renderHistory(); return; }
  const a = ev.target.closest('[data-act="backup"]'); if (a) { backup(); return; }
  const rf = ev.target.closest('[data-act="refresh"]'); if (rf) { fetchPrices(true); return; }
  const d = ev.target.closest('[data-del],[data-gdel]');
  if (d) {
    if (!d.dataset.confirm) {
      d.dataset.confirm = 1; d.textContent = 'Sil?'; d.style.color = 'var(--red)';
      setTimeout(() => { if (d.isConnected) { delete d.dataset.confirm; d.textContent = '✕'; d.style.color = ''; } }, 3000);
      return;
    }
    if (d.dataset.del) deleteEntry(d.dataset.del); else deleteGold(d.dataset.gdel);
    return;
  }
  const ed = ev.target.closest('[data-edit]'); if (ed) { openEntryEdit(ed.dataset.edit); return; }
  const ge = ev.target.closest('[data-gedit]'); if (ge) { openGoldEdit(ge.dataset.gedit); return; }
  const gt = ev.target.closest('[data-gtype]');
  if (gt) {
    // Bu türde tek işlem varsa doğrudan düzenle; birden fazlaysa işlemleri göster ve vurgula
    const txs = S.gold.filter(g => g.type === gt.dataset.gtype);
    if (txs.length === 1) { openGoldEdit(txs[0].id); return; }
    const els = txs.map(g => document.querySelector(`[data-gedit="${g.id}"]`)).filter(Boolean);
    els[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    els.forEach(el => { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); });
    toast(`${GOLD[gt.dataset.gtype][0]}: ${txs.length} işlem var, düzenlemek istediğine dokun`);
  }
});

// ---- Altın işlemi <-> bağlı nakit kaydı ----
// Eski kayıtlarda bağlantı alanı yok: aynı gün, aynı tutarlı aktarım kaydını bağlı say.
function findLinked(g) {
  if (g.link) return S.entries.find(e => e.id === g.link) || null;
  const cat = g.qty > 0 ? 'altin' : 'altinsatis', amt = Math.round(Math.abs(g.qty) * g.unit);
  return S.entries.find(e => e.category === cat && e.date === g.date && !e.link && Math.abs(e.amount - amt) <= 1) || null;
}
function deleteEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  S.entries = S.entries.filter(x => x.id !== id);
  S.gold.forEach(g => { if (g.link === id) delete g.link; });
  commit('Kayıt silindi');
}
function deleteGold(id) {
  const g = S.gold.find(x => x.id === id); if (!g) return;
  const L = findLinked(g);
  S.gold = S.gold.filter(x => x.id !== id);
  if (L) S.entries = S.entries.filter(x => x.id !== L.id);
  commit(L ? 'İşlem ve bağlı TL kaydı silindi' : 'İşlem silindi');
}

// ---- Kayıt ekleme / düzenleme ----
let eKind = 'save', eCat = 'yemek', editEntryId = null;
function drawCats() {
  // Bağlantısı kopmuş eski bir altın aktarım kaydı düzenlenirken kendi kategorisi listede kalsın
  const L = [...(eKind === 'withdraw' ? WCATS : CATS), ...XCATS.filter(c => c[0] === eCat)];
  if (!L.find(c => c[0] === eCat)) eCat = L[0][0];
  $('eCat').innerHTML = L.map(c => `<button class="chip ${c[0] === eCat ? 'sel' : ''}" data-c="${c[0]}">${c[1]} ${c[2]}</button>`).join('');
}
const setSeg = (segId, key) => [...$(segId).children].forEach(x => x.classList.toggle('sel', x.dataset.k === key));
$('eCat').onclick = ev => { const b = ev.target.closest('[data-c]'); if (b) { eCat = b.dataset.c; drawCats(); } };
$('eKind').onclick = ev => { const b = ev.target.closest('button'); if (!b) return; eKind = b.dataset.k; setSeg('eKind', eKind); drawCats(); };
function openEntrySheet(e) {
  editEntryId = e ? e.id : null;
  eKind = e ? e.kind : 'save'; eCat = e ? e.category : 'yemek'; setSeg('eKind', eKind);
  $('eTitle').textContent = e ? 'Kaydı düzenle' : 'Yeni kayıt';
  $('eSave').textContent = e ? 'Güncelle' : 'Kaydet';
  $('eDelete').style.display = e ? '' : 'none'; delete $('eDelete').dataset.confirm; $('eDelete').textContent = 'Bu kaydı sil';
  $('eAmt').value = e ? String(e.amount).replace('.', ',') : ''; $('eNote').value = e ? e.note : '';
  $('eDate').value = e ? e.date : today(); $('eDate').max = today();
  drawCats(); openSheet('sEntry'); if (!e) setTimeout(() => $('eAmt').focus(), 260);
}
function openEntryEdit(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  if (TRANSFER.has(e.category)) {
    const g = S.gold.find(x => x.link === id) || S.gold.find(x => findLinked(x)?.id === id);
    if (g) { openGoldEdit(g.id); toast('Bu kayıt bir altın işlemine bağlı; oradan düzenleniyor'); return; }
  }
  openEntrySheet(e);
}
$('fab').onclick = () => openEntrySheet(null);
$('eSave').onclick = () => {
  const amt = parseNum($('eAmt').value); if (!(amt > 0)) { toast('Geçerli bir tutar gir'); return; }
  const data = { kind: eKind, amount: amt, category: eCat, note: $('eNote').value.trim().slice(0, 120), date: $('eDate').value || today() };
  if (editEntryId) {
    const e = S.entries.find(x => x.id === editEntryId);
    if (e) { Object.assign(e, data); commit('Kayıt güncellendi ✓'); }
  } else addEntry(data);
  closeSheets();
};
$('eDelete').onclick = () => {
  const b = $('eDelete');
  if (!b.dataset.confirm) { b.dataset.confirm = 1; b.textContent = 'Emin misin? Tekrar bas'; return; }
  deleteEntry(editEntryId); closeSheets();
};

// ---- Altın işlemi ekleme / düzenleme ----
let gKind = 'buy', editGoldId = null;
$('gType').innerHTML = Object.entries(GOLD).map(([k, v]) => `<option value="${k}">${v[0]} (${v[1]})</option>`).join('');
const gLabels = () => { $('gQtyL').textContent = `Miktar (${GOLD[$('gType').value][1]})`; $('gLinkL').textContent = gKind === 'buy' ? 'Bu tutarı TL birikimimden düş' : 'Satıştan geleni TL birikimime ekle'; };
$('gType').onchange = gLabels;
$('gKind').onclick = ev => { const b = ev.target.closest('button'); if (!b) return; gKind = b.dataset.k; setSeg('gKind', gKind); gLabels(); };
function openGoldSheet(g) {
  editGoldId = g ? g.id : null;
  gKind = g && g.qty < 0 ? 'sell' : 'buy'; setSeg('gKind', gKind);
  $('gTitle').textContent = g ? 'Altın işlemini düzenle' : 'Altın işlemi';
  $('gSave').textContent = g ? 'Güncelle' : 'Kaydet';
  $('gDelete').style.display = g ? '' : 'none'; delete $('gDelete').dataset.confirm; $('gDelete').textContent = 'Bu işlemi sil';
  $('gType').value = g ? g.type : 'GRA';
  $('gQty').value = g ? String(Math.abs(g.qty)).replace('.', ',') : '';
  $('gPrice').value = g && g.unit ? String(g.unit).replace('.', ',') : '';
  $('gDate').value = g ? g.date : today(); $('gDate').max = today();
  $('gLink').checked = g ? !!findLinked(g) : false;
  gLabels(); openSheet('sGold');
}
function openGoldEdit(id) { const g = S.gold.find(x => x.id === id); if (g) openGoldSheet(g); }
$('btnAddGold').onclick = () => openGoldSheet(null);
$('gSave').onclick = () => {
  const qty = parseNum($('gQty').value); if (!(qty > 0)) { toast('Geçerli bir miktar gir'); return; }
  const t = $('gType').value, date = $('gDate').value || today();
  let unit = parseNum($('gPrice').value);
  if (!(unit > 0)) unit = (gKind === 'buy' ? S.prices?.items?.[t]?.sell : S.prices?.items?.[t]?.buy) || 0;
  const old = editGoldId ? S.gold.find(x => x.id === editGoldId) : null;
  // Satışta: bu işlem hariç eldeki miktar yeterli mi?
  const have = (holdings()[t] || 0) - (old && old.type === t ? old.qty : 0);
  if (gKind === 'sell' && qty > have + 1e-9) { toast(`Elinde yalnızca ${N2.format(Math.max(0, have))} ${GOLD[t][1]} var`); return; }
  const linked = old ? findLinked(old) : null;
  const g = old || { id: uid(), ts: Date.now() };
  Object.assign(g, { type: t, qty: gKind === 'buy' ? qty : -qty, unit, date });
  if (!old) S.gold.push(g);
  // Bağlı nakit kaydı: oluştur, güncelle ya da kaldır
  const want = $('gLink').checked && unit > 0;
  const entryData = { kind: gKind === 'buy' ? 'withdraw' : 'save', amount: Math.round(qty * unit), category: gKind === 'buy' ? 'altin' : 'altinsatis', note: `${GOLD[t][0]} ${gKind === 'buy' ? 'alımı' : 'satışı'} (${N2.format(qty)} ${GOLD[t][1]})`, date, link: g.id };
  if (want && linked) { Object.assign(linked, entryData); g.link = linked.id; }
  else if (want) { const e = { id: uid(), ts: Date.now(), ...entryData }; S.entries.push(e); g.link = e.id; }
  else { if (linked) S.entries = S.entries.filter(x => x.id !== linked.id); delete g.link; }
  commit(old ? 'Altın işlemi güncellendi ✓' : 'Altın işlemi kaydedildi 🪙'); closeSheets();
};
$('gDelete').onclick = () => {
  const b = $('gDelete');
  if (!b.dataset.confirm) { b.dataset.confirm = 1; b.textContent = 'Emin misin? Tekrar bas'; return; }
  deleteGold(editGoldId); closeSheets();
};

// Aylık hedef
$('btnMonthGoal').onclick = () => {
  $('mDefault').value = S.settings.monthlyGoal || ''; $('mThis').value = S.monthGoals[thisMonth()] ?? '';
  $('mThisL').textContent = `Sadece ${monthName(thisMonth())} için farklı hedef (isteğe bağlı)`; openSheet('sMonth');
};
$('mSave').onclick = () => {
  const def = parseNum($('mDefault').value), th = parseNum($('mThis').value);
  // Varsayılan değişince geçmiş aylar eski hedeflerini korusun (hiç hedef yokken geçen aylar hedefsiz kalır)
  const prevDef = S.settings.monthlyGoal || 0;
  if (prevDef > 0) monthsRange().filter(m => m < thisMonth() && !(m in S.monthGoals)).forEach(m => { S.monthGoals[m] = prevDef; });
  S.settings.monthlyGoal = def > 0 ? def : 0;
  if (th > 0) S.monthGoals[thisMonth()] = th; else delete S.monthGoals[thisMonth()];
  lastMonthPct = null; commit('Aylık hedef kaydedildi 🎯'); closeSheets();
};

// Ayarlar
function backupInfo() {
  const lb = S.settings.lastBackup;
  $('sBackupInfo').textContent = lb ? `Son yedek: ${new Date(lb).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Henüz yedek alınmadı.';
}
$('btnSettings').onclick = () => {
  const s = S.settings; $('sName').value = s.goalName || ''; $('sAmt').value = s.goalAmount || ''; $('sDate').value = s.goalDate || ''; $('sIncGold').checked = s.includeGold !== false;
  backupInfo(); openSheet('sSet');
};
$('sSave').onclick = () => {
  const a = parseNum($('sAmt').value);
  Object.assign(S.settings, { goalName: $('sName').value.trim().slice(0, 60), goalAmount: a > 0 ? a : 0, goalDate: $('sDate').value || '', includeGold: $('sIncGold').checked });
  lastPct = null; commit('Hedef kaydedildi 🎯'); closeSheets();
};

// ================= Yedekleme =================
async function backup() {
  const data = { app: 'birikimim', version: 1, exportedAt: new Date().toISOString(), entries: S.entries, gold: S.gold, settings: S.settings, monthGoals: S.monthGoals, hist: S.hist };
  const name = `birikimim-yedek-${today()}.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
  let ok = false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Birikimim yedeği' }); ok = true; }
  } catch (e) { if (e.name === 'AbortError') return; }
  if (!ok) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); ok = true; }
  S.settings.lastBackup = new Date().toISOString(); save(); backupInfo(); notices();
  toast('Yedek hazır ☁️');
}
$('sBackup').onclick = backup;
$('sRestore').onclick = () => $('sRestoreFile').click();
$('sRestoreFile').onchange = async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  let d; try { d = JSON.parse(await f.text()); } catch { toast('Dosya okunamadı'); return; }
  if (d?.app !== 'birikimim' || !Array.isArray(d.entries)) { toast('Bu bir Birikimim yedeği değil'); return; }
  const ok = await confirmDlg(`<p><b>Yedek geri yüklensin mi?</b></p><p class="small muted">Yedekte ${d.entries.length} kayıt ve ${(d.gold || []).length} altın işlemi var. Bu cihazdaki mevcut verilerin (${S.entries.length} kayıt) bunlarla <b>değiştirilecek</b>.</p>`, 'Geri yükle');
  if (!ok) return;
  const keepPrices = S.prices;
  S = normalize({ ...d, prices: keepPrices, hist: Object.assign({}, d.hist || {}, S.hist) });
  lastPct = lastMonthPct = null; refreshHistDays(); render(); await save(); closeSheets(); toast('Yedek geri yüklendi ✓');
};
$('sWipe').onclick = async () => {
  if (!await confirmDlg('<p><b>Tüm veriler silinsin mi?</b></p><p class="small muted">Bu cihazdaki bütün kayıtların, altınların ve hedeflerin silinir. Yedeğin yoksa <b>geri alınamaz</b>.</p>', 'Hepsini sil')) return;
  S = EMPTY(); refreshHistDays(); render(); await save(); closeSheets(); toast('Veriler silindi');
};

// ================= Altın fiyatları =================
let fetching = false;
async function fetchPrices(manual) {
  if (fetching) return; fetching = true; drawPriceAge();
  try {
    const r = await fetch(PRICE_API, { cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json(), items = {};
    for (const t of Object.keys(GOLD)) { const v = d[t]; if (v && v.Buying > 0) items[t] = { buy: +v.Buying, sell: +(v.Selling || v.Buying), change: +v.Change || 0 }; }
    if (!items.GRA) throw new Error('boş');
    const updated = String(d.Update_Date || '');
    S.prices = { updated, items };
    const day = updated.slice(0, 10) || today();
    S.hist[day] = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.buy]));
    refreshHistDays(); save(); render();
    if (manual) toast('Fiyatlar güncellendi');
  } catch (e) {
    if (manual) toast('Fiyatlar alınamadı, internetini kontrol et');
  } finally { fetching = false; drawPriceAge(); }
}
setInterval(drawPriceAge, 60 * 1000); // "x dk önce" yazısı kendiliğinden ilerlesin
document.addEventListener('visibilitychange', () => { if (!document.hidden) { const a = priceAge(); if (a === null || a > 10) fetchPrices(); render(); } });
setInterval(() => { if (!document.hidden) fetchPrices(); }, 15 * 60 * 1000);
window.addEventListener('online', () => { fetchPrices(); notices(); });
window.addEventListener('offline', notices);

// ================= Başlangıç =================
async function init() {
  try {
    await IDB.open();
    S = normalize(await IDB.get('state'));
  } catch (e) {
    console.error(e);
    $('notices').innerHTML = '<div class="notice warn">⚠️ Cihaz deposu açılamadı. Gizli sekmede olabilirsin; kayıtların saklanamaz.</div>';
  }
  refreshHistDays();
  // Tarayıcıdan, yer açmak için verileri silmemesini iste
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { }
  route();
  fetchPrices();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Yeni sürüm devreye girince, açık pencere yoksa sayfayı bir kez yenile
    const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      const tryReload = () => {
        if (document.querySelector('.sheet.open') || $('dlg').style.display === 'flex') { setTimeout(tryReload, 3000); return; }
        reloaded = true; location.reload();
      };
      tryReload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => { });
  }
}
init();
})();
