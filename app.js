/* 家計簿 Webアプリ — データはこの端末の中（IndexedDB）にだけ保存されます */
(() => {
'use strict';

const APP_VERSION = '1.0.0';

// ===================== 小道具 =====================
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
const num = (n) => Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const yen = (n) => (n < 0 ? '−' : '') + '¥' + num(n);
const syen = (n) => (n >= 0 ? '+' : '−') + '¥' + num(n);
const short = (n, signed = false) => {
  const a = Math.abs(n);
  const sign = signed ? (n >= 0 ? '+' : '−') : (n < 0 ? '−' : '');
  if (a >= 1000000) return sign + Math.round(a / 10000) + '万';
  if (a >= 10000) return sign + (a / 10000).toFixed(1) + '万';
  return sign + num(a);
};
const pct = (r) => (isFinite(r) ? (r * 100).toFixed(1) + '%' : '—');
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
const INCOME = '#5FBF86', EXPENSE = '#E5645A', GOLD = '#C9A96E';
const kindLabel = (k) => (k === 'income' ? '収入' : '支出');
const kindColor = (k) => (k === 'income' ? INCOME : EXPENSE);

// ----- 日付（端末の時刻で扱う） -----
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toLocal = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parse = (s) => {
  if (!s) return new Date(NaN);
  const [a, b = '00:00'] = String(s).split('T');
  const [y, m, d] = a.split('-').map(Number);
  const [h, mi] = b.split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0);
};
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const dim = (y, m) => new Date(y, m, 0).getDate(); // m は 1〜12
const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const fullDate = (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
const slash = (d) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ----- 年月 -----
const YM = {
  now() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; },
  of(d) { return { y: d.getFullYear(), m: d.getMonth() + 1 }; },
  idx(a) { return a.y * 12 + a.m - 1; },
  add(a, n) { const i = YM.idx(a) + n; return { y: Math.floor(i / 12), m: (i % 12) + 1 }; },
  cmp(a, b) { return YM.idx(a) - YM.idx(b); },
  eq(a, b) { return a.y === b.y && a.m === b.m; },
  start(a) { return new Date(a.y, a.m - 1, 1); },
  end(a) { return new Date(a.y, a.m, 1); },
  days(a) { return dim(a.y, a.m); },
  label(a) { return `${a.y}年${a.m}月`; },
  elapsed(a) {
    const c = YM.cmp(a, YM.now());
    if (c < 0) return YM.days(a);
    if (c > 0) return 0;
    return new Date().getDate();
  }
};

// ===================== 保存（IndexedDB） =====================
const DB_NAME = 'kakeibo', STORE = 'kv', KEY = 'state';
let dbPromise = null;
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbPromise;
}
async function loadState() {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  } catch (e) {
    try { const s = localStorage.getItem('kakeibo-state'); return s ? JSON.parse(s) : null; } catch (_) { return null; }
  }
}
async function writeState() {
  const data = JSON.parse(JSON.stringify(S));
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, KEY);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    try { localStorage.setItem('kakeibo-state', JSON.stringify(data)); } catch (_) { toast('保存に失敗しました'); }
  }
}
let saveTimer = null;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(writeState, 120); }

// ===================== 初期データ =====================
const SEED = {
  expense: [
    ['食費', ['食料品', '外食', 'カフェ', 'お菓子', 'お酒', 'デリバリー']],
    ['日用品', ['日用雑貨', 'ドラッグストア', 'ペット用品', '子ども用品']],
    ['住まい', ['家賃', '住宅ローン', '家具・家電', '修繕・リフォーム']],
    ['光熱・通信', ['電気', 'ガス', '水道', '携帯電話', 'インターネット']],
    ['交通', ['電車・バス', 'タクシー', 'ガソリン', '駐車場', '高速料金']],
    ['趣味・娯楽', ['書籍', '映画・音楽', 'ゲーム', '旅行', 'サブスク', 'スポーツ']],
    ['衣服・美容', ['衣服', '靴・バッグ', '美容院', '化粧品']],
    ['健康・医療', ['病院', '薬', 'ジム', 'サプリ']],
    ['交際', ['飲み会', 'プレゼント', '冠婚葬祭']],
    ['教育', ['習い事', '学費', '資格・勉強']],
    ['税・保険', ['税金', '年金', '生命保険', '損害保険']],
    ['その他', ['手数料', '寄付', '雑費']]
  ],
  income: [
    ['給与', ['給与', '賞与', '残業代', '手当']],
    ['事業', ['副業', '売上', '報酬']],
    ['資産', ['配当', '利息', '売却益', '家賃収入']],
    ['その他', ['臨時収入', '還付', 'お小遣い', 'お祝い', 'ポイント', '雑収入']]
  ],
  fav: {
    expense: ['食料品', '外食', 'カフェ', '日用雑貨', '電車・バス', '衣服', '病院'],
    income: ['給与', '賞与', '副業', '配当', '臨時収入', '還付', 'お小遣い']
  }
};

function freshState() {
  const st = { version: 1, genres: [], categories: [], entries: [], rules: [] };
  let order = 0;
  for (const kind of ['expense', 'income']) {
    SEED[kind].forEach(([gname, cats], gi) => {
      const g = { id: uid(), name: gname, kind, color: PALETTE[gi % PALETTE.length], order: order++ };
      st.genres.push(g);
      cats.forEach((c, ci) => {
        const fi = SEED.fav[kind].indexOf(c);
        st.categories.push({ id: uid(), name: c, genreId: g.id, order: ci, fav: fi >= 0, favOrder: fi >= 0 ? fi : 0 });
      });
    });
  }
  return st;
}

function validState(x) {
  return x && Array.isArray(x.genres) && Array.isArray(x.categories) && Array.isArray(x.entries) && Array.isArray(x.rules);
}

let S = null; // 保存データ

// ===================== カテゴリ =====================
const genresOf = (kind) => S.genres.filter((g) => g.kind === kind).sort((a, b) => a.order - b.order);
const genreById = (id) => S.genres.find((g) => g.id === id);
const catsOfGenre = (gid) => S.categories.filter((c) => c.genreId === gid).sort((a, b) => a.order - b.order);
const catById = (id) => S.categories.find((c) => c.id === id);
const allCats = (kind) => genresOf(kind).flatMap((g) => catsOfGenre(g.id));
const favCats = (kind) => allCats(kind).filter((c) => c.fav).sort((a, b) => a.favOrder - b.favOrder);
const catInfo = (c) => { const g = genreById(c.genreId); return { cat: c.name, genre: g ? g.name : '', color: g ? g.color : '#8C877F' }; };
const findCatByName = (kind, name) => allCats(kind).find((c) => c.name === name);
function nextFavOrder() { return Math.max(-1, ...S.categories.filter((c) => c.fav).map((c) => c.favOrder)) + 1; }
function toggleFav(c) {
  if (c.fav) c.fav = false;
  else { c.favOrder = nextFavOrder(); c.fav = true; }
}
function deleteGenre(g) {
  const ids = new Set(catsOfGenre(g.id).map((c) => c.id));
  S.categories = S.categories.filter((c) => !ids.has(c.id));
  S.genres = S.genres.filter((x) => x.id !== g.id);
}

// ===================== 繰り返し =====================
function defaultRep(dateStr) {
  const d = parse(dateStr);
  const end = new Date(d.getFullYear(), d.getMonth() + 6, d.getDate());
  return { on: false, interval: 1, unit: 'month', weekdays: [d.getDay() + 1], monthDay: d.getDate(), monthEnd: false, end: 'none', endCount: 12, endDate: ymd(end) };
}
function everyText(r) {
  const n = r.interval;
  if (n === 1) return { day: '毎日', week: '毎週', month: '毎月', year: '毎年' }[r.unit];
  return n + { day: '日ごと', week: '週間ごと', month: 'か月ごと', year: '年ごと' }[r.unit];
}
function repSummary(r, startStr) {
  const st = parse(startStr);
  const parts = [everyText(r)];
  if (r.unit === 'week') {
    const days = (r.weekdays && r.weekdays.length ? r.weekdays : [st.getDay() + 1]).slice().sort((a, b) => a - b);
    parts.push(days.map((w) => WD[w - 1]).join('・') + '曜日');
  } else if (r.unit === 'month') parts.push(r.monthEnd ? '月末' : r.monthDay + '日');
  else if (r.unit === 'year') parts.push(`${st.getMonth() + 1}月${st.getDate()}日`);
  let s = parts.join(' ');
  if (r.end === 'count') s += `・${r.endCount}回まで`;
  if (r.end === 'date' && r.endDate) s += `・${slash(parse(r.endDate))}まで`;
  return s;
}
function repFields(r) {
  return { interval: r.interval, unit: r.unit, weekdays: r.weekdays.slice(), monthDay: r.monthDay, monthEnd: r.monthEnd, end: r.end, endCount: r.endCount, endDate: r.endDate };
}

/** ルールの発生日時（開始日〜limit） */
function occurrences(rule, limit) {
  const st = parse(rule.start);
  const start = sod(st);
  const at = (y, m, d) => new Date(y, m, d, st.getHours(), st.getMinutes());
  let hardEnd = sod(limit);
  if (rule.end === 'date' && rule.endDate) { const e = sod(parse(rule.endDate)); if (e < hardEnd) hardEnd = e; }
  const maxCount = rule.end === 'count' ? Math.max(1, rule.endCount | 0) : Infinity;
  const n = Math.max(1, rule.interval | 0);
  const out = [];
  const SAFE = 20000;
  const push = (day) => {
    if (day > hardEnd) return false;
    if (day >= start) {
      out.push(at(day.getFullYear(), day.getMonth(), day.getDate()));
      if (out.length >= maxCount) return false;
    }
    return true;
  };
  const sy = start.getFullYear(), sm = start.getMonth(), sd = start.getDate();
  if (rule.unit === 'day') {
    for (let k = 0; k < SAFE; k++) if (!push(new Date(sy, sm, sd + k * n))) break;
  } else if (rule.unit === 'week') {
    const days = (rule.weekdays && rule.weekdays.length ? rule.weekdays : [start.getDay() + 1]).slice().sort((a, b) => a - b);
    const ws0 = new Date(sy, sm, sd - start.getDay());
    outer: for (let k = 0; k < SAFE; k++) {
      const ws = new Date(ws0.getFullYear(), ws0.getMonth(), ws0.getDate() + 7 * n * k);
      if (ws > hardEnd) break;
      for (const w of days) if (!push(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + w - 1))) break outer;
    }
  } else if (rule.unit === 'month') {
    for (let k = 0; k < SAFE; k++) {
      const m = new Date(sy, sm + k * n, 1);
      if (m > hardEnd) break;
      const last = dim(m.getFullYear(), m.getMonth() + 1);
      const day = rule.monthEnd ? last : Math.min(rule.monthDay, last);
      if (!push(new Date(m.getFullYear(), m.getMonth(), day))) break;
    }
  } else {
    for (let k = 0; k < SAFE; k++) {
      const m = new Date(sy + k * n, sm, 1);
      if (m > hardEnd) break;
      if (!push(new Date(m.getFullYear(), m.getMonth(), Math.min(sd, dim(m.getFullYear(), m.getMonth() + 1))))) break;
    }
  }
  return out;
}

/** 有効なルールから、今日までの分の記録を自動作成 */
function generateRecurring() {
  const now = new Date();
  let added = 0;
  for (const r of S.rules) {
    if (!r.active) continue;
    const last = r.lastGen ? parse(r.lastGen) : null;
    for (const d of occurrences(r, now)) {
      if (last && d <= last) continue;
      S.entries.push({ id: uid(), date: toLocal(d), amount: r.amount, kind: r.kind, cat: r.cat, genre: r.genre, color: r.color, memo: r.memo, ruleId: r.id, createdAt: toLocal(new Date()) });
      r.lastGen = toLocal(d);
      r.genCount = (r.genCount || 0) + 1;
      added++;
    }
  }
  if (added) persist();
  return added;
}
function nextOccurrence(r) {
  const now = new Date();
  const far = new Date(now.getFullYear() + 3, now.getMonth(), now.getDate());
  const last = r.lastGen ? parse(r.lastGen) : null;
  return occurrences(r, far).find((d) => d > now && (!last || d > last)) || null;
}
function monthlyEstimate(r) {
  const n = Math.max(1, r.interval), a = r.amount;
  switch (r.unit) {
    case 'day': return Math.round(a * 365 / 12 / n);
    case 'week': return Math.round(a * Math.max(1, (r.weekdays || []).length) * 52 / 12 / n);
    case 'month': return Math.round(a / n);
    default: return Math.round(a / 12 / n);
  }
}

// ===================== 集計 =====================
const dateCache = new Map();
const dt = (e) => { let d = dateCache.get(e.date); if (!d) { d = parse(e.date); dateCache.set(e.date, d); } return d; };
const inYM = (list, ym) => { const a = YM.start(ym), b = YM.end(ym); return list.filter((e) => { const d = dt(e); return d >= a && d < b; }); };
const total = (list, kind) => sum(list, (e) => (e.kind === kind ? e.amount : 0));
const signed = (e) => (e.kind === 'income' ? e.amount : -e.amount);
const entryTitle = (e) => e.memo || e.cat;
function yearsList() {
  const set = new Set(S.entries.map((e) => dt(e).getFullYear()));
  set.add(new Date().getFullYear());
  return [...set].sort((a, b) => b - a);
}
function firstYM() {
  if (!S.entries.length) return YM.now();
  let min = dt(S.entries[0]);
  for (const e of S.entries) if (dt(e) < min) min = dt(e);
  return YM.of(min);
}
function groupBy(list, kind, key) {
  const map = new Map();
  for (const e of list) {
    if (e.kind !== kind) continue;
    const k = key === 'genre' ? (e.genre || '未分類') : e.cat;
    const cur = map.get(k) || { name: k, color: e.color, v: 0 };
    cur.v += e.amount;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.v - a.v);
}
function fold(slices, n = 5) {
  if (slices.length <= n + 1) return slices;
  return slices.slice(0, n).concat([{ name: 'そのほか', color: '#6E6A64', v: sum(slices.slice(n), (s) => s.v) }]);
}
function monthSums(endYM, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = YM.add(endYM, -i);
    const l = inYM(S.entries, m);
    const inc = total(l, 'income'), exp = total(l, 'expense');
    out.push({ ym: m, inc, exp, net: inc - exp, label: m.y === new Date().getFullYear() ? m.m + '月' : `${String(m.y).slice(2)}/${m.m}` });
  }
  return out;
}
function dailyCum(ym, fn, days) {
  const daily = new Array(YM.days(ym) + 1).fill(0);
  for (const e of inYM(S.entries, ym)) daily[dt(e).getDate()] += fn(e);
  const out = [];
  let run = 0;
  for (let d = 1; d <= Math.max(1, Math.min(days, YM.days(ym))); d++) { run += daily[d]; out.push(run); }
  return out;
}

// ===================== 画面の状態 =====================
const today0 = new Date();
const U = {
  tab: 'home',
  homeYM: YM.now(),
  hist: { view: 'list', period: 'month', from: ymd(YM.start(YM.now())), to: ymd(today0), asc: false, calYM: YM.now(), selDay: ymd(today0) },
  ana: { ym: YM.now(), tab: 'bal', monthSel: null, netMode: 'month', netYear: today0.getFullYear(), netSel: null, pace: {} },
  ov: [] // 重なって表示している画面（記録・シートなど）
};
const top = () => U.ov[U.ov.length - 1];
const findOv = (type) => { for (let i = U.ov.length - 1; i >= 0; i--) if (U.ov[i].type === type) return U.ov[i]; return null; };
function openOv(o) { o.fresh = true; U.ov.push(o); render(); }
function closeTop() { U.ov.pop(); render(); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

// ===================== アイコン =====================
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  list: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 2.6A8.5 8.5 0 0 1 21.4 9H15z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M6 12h12"/>',
  chevL: '<path d="M15 6l-6 6 6 6"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  chevU: '<path d="M6 15l6-6 6 6"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  sort: '<path d="M7 4v16M3 16l4 4 4-4"/><path d="M17 20V4M13 8l4-4 4 4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  clip: '<path d="M8 4h8v3H8z"/><path d="M6 5H5v16h14V5h-1M8 12h8M8 16h5"/>',
  down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  up: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  bs: '<path d="M21 5H8l-6 7 6 7h13z"/><path d="M12 9l6 6M18 9l-6 6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'
};
const ic = (name, size = 20, sw = 1.7, fill = 'none') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;

// ===================== 共通部品 =====================
function monthSel(ym, key) {
  const latest = YM.now();
  const years = yearsList();
  if (!years.includes(ym.y)) years.push(ym.y);
  years.sort((a, b) => b - a);
  const nextDis = YM.cmp(ym, latest) >= 0;
  return `<div class="month-sel">
    <button class="arrow" data-a="ym-prev" data-k="${key}" aria-label="前の月">${ic('chevL', 18)}</button>
    <label class="year-pick"><span class="sr">表示する年</span>
      <select data-f="ym-year" data-k="${key}">${years.map((y) => `<option value="${y}"${y === ym.y ? ' selected' : ''}>${y}年</option>`).join('')}</select>
      ${ic('chevD', 12, 2.6)}
    </label>
    <span class="mlabel">${ym.m}月</span>
    <button class="arrow" data-a="ym-next" data-k="${key}" aria-label="次の月"${nextDis ? ' disabled' : ''}>${ic('chevR', 18)}</button>
  </div>`;
}
function getYM(key) { return key === 'home' ? U.homeYM : key === 'cal' ? U.hist.calYM : U.ana.ym; }
function setYM(key, v) {
  const latest = YM.now();
  if (YM.cmp(v, latest) > 0) v = latest;
  if (key === 'home') U.homeYM = v;
  else if (key === 'cal') {
    U.hist.calYM = v;
    U.hist.selDay = YM.eq(v, latest) ? ymd(new Date()) : ymd(YM.start(v));
  } else { U.ana.ym = v; U.ana.monthSel = null; U.ana.netSel = null; U.ana.pace = {}; }
}

function seg(options, value, action, extra = '') {
  return `<div class="seg ${extra}" role="group">${options.map(([v, label, cls = '']) =>
    `<button class="${v === value ? 'on ' + cls : ''}" data-a="${action}" data-v="${v}" aria-pressed="${v === value}">${label}</button>`).join('')}</div>`;
}
const switchBtn = (on, action, id = '', label = '', small = false) =>
  `<button class="switch${small ? ' sm' : ''}${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-a="${action}"${id ? ` data-id="${id}"` : ''}><i></i></button>`;
const stepper = (value, action, label) =>
  `<div class="stepper"><button data-a="${action}" data-v="-1" aria-label="${label}を減らす">${ic('minus', 16, 2.2)}</button><b>${value}</b><button data-a="${action}" data-v="1" aria-label="${label}を増やす">${ic('plus', 16, 2.2)}</button></div>`;
const badge = (name, color, size = 40) =>
  `<span class="badge" style="width:${size}px;height:${size}px;color:${color};background:${color}24;font-size:${Math.round(size * 0.4)}px">${esc((name || '・').slice(0, 1))}</span>`;
const secTitle = (t, s = '') => `<div class="sec-title"><h2>${t}</h2>${s ? `<span>${s}</span>` : ''}</div>`;
const readout = (items) => `<div class="readout">${items.map(([k, v, c]) => `<div><span>${esc(k)}</span><b style="color:${c || 'var(--text)'}">${esc(v)}</b></div>`).join('')}</div>`;
const tile = (k, v, n = '', color = '') => `<div class="tile"><span class="k">${k}</span><span class="v" style="${color ? 'color:' + color : ''}">${esc(v)}</span>${n ? `<span class="n">${esc(n)}</span>` : ''}</div>`;
const empty = (title, msg, extra = '') => `<div class="empty">${ic('clip', 28, 1.4)}<b>${title}</b><p>${msg}</p>${extra}</div>`;

function entryRow(e, showDate = true) {
  const d = dt(e);
  return `<button class="row" data-a="edit" data-id="${e.id}">
    ${badge(e.cat, e.color)}
    <span class="main"><span class="t">${esc(entryTitle(e))}${e.ruleId ? `<span class="rep" aria-label="繰り返し">↻</span>` : ''}</span>
    <span class="s">${esc(e.cat)}${showDate ? ' · ' + md(d) : ''} ${hm(d)}</span></span>
    <span class="amt" style="color:${kindColor(e.kind)}">${e.kind === 'income' ? '+' : '−'}${yen(e.amount)}</span>
  </button>`;
}

// ===================== グラフ =====================
function niceMax(v) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
function donut(slices, size, sw) {
  const r = (size - sw) / 2, c = size / 2, C = 2 * Math.PI * r;
  const live = slices.filter((s) => s.v > 0);
  const tot = sum(live, (s) => s.v);
  const gap = live.length > 1 ? 3 : 0;
  let acc = 0, arcs = '';
  for (const s of live) {
    const len = s.v / tot * C;
    arcs += `<circle cx="${c}" cy="${c}" r="${r}" stroke="${s.color}" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}"/>`;
    acc += len;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><g transform="rotate(-90 ${c} ${c})" fill="none" stroke-width="${sw}"><circle cx="${c}" cy="${c}" r="${r}" stroke="#222226"/>${arcs}</g></svg>`;
}

/** 縦棒グラフ（複数系列・マイナス対応）。action を渡すと棒をタップで選択できる */
function bars({ labels, series, h = 160, sel = -1, action = '', topLabel = null, yFmt = (v) => short(v), aria = '' }) {
  const W = 320, padL = 36, padT = 16, padB = 20, plotH = h - padT - padB;
  const all = series.flatMap((s) => s.values);
  const max = niceMax(Math.max(0, ...all)), min = -niceMax(Math.max(0, ...all.map((v) => -v)));
  const span = (max - min) || 1;
  const y = (v) => padT + (max - v) / span * plotH;
  const n = labels.length, gw = (W - padL) / n, ns = series.length;
  const bw = Math.min(16, (gw * 0.72) / ns);
  let g = '';
  const ticks = [...new Set([max, max > 0 ? max / 2 : null, 0, min < 0 ? min : null].filter((v) => v !== null))];
  for (const t of ticks) {
    g += `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? '#3A3A40' : '#232327'}" stroke-width="1"/>`;
    g += `<text x="${padL - 5}" y="${y(t) + 3}" text-anchor="end" font-size="9" fill="#8C877F">${esc(yFmt(t))}</text>`;
  }
  labels.forEach((lab, i) => {
    const cx = padL + gw * i + gw / 2;
    const dim = sel >= 0 && sel !== i ? 0.45 : 1;
    series.forEach((s, si) => {
      const v = s.values[i];
      if (v == null) return;
      const x = cx - (bw * ns) / 2 + si * bw + 1;
      const y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v));
      const color = typeof s.color === 'function' ? s.color(v, i) : s.color;
      g += `<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(v === 0 ? 0 : 1.5, y1 - y0).toFixed(1)}" rx="3" fill="${color}" opacity="${dim}"/>`;
    });
    if (topLabel) {
      const t = topLabel(i);
      if (t) {
        const v = series[0].values[i] || 0;
        if (v !== 0) g += `<text x="${cx}" y="${v >= 0 ? y(v) - 4 : y(0) - 4}" text-anchor="middle" font-size="9" fill="#A8A399">${esc(t)}</text>`;
      }
    }
    g += `<text x="${cx}" y="${h - 5}" text-anchor="middle" font-size="10" fill="${sel === i ? '#E6CFA0' : '#A8A399'}">${esc(lab)}</text>`;
    if (action) g += `<rect x="${padL + gw * i}" y="0" width="${gw}" height="${h}" fill="transparent" data-a="${action}" data-i="${i}" style="cursor:pointer"><title>${esc(lab)}</title></rect>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(aria)}">${g}</svg>`;
}

/** 折れ線（日ごとの累計）。タップした位置の日を選択 */
function lines({ series, xMax = 31, h = 170, sel = 1, key, signedAxis = false, aria = '' }) {
  const W = 320, padL = 38, padT = 10, padB = 20, plotH = h - padT - padB;
  const all = series.flatMap((s) => s.values);
  const max = niceMax(Math.max(0, ...all)), min = -niceMax(Math.max(0, ...all.map((v) => -v)));
  const span = (max - min) || 1;
  const x = (d) => padL + (d - 1) / (xMax - 1) * (W - padL);
  const y = (v) => padT + (max - v) / span * plotH;
  let g = '';
  const ticks = [...new Set([max, 0, min].filter((v, i, a) => !(i > 0 && v === a[0])))];
  for (const t of ticks) {
    g += `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? '#4A4A50' : '#232327'}" stroke-width="1"/>`;
    g += `<text x="${padL - 5}" y="${y(t) + 3}" text-anchor="end" font-size="9" fill="#8C877F">${esc(short(t, signedAxis && t !== 0))}</text>`;
  }
  for (const d of [1, 10, 20, 31]) g += `<text x="${x(d)}" y="${h - 5}" text-anchor="middle" font-size="10" fill="#A8A399">${d}日</text>`;
  series.slice().reverse().forEach((s) => {
    if (!s.values.length) return;
    const pts = s.values.map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  g += `<line x1="${x(sel)}" x2="${x(sel)}" y1="${padT}" y2="${padT + plotH}" stroke="#8C877F" stroke-dasharray="3 3"/>`;
  series.forEach((s) => {
    const v = s.values[sel - 1];
    if (v != null) g += `<circle cx="${x(sel)}" cy="${y(v)}" r="4" fill="${s.color}" stroke="#17171A" stroke-width="2"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(aria)}" data-a="pace-tap" data-k="${key}" data-padl="${padL}" data-w="${W}" data-xmax="${xMax}" style="cursor:crosshair">${g}</svg>`;
}

function balanceCard(inc, exp, title, subtitle, mode) {
  const tot = inc + exp, net = inc - exp;
  const center = mode === 'rate'
    ? `<span>貯蓄率</span><b style="font-size:24px">${inc > 0 ? pct(net / inc) : '—'}</b>`
    : `<span>収支</span><b style="font-size:17px;color:${tot === 0 ? 'var(--sub)' : net >= 0 ? INCOME : EXPENSE}">${syen(net)}</b>`;
  const blk = (label, color, v) => `<div class="blk"><div class="h"><i class="dot" style="background:${color}"></i>${label}<em class="num">${tot > 0 ? pct(v / tot) : ''}</em></div><b style="color:${color}">${yen(v)}</b></div>`;
  return `<section class="card" aria-label="${esc(title)}。収入 ${yen(inc)}、支出 ${yen(exp)}、収支 ${syen(net)}" style="display:flex;flex-direction:column;gap:16px;border-radius:22px;padding:20px">
    ${secTitle(title, subtitle)}
    <div class="balance">
      <div class="donut" style="width:140px;height:140px">${donut([{ v: inc, color: INCOME }, { v: exp, color: EXPENSE }], 140, 14)}<div class="center">${center}</div></div>
      <div class="side">${blk('収入', INCOME, inc)}${blk('支出', EXPENSE, exp)}
        ${mode === 'rate' ? `<div style="display:flex;justify-content:space-between;align-items:baseline;padding-top:8px;border-top:1px solid var(--divider)"><span class="sub" style="font-size:12px">収支</span><b class="serif" style="font-size:15px;color:${net >= 0 ? INCOME : EXPENSE}">${syen(net)}</b></div>` : ''}
      </div>
    </div>
  </section>`;
}

// ===================== タブバー =====================
function vTabbar() {
  const t = (id, icon, label) => `<button class="${U.tab === id ? 'on' : ''}" data-a="tab" data-v="${id}" aria-current="${U.tab === id ? 'page' : 'false'}">${ic(icon, 21)}<span>${label}</span></button>`;
  return `<nav class="tabbar" aria-label="メインタブ">
    ${t('home', 'home', 'ホーム')}${t('history', 'list', '履歴')}
    <button class="add" data-a="new-entry" aria-label="記録する">${ic('plus', 24, 2.2)}</button>
    ${t('analysis', 'pie', '分析')}${t('settings', 'gear', '設定')}
  </nav>`;
}

// ===================== ホーム =====================
function vHome() {
  const ym = U.homeYM;
  const list = inYM(S.entries, ym).sort((a, b) => dt(b) - dt(a));
  const inc = total(list, 'income'), exp = total(list, 'expense');
  const endDay = YM.eq(ym, YM.now()) ? new Date().getDate() : YM.days(ym);
  let body;
  if (!list.length) {
    body = `<section class="card tight">${empty(`${YM.label(ym)}の記録はまだありません`, '下の＋ボタンから、最初の収入・支出を記録しましょう。',
      `<button class="btn-gold" data-a="new-entry" style="margin-top:8px">${ic('plus', 18, 2.2)}記録する</button>`)}</section>`;
  } else {
    const cats = groupBy(list, 'expense', 'cat').slice(0, 3);
    body = (cats.length ? `<section style="display:flex;flex-direction:column;gap:14px" aria-label="支出の多いカテゴリ">
      <h2 class="big">支出の多いカテゴリ</h2>
      ${cats.map((c) => `<div style="display:flex;flex-direction:column;gap:7px">
        <div style="display:flex;justify-content:space-between;font-size:13px"><span class="legend"><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span><span class="sub num">${yen(c.v)}（${pct(c.v / exp)}）</span></div>
        <div class="bar"><i style="width:${Math.max(2, c.v / exp * 100)}%;background:${c.color}"></i></div></div>`).join('')}
    </section>` : '') +
    `<section aria-label="最近の記録"><h2 class="big" style="margin-bottom:4px">最近の記録</h2>${list.slice(0, 5).map((e) => entryRow(e)).join('')}
      ${list.length > 5 ? `<button class="link" data-a="tab" data-v="history" style="margin-top:6px">履歴をすべて見る ${ic('chevR', 14)}</button>` : ''}</section>`;
  }
  return `<div class="screen"><div class="scroll" data-scroll="home"><div class="pad">
    ${monthSel(ym, 'home')}
    ${balanceCard(inc, exp, `${ym.m}月の収入と支出`, `${ym.m}/1–${ym.m}/${endDay}`, 'balance')}
    ${body}
  </div></div></div>`;
}

// ===================== 履歴 =====================
const PERIODS = [
  ['week', '今週'], ['month', '今月'], ['last', '先月'], ['3m', '過去3か月'], ['year', '今年'], ['all', 'すべて'], ['custom', '期間を指定']
];
function periodRange(p) {
  const t = sod(new Date());
  switch (p) {
    case 'week': return [addDays(t, -t.getDay()), t];
    case 'month': return [YM.start(YM.now()), t];
    case 'last': { const lm = YM.add(YM.now(), -1); return [YM.start(lm), addDays(YM.end(lm), -1)]; }
    case '3m': return [addDays(new Date(t.getFullYear(), t.getMonth() - 3, t.getDate()), 1), t];
    case 'year': return [new Date(t.getFullYear(), 0, 1), t];
    case 'all': return [null, null];
    default: {
      let a = sod(parse(U.hist.from)), b = sod(parse(U.hist.to));
      if (isNaN(a)) a = t;
      if (isNaN(b)) b = t;
      return a <= b ? [a, b] : [b, a];
    }
  }
}
const rangeText = (r) => (r[0] ? `${slash(r[0])}〜${slash(r[1])}` : '全期間');

function vHistory() {
  const h = U.hist;
  const tabs = `<div class="htabs" role="tablist">
    <button class="${h.view === 'list' ? 'on' : ''}" data-a="h-view" data-v="list" role="tab" aria-selected="${h.view === 'list'}">一覧</button>
    <button class="${h.view === 'cal' ? 'on' : ''}" data-a="h-view" data-v="cal" role="tab" aria-selected="${h.view === 'cal'}">カレンダー</button></div>`;
  return `<div class="screen"><div class="title-bar">履歴</div>${tabs}${h.view === 'list' ? vHistList() : vHistCal()}</div>`;
}

function vHistList() {
  const h = U.hist;
  const r = periodRange(h.period);
  const toEnd = r[1] ? addDays(r[1], 1) : null;
  const items = S.entries.filter((e) => { const d = dt(e); return (!r[0] || d >= r[0]) && (!toEnd || d < toEnd); });
  const groups = new Map();
  for (const e of items) { const k = ymd(dt(e)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const days = [...groups.keys()].sort((a, b) => (h.asc ? (a < b ? -1 : 1) : (a < b ? 1 : -1)));
  const label = PERIODS.find((p) => p[0] === h.period)[1];
  let tl = days.map((k) => {
    const list = groups.get(k).sort((a, b) => (h.asc ? dt(a) - dt(b) : dt(b) - dt(a)));
    const d = parse(k), w = d.getDay();
    const exp = total(list, 'expense'), inc = total(list, 'income');
    return `<div class="day">
      <div class="day-h">
        <div class="date" style="color:${w === 0 ? 'var(--sun)' : w === 6 ? 'var(--sat)' : 'var(--text)'}"><span class="num">${md(d)}</span><small>(${WD[w]})</small></div>
        <div class="knot"><i></i></div>
        <div class="tot">${exp ? `<span>支出 <span class="expense">${yen(exp)}</span></span>` : ''}${inc ? `<span>収入 <span class="income">${yen(inc)}</span></span>` : ''}</div>
        <button class="plus" data-a="new-on" data-d="${k}" aria-label="${md(d)}に記録を追加">${ic('plus', 20)}</button>
      </div>
      ${list.map((e) => `<button class="titem" data-a="edit" data-id="${e.id}">
        <span class="ic"><i style="background:${e.color}">${esc(e.cat.slice(0, 1))}</i></span>
        <span class="box"><span class="top"><b style="color:${e.kind === 'income' ? INCOME : 'var(--text)'}">${e.kind === 'income' ? '+' : ''}${yen(e.amount)}</b><small>${e.ruleId ? '↻ ' : ''}${hm(dt(e))}</small></span>
        <span class="c">${esc(e.cat)}（${esc(e.genre)}）</span>
        ${e.memo ? `<span class="m">${ic('clip', 13)}${esc(e.memo)}</span>` : ''}</span>
      </button>`).join('')}
    </div>`;
  }).join('');
  if (!days.length) tl = empty('この期間の記録はありません', '期間を変えるか、＋ボタンから記録を追加してください。');
  return `<div class="hctrl">
      <div class="btns">
        <button class="pbtn" data-a="open-period" aria-label="表示期間 ${label} ${rangeText(r)}。タップで変更">${ic('cal', 16)}<b>${label}</b><span>${rangeText(r)}</span>${ic('chevD', 12, 2.2)}</button>
        <button class="pbtn fit" data-a="h-sort" aria-label="並び順 ${h.asc ? '古い順（昇順）' : '新しい順（降順）'}。タップで切り替え">${ic('sort', 16)}${h.asc ? '古い順' : '新しい順'}</button>
      </div>
      <div class="hsum"><span>${items.length}件</span><span>収入 <b class="income">${yen(total(items, 'income'))}</b></span><span>支出 <b class="expense">${yen(total(items, 'expense'))}</b></span></div>
    </div>
    <div class="scroll" data-scroll="hlist"><div class="timeline">${tl}</div></div>`;
}

function vHistCal() {
  const h = U.hist, ym = h.calYM;
  const list = inYM(S.entries, ym);
  const exp = {}, inc = {};
  for (const e of list) { const d = dt(e).getDate(); (e.kind === 'expense' ? exp : inc)[d] = ((e.kind === 'expense' ? exp : inc)[d] || 0) + e.amount; }
  const first = YM.start(ym).getDay();
  const todayK = ymd(new Date());
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<span></span>';
  for (let d = 1; d <= YM.days(ym); d++) {
    const date = new Date(ym.y, ym.m - 1, d), k = ymd(date), w = date.getDay();
    const cls = [k === h.selDay ? 'sel' : '', k === todayK ? 'today' : '', date > new Date() ? 'fut' : '', w === 0 ? 'sun' : w === 6 ? 'sat' : ''].join(' ');
    cells += `<button class="${cls}" data-a="cal-day" data-d="${k}" aria-label="${ym.m}月${d}日 支出 ${yen(exp[d] || 0)}${inc[d] ? ' 収入 ' + yen(inc[d]) : ''}">
      <span class="d">${d}</span><span class="a">${exp[d] ? short(exp[d]) : '&nbsp;'}</span><i class="i" style="background:${inc[d] ? (k === h.selDay ? 'var(--on-gold)' : INCOME) : 'transparent'}"></i></button>`;
  }
  const sel = parse(h.selDay);
  const dayList = S.entries.filter((e) => ymd(dt(e)) === h.selDay).sort((a, b) => dt(a) - dt(b));
  return `<div class="scroll" data-scroll="hcal"><div class="pad" style="gap:12px">
    ${monthSel(ym, 'cal')}
    <div class="mini-tot"><div><span>支出</span><b class="expense">${yen(total(list, 'expense'))}</b></div><div><span>収入</span><b class="income">${yen(total(list, 'income'))}</b></div></div>
    <div style="display:flex;flex-direction:column;gap:6px">
      <div class="cal-head">${WD.map((w, i) => `<span style="color:${i === 0 ? 'var(--sun)' : i === 6 ? 'var(--sat)' : ''}">${w}</span>`).join('')}</div>
      <div class="cal">${cells}</div>
    </div>
    <section aria-label="選択した日の記録">
      <div style="display:flex;justify-content:space-between;align-items:center"><h2 class="big" style="font-size:15px">${sel.getMonth() + 1}月${sel.getDate()}日（${WD[sel.getDay()]}）</h2>
      <button class="link" data-a="new-on" data-d="${h.selDay}">${ic('plus', 15, 2.2)}追加</button></div>
      ${dayList.length ? dayList.map((e) => entryRow(e, false)).join('') : '<p class="hint" style="text-align:center;padding:20px 0">この日の記録はありません</p>'}
    </section>
  </div></div>`;
}

// ===================== 分析 =====================
function vAnalysis() {
  const a = U.ana;
  let content;
  if (!S.entries.length) {
    content = `<section class="card tight">${empty('まだ分析できる記録がありません', '収入や支出を記録すると、ここにグラフや傾向が表示されます。')}</section>`;
  } else {
    content = a.tab === 'bal' ? anaBalance() : a.tab === 'exp' ? anaKind('expense') : a.tab === 'inc' ? anaKind('income') : anaTrend();
  }
  return `<div class="screen"><div class="title-bar">分析</div>
    <div style="padding:0 20px;display:flex;flex-direction:column;gap:8px;flex-shrink:0">
      <div style="display:flex;justify-content:center">${monthSel(a.ym, 'ana')}</div>
      ${seg([['bal', '収支'], ['exp', '支出'], ['inc', '収入'], ['trend', '推移']], a.tab, 'ana-tab', 'small')}
    </div>
    <div class="scroll" data-scroll="ana-${a.tab}"><div class="pad" style="padding-top:14px;gap:14px">${content}</div></div></div>`;
}
const card = (inner, label = '') => `<section class="card" ${label ? `aria-label="${esc(label)}"` : ''} style="display:flex;flex-direction:column;gap:14px">${inner}</section>`;

function anaBalance() {
  const ym = U.ana.ym;
  const list = inYM(S.entries, ym), prev = inYM(S.entries, YM.add(ym, -1));
  const inc = total(list, 'income'), exp = total(list, 'expense'), prevExp = total(prev, 'expense');
  const fixed = sum(list, (e) => (e.kind === 'expense' && e.ruleId ? e.amount : 0));
  const variable = exp - fixed;
  const el = Math.max(1, YM.elapsed(ym));
  const months = monthSums(ym, 6);
  const si = U.ana.monthSel ?? months.length - 1;
  const s = months[si];
  const isNow = YM.eq(ym, YM.now());
  const r = exp > 0 ? fixed / exp : 0;
  return balanceCard(inc, exp, '収入と支出の割合', YM.label(ym), 'rate') +
    `<div class="tiles">
      ${tile('1日あたりの支出', yen(Math.round(exp / el)), `${el}日間の平均`)}
      ${tile('支出の先月比', prevExp > 0 ? (exp >= prevExp ? '+' : '−') + pct(Math.abs(exp - prevExp) / prevExp) : '—', prevExp > 0 ? `先月 ${yen(prevExp)}` : '先月の記録なし')}
      ${tile('固定費の割合', exp > 0 ? pct(fixed / exp) : '—', `繰り返し入力 ${yen(fixed)}`)}
      ${isNow ? tile('月末の支出見込み', yen(fixed + Math.round(variable / el * YM.days(ym))), 'このペースが続いた場合')
              : tile('貯蓄できた額', syen(inc - exp), '収入 − 支出', inc - exp >= 0 ? INCOME : EXPENSE)}
    </div>` +
    card(`${secTitle('月別の収支', 'グラフをタップで詳細')}
      <div style="display:flex;gap:14px"><span class="legend"><i class="dot" style="background:${INCOME}"></i>収入</span><span class="legend"><i class="dot" style="background:${EXPENSE}"></i>支出</span></div>
      ${bars({ labels: months.map((m) => m.label), series: [{ color: INCOME, values: months.map((m) => m.inc) }, { color: EXPENSE, values: months.map((m) => m.exp) }], h: 170, sel: si, action: 'ana-month', aria: '月別の収入と支出の棒グラフ' })}
      ${readout([[`${s.ym.m}月の収入`, yen(s.inc)], ['支出', yen(s.exp)], ['収支', syen(s.net), s.net >= 0 ? INCOME : EXPENSE]])}`, '月別の収支') +
    card(`${secTitle('固定費と変動費', `${ym.m}月`)}
      <div style="display:flex;height:14px;gap:2px">${fixed > 0 ? `<i style="width:${r * 100}%;background:#3987e5;border-radius:4px"></i>` : ''}<i style="flex:1;background:${exp > 0 && variable > 0 ? '#d95926' : 'var(--divider)'};border-radius:4px"></i></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${[['固定費', '#3987e5', fixed, '繰り返し入力の支出'], ['変動費', '#d95926', variable, 'それ以外の支出']].map(([l, c, v, n]) =>
          `<div style="display:flex;flex-direction:column;gap:3px"><span class="legend"><i class="dot" style="background:${c}"></i>${l} ${exp > 0 ? pct(v / exp) : '—'}</span><b class="serif" style="font-size:16px">${yen(v)}</b><span class="note">${n}</span></div>`).join('')}
      </div>`, '固定費と変動費');
}

function anaKind(kind) {
  const ym = U.ana.ym, kl = kindLabel(kind);
  const list = inYM(S.entries, ym), prev = inYM(S.entries, YM.add(ym, -1));
  const tot = total(list, kind);
  const genres = fold(groupBy(list, kind, 'genre'));
  const cats = groupBy(list, kind, 'cat');
  const prevMap = new Map(groupBy(prev, kind, 'cat').map((c) => [c.name, c.v]));
  const maxV = cats.length ? cats[0].v : 1;
  let html = card(`${secTitle(`ジャンル別の${kl}`, YM.label(ym))}
    ${tot === 0 ? `<p class="hint" style="text-align:center;padding:24px 0">この月の${kl}はありません</p>` : `
      <div style="display:flex;justify-content:center"><div class="donut" style="width:190px;height:190px" role="img" aria-label="ジャンル別${kl}：${esc(genres.map((g) => g.name + ' ' + pct(g.v / tot)).join('、'))}">${donut(genres, 190, 26)}
        <div class="center"><span>${kl}合計</span><b style="font-size:21px">${yen(tot)}</b></div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 18px">${genres.map((g) => `<div class="legend" style="min-width:0"><i class="dot" style="background:${g.color}"></i><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.name)}</span><span class="sub num">${pct(g.v / tot)}</span></div>`).join('')}</div>`}`, `ジャンル別の${kl}`);
  if (cats.length) {
    html += card(`${secTitle('カテゴリ別（先月との比較）', `${YM.add(ym, -1).m}月 → ${ym.m}月`)}
      ${cats.map((c) => { const d = c.v - (prevMap.get(c.name) || 0); return `<div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:baseline;gap:8px;font-size:13px"><i class="dot" style="background:${c.color};align-self:center"></i><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</span><b class="serif num">${yen(c.v)}</b><span class="sub num" style="width:78px;text-align:right;font-size:11px">${d === 0 ? '±0' : (d > 0 ? '▲ ' : '▼ ') + yen(Math.abs(d))}</span></div>
        <div class="bar" style="height:6px"><i style="width:${Math.max(2, c.v / maxV * 100)}%;background:${c.color}"></i></div></div>`; }).join('')}`, 'カテゴリ別の先月比較');
  }
  if (kind === 'expense') {
    const days = Math.max(1, YM.elapsed(ym));
    const sums = new Array(7).fill(0), counts = new Array(7).fill(0);
    for (let d = 1; d <= days; d++) counts[new Date(ym.y, ym.m - 1, d).getDay()]++;
    for (const e of list) if (e.kind === 'expense') sums[dt(e).getDay()] += e.amount;
    const avgs = sums.map((s, i) => (counts[i] ? Math.round(s / counts[i]) : 0));
    const topV = Math.max(...avgs), topI = avgs.indexOf(topV);
    html += card(`${secTitle('曜日別の平均支出', 'すべての支出')}
      ${bars({ labels: WD, series: [{ color: (v, i) => (i === topI && topV > 0 ? GOLD : '#4A463F'), values: avgs }], h: 140, aria: '曜日別の平均支出' })}
      ${topV > 0 ? `<p class="hint">${WD[topI]}曜日の平均が最も高く、${yen(topV)}です。</p>` : ''}`, '曜日別の平均支出');
    const top5 = list.filter((e) => e.kind === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 5);
    html += card(`${secTitle('大きな支出 TOP5', `${ym.m}月`)}
      ${top5.length ? top5.map((e, i) => `<button class="row" data-a="edit" data-id="${e.id}" style="border:0;padding:4px 0;gap:12px"><span class="serif muted" style="width:16px;font-size:13px">${i + 1}</span>${badge(e.cat, e.color, 32)}
        <span class="main"><span class="t" style="font-size:14px">${esc(entryTitle(e))}</span><span class="s" style="font-size:11px">${esc(e.cat)} · ${md(dt(e))}</span></span><span class="amt expense" style="font-size:14px">−${yen(e.amount)}</span></button>`).join('') : '<p class="hint">この月の支出はありません</p>'}`, '大きな支出');
  } else {
    const months = monthSums(ym, 6);
    const avg = Math.round(sum(months, (m) => m.inc) / months.length);
    html += card(`${secTitle('月別の収入', `平均 ${yen(avg)}`)}
      ${bars({ labels: months.map((m) => m.label), series: [{ color: INCOME, values: months.map((m) => m.inc) }], h: 160, topLabel: (i) => (months[i].inc ? short(months[i].inc) : ''), aria: '月別の収入' })}`, '月別の収入');
  }
  return html;
}

function anaTrend() {
  const a = U.ana, ym = a.ym;
  // ----- 収支の推移 -----
  let pts = [], stat1, stat2, foot, title;
  if (a.netMode === 'cum') {
    const first = firstYM(), now = YM.now();
    let run = 0, m = first;
    const yStart = { y: a.netYear, m: 1 };
    while (YM.cmp(m, yStart) < 0) { const l = inYM(S.entries, m); run += total(l, 'income') - total(l, 'expense'); m = YM.add(m, 1); }
    const carried = run;
    for (let mo = 1; mo <= 12; mo++) {
      const cur = { y: a.netYear, m: mo };
      if (YM.cmp(cur, now) > 0) break;
      const l = inYM(S.entries, cur);
      run += total(l, 'income') - total(l, 'expense');
      if (YM.cmp(cur, first) >= 0) pts.push({ label: mo + '月', v: run });
    }
    const last = pts.length ? pts[pts.length - 1].v : carried;
    stat1 = [`${a.netYear}年の通算`, last];
    stat2 = [`${a.netYear}年に増えた分`, last - carried];
    foot = carried ? `前年までの ${syen(carried)} を引き継いでいます。年をまたいでもリセットされません。` : '最初の記録からの通算です。年をまたいでもリセットされません。';
    title = `${a.netYear}年 · 最初の記録からの通算`;
  } else {
    pts = monthSums(ym, 6).map((m) => ({ label: m.label, v: m.net }));
    const t = sum(pts, (p) => p.v);
    stat1 = ['6か月の合計', t];
    stat2 = ['月平均', Math.round(t / Math.max(1, pts.length))];
    foot = `${ym.m}月までの6か月`;
    title = '月ごと';
  }
  const si = a.netSel != null && a.netSel < pts.length ? a.netSel : pts.length - 1;
  const years = yearsList();
  let html = card(`${secTitle('収支の推移')}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      ${seg([['month', '月ごと'], ['cum', '累計']], a.netMode, 'net-mode', 'small').replace('class="seg', 'style="width:150px" class="seg')}
      ${a.netMode === 'cum' ? `<label class="year-pick"><span class="sr">表示する年</span><select data-f="net-year" style="font-size:15px;height:34px;border-color:var(--gold);color:var(--gold-text)">${years.map((y) => `<option value="${y}"${y === a.netYear ? ' selected' : ''}>${y}年</option>`).join('')}</select>${ic('chevD', 11, 2.6)}</label>` : ''}
    </div>
    <p class="hint">収入 − 支出（${title}）</p>
    ${pts.length ? bars({ labels: pts.map((p) => p.label), series: [{ color: (v) => (v >= 0 ? INCOME : EXPENSE), values: pts.map((p) => p.v) }], h: 170, sel: si, action: 'net-sel',
        topLabel: a.netMode === 'cum' ? null : (i) => short(pts[i].v, true), aria: '収支の推移' }) +
      readout([[a.netMode === 'cum' ? `${pts[si].label}までの通算` : `${pts[si].label}の収支`, syen(pts[si].v), pts[si].v >= 0 ? INCOME : EXPENSE],
        [stat1[0], syen(stat1[1]), stat1[1] >= 0 ? INCOME : EXPENSE], [stat2[0], syen(stat2[1]), stat2[1] >= 0 ? INCOME : EXPENSE]])
      : '<p class="hint" style="text-align:center;padding:20px 0">この年の記録はありません</p>'}
    <p class="note">${foot}</p>`, '収支の推移');

  // ----- 累計ペース -----
  const pace = (key, ttl, note, fn, signedAxis) => {
    const pm = YM.add(ym, -1);
    const curDays = YM.eq(ym, YM.now()) ? Math.max(1, YM.elapsed(ym)) : YM.days(ym);
    const cur = dailyCum(ym, fn, curDays), prv = dailyCum(pm, fn, YM.days(pm));
    const day = clamp(a.pace[key] || curDays, 1, 31);
    const cv = cur[day - 1], pv = prv[day - 1];
    const f = signedAxis ? syen : yen;
    const col = (v) => (v == null ? 'var(--sub)' : signedAxis ? (v >= 0 ? INCOME : EXPENSE) : 'var(--text)');
    return card(`${secTitle(ttl, `${pm.m}月と比較`)}
      <p class="hint" style="margin-top:-6px">${note}</p>
      <div style="display:flex;gap:14px"><span class="legend"><i class="dot" style="background:${GOLD}"></i>${ym.m}月</span><span class="legend"><i class="dot" style="background:#6E6A64"></i>${pm.m}月</span></div>
      ${lines({ series: [{ color: GOLD, values: cur }, { color: '#6E6A64', values: prv }], sel: day, key, signedAxis, aria: `${ttl}。${day}日時点で${ym.m}月 ${cv == null ? 'データなし' : f(cv)}、${pm.m}月 ${pv == null ? 'データなし' : f(pv)}` })}
      <label class="hint" style="display:flex;flex-direction:column;gap:2px">日付を動かして比較（${day}日時点）
        <input class="range" type="range" min="1" max="31" value="${day}" data-f="pace" data-k="${key}"></label>
      ${readout([[`${ym.m}月`, cv == null ? '—' : f(cv), col(cv)], [`${pm.m}月`, pv == null ? '—' : f(pv), col(pv)], ['差', cv != null && pv != null ? syen(cv - pv) : '—']])}`, ttl);
  };
  html += pace('exp', '支出の累計ペース', '月初からの支出の積み上げ', (e) => (e.kind === 'expense' ? e.amount : 0), false);
  html += pace('net', '収支の累計ペース', '月初からの収入 − 支出の積み上げ', signed, true);

  // ----- 貯蓄率 -----
  const months = monthSums(ym, 6);
  const rates = months.map((m) => (m.inc > 0 ? Math.round(m.net / m.inc * 1000) / 10 : 0));
  html += card(`${secTitle('貯蓄率の推移', '収入のうち残せた割合')}
    ${bars({ labels: months.map((m) => m.label), series: [{ color: (v, i) => (i === months.length - 1 ? GOLD : '#4A463F'), values: rates }], h: 150, yFmt: (v) => Math.round(v) + '%',
      topLabel: (i) => (months[i].inc > 0 ? Math.round(rates[i]) + '%' : ''), aria: '貯蓄率の推移' })}`, '貯蓄率の推移');
  return html;
}

// ===================== 設定 =====================
function vSettings() {
  const rules = S.rules.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const act = rules.filter((r) => r.active);
  const mInc = sum(act.filter((r) => r.kind === 'income'), monthlyEstimate), mExp = sum(act.filter((r) => r.kind === 'expense'), monthlyEstimate);
  const favN = S.categories.filter((c) => c.fav).length;
  return `<div class="screen"><div class="title-bar">設定</div><div class="scroll" data-scroll="settings"><div class="pad">
    <section style="display:flex;flex-direction:column;gap:8px" aria-label="繰り返し入力">
      <div class="sec-title"><h2 style="display:flex;align-items:center;gap:8px"><span class="gold">${ic('repeat', 16)}</span>繰り返し入力</h2><span>${act.length}件が有効</span></div>
      <div class="list-card">
        <div class="sum2"><div><span>毎月の自動収入（目安）</span><b class="income">+${yen(mInc)}</b></div><div><span>毎月の自動支出（目安）</span><b class="expense">−${yen(mExp)}</b></div></div>
        ${rules.length ? '' : '<p class="hint" style="padding:12px 16px;border-bottom:1px solid var(--divider)">まだ登録がありません。家賃・給与・サブスクなど、決まって発生する収入・支出を登録すると、自動で記録されます。</p>'}
        ${rules.map((r) => `<div class="rule${r.active ? '' : ' off'}">
          <button class="open" data-a="rule-open" data-id="${r.id}">${badge(r.cat, r.color, 36)}
            <span class="main"><span class="t">${esc(r.memo || r.cat)}</span><span class="s">${kindLabel(r.kind)} · ${esc(repSummary(r, r.start))}</span></span>
            <span class="amt" style="color:${kindColor(r.kind)}">${r.kind === 'income' ? '+' : '−'}${yen(r.amount)}</span></button>
          ${switchBtn(r.active, 'rule-toggle', r.id, (r.memo || r.cat) + 'の自動記録', true)}
        </div>`).join('')}
        <button class="item" data-a="rule-new" style="justify-content:center;color:var(--gold);font-weight:700">${ic('plus', 16, 2.2)}繰り返しを追加</button>
      </div>
      <p class="note">金額は月あたりの目安です。スイッチをオフにすると一時停止し、再開後は再開した日以降の分から記録されます。</p>
    </section>

    <section style="display:flex;flex-direction:column;gap:8px" aria-label="一般">
      <h2 class="big" style="font-size:15px">一般</h2>
      <div class="list-card">
        <button class="item" data-a="catman-open"><span class="ico">${ic('grid', 15)}</span><span class="grow">カテゴリの管理</span><span class="v">★ ${favN}件</span>${ic('chevR', 14)}</button>
        <button class="item" data-a="export-csv"><span class="ico">${ic('down', 15)}</span><span class="grow">データの書き出し（CSV）</span><span class="v">${S.entries.length}件</span></button>
        <button class="item" data-a="export-json"><span class="ico">${ic('shield', 15)}</span><span class="grow">バックアップを保存</span><span class="v">復元用</span></button>
        <button class="item" data-a="import-json"><span class="ico">${ic('up', 15)}</span><span class="grow">バックアップから復元</span></button>
      </div>
      <input type="file" id="restoreFile" accept=".json,application/json" hidden>
    </section>

    <section class="list-card" aria-label="削除">
      <button class="item danger" data-a="reset"><span class="ico" style="color:var(--expense)">${ic('trash', 15)}</span><span class="grow">すべての記録を削除</span></button>
    </section>
    <p class="note">データはこのiPhoneの中にだけ保存され、外部には送信されません。ホーム画面からアプリを削除するとデータも消えるため、ときどき「バックアップを保存」でファイルに保存しておくと安心です。<br>バージョン ${APP_VERSION}${U.persisted ? ' · データ保護：有効' : ''}</p>
  </div></div></div>`;
}

// ===================== 記録する（新規・編集） =====================
function newEditor(dateStr) {
  const o = { type: 'editor', mode: 'new', kind: 'expense', digits: '0', sel: {}, date: dateStr || toLocal(new Date()), memo: '', rep: null };
  o.rep = defaultRep(o.date);
  ensureSel(o);
  return o;
}
function editEditor(e) {
  const o = { type: 'editor', mode: 'edit', id: e.id, kind: e.kind, digits: String(e.amount), sel: {}, date: e.date, memo: e.memo, rep: defaultRep(e.date), origCat: e.cat };
  const c = findCatByName(e.kind, e.cat);
  if (c) o.sel[e.kind] = c.id;
  return o;
}
function ensureSel(o) {
  const cur = o.sel[o.kind] && catById(o.sel[o.kind]);
  if (cur && genreById(cur.genreId) && genreById(cur.genreId).kind === o.kind) return;
  const f = favCats(o.kind)[0] || allCats(o.kind)[0];
  o.sel[o.kind] = f ? f.id : null;
}
function vEditor(o) {
  const isNew = o.mode === 'new';
  const sel = o.sel[o.kind] ? catById(o.sel[o.kind]) : null;
  const favs = favCats(o.kind);
  const amount = Number(o.digits) || 0;
  const canSave = amount > 0 && !!sel;
  const kc = kindColor(o.kind);
  const tileHtml = (c, on, action) => {
    const g = genreById(c.genreId), col = g ? g.color : '#8C877F';
    return `<button class="ctile${on ? ' on' : ''}" data-a="${action}" data-id="${c.id}" aria-pressed="${on}" style="${on ? `border-color:${col};background:${col}26` : ''}"><b style="color:${col}">${esc(c.name.slice(0, 1))}</b><span>${esc(c.name)}</span></button>`;
  };
  let tiles = favs.map((c) => tileHtml(c, sel && sel.id === c.id, 'ed-cat')).join('');
  if (sel && !sel.fav) tiles += tileHtml(sel, true, 'open-cats');
  tiles += `<button class="ctile all" data-a="open-cats" aria-label="すべてのカテゴリを開く">${ic('dots', 18, 2.4)}<span>すべて</span></button>`;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'];
  return `<div class="page${o.fresh ? ' anim' : ''}" role="dialog" aria-label="${isNew ? '記録する' : '記録を編集'}">
    <div class="page-head">
      <button class="back" data-a="close">${ic('chevL', 18, 2)}${isNew ? 'ホーム' : '閉じる'}</button>
      <span class="ttl">${isNew ? '記録する' : '記録を編集'}</span>
      <span class="right">${isNew ? '' : `<button class="icon-btn expense" data-a="ed-del" aria-label="この記録を削除">${ic('trash', 19)}</button>`}</span>
    </div>
    <div class="scroll" data-scroll="editor"><div class="editor-body">
      ${seg([['expense', '支出', 'exp'], ['income', '収入', 'inc']], o.kind, 'ed-kind')}
      <div class="amount" aria-label="金額 ${yen(amount)}"><span>金額</span><div class="val" style="color:${kc}"><i>¥</i><b>${num(amount)}</b></div></div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="fav-head"><span style="display:flex;align-items:center;gap:6px"><span class="gold">${ic('star', 12, 1.5, 'currentColor')}</span>${kindLabel(o.kind)}のお気に入り</span>
          <button class="link" data-a="open-cats">${ic('pencil', 14)}お気に入りを編集</button></div>
        <div class="tiles4" role="radiogroup" aria-label="カテゴリ">${tiles}</div>
      </div>
      <div class="fields">
        <label class="field"><span>日時</span><input type="datetime-local" data-f="ed-date" value="${esc(o.date)}"></label>
        <label class="field"><span>メモ</span><input type="text" data-f="ed-memo" value="${esc(o.memo)}" placeholder="例：ランチ" enterkeyhint="done" maxlength="60"></label>
        ${isNew ? `<button class="field" data-a="open-repeat"><span style="display:flex;align-items:center;gap:8px">${ic('repeat', 16)}繰り返し</span>
          <span class="val${o.rep.on ? ' on' : ''}"><span>${o.rep.on ? esc(repSummary(o.rep, o.date)) : 'なし'}</span>${ic('chevR', 14)}</span></button>` : ''}
      </div>
    </div></div>
    <div class="keypad" role="group" aria-label="テンキー">${keys.map((k) => `<button data-a="key" data-k="${k}" aria-label="${k === 'del' ? '1文字削除' : k}">${k === 'del' ? ic('bs', 22, 1.6) : k}</button>`).join('')}</div>
    <div class="save-wrap"><button class="btn-gold" data-a="ed-save"${canSave ? '' : ' disabled'}>${isNew ? '保存する' : '変更を保存'}</button></div>
  </div>`;
}
function saveEditor(o) {
  const c = o.sel[o.kind] ? catById(o.sel[o.kind]) : null;
  const amount = Number(o.digits) || 0;
  if (!c || amount <= 0) return;
  const info = catInfo(c);
  if (isNaN(parse(o.date))) o.date = toLocal(new Date());
  if (o.mode === 'new') {
    if (o.rep.on) {
      const r = Object.assign({ id: uid(), memo: o.memo.trim(), kind: o.kind, amount, cat: info.cat, genre: info.genre, color: info.color,
        start: o.date, active: true, lastGen: null, genCount: 0, createdAt: toLocal(new Date()) }, repFields(o.rep));
      S.rules.push(r);
      const n = generateRecurring();
      toast(n ? `繰り返しを登録し、${n}件を記録しました` : '繰り返しを登録しました');
    } else {
      S.entries.push({ id: uid(), date: o.date, amount, kind: o.kind, cat: info.cat, genre: info.genre, color: info.color, memo: o.memo.trim(), ruleId: null, createdAt: toLocal(new Date()) });
      toast('保存しました');
    }
  } else {
    const e = S.entries.find((x) => x.id === o.id);
    if (e) Object.assign(e, { date: o.date, amount, kind: o.kind, cat: info.cat, genre: info.genre, color: info.color, memo: o.memo.trim() });
    toast('変更を保存しました');
  }
  persist();
  U.ov = U.ov.filter((x) => x !== o);
  render();
}

// ===================== カテゴリを選ぶ（シート） =====================
function vCats(o) {
  const ed = findOv('editor');
  const kind = ed.kind, selId = ed.sel[kind];
  const q = (o.q || '').trim();
  const gs = genresOf(kind);
  if (!gs.find((g) => g.id === o.addTo)) o.addTo = gs[0] ? gs[0].id : null;
  const favN = favCats(kind).length;
  let sections = gs.map((g) => {
    const all = catsOfGenre(g.id);
    const items = q ? all.filter((c) => c.name.includes(q) || g.name.includes(q)) : all;
    if (q && !items.length) return '';
    return `<section style="display:flex;flex-direction:column;gap:8px" aria-label="${esc(g.name)}">
      <div class="genre-h"><i class="dot" style="background:${g.color}"></i>${esc(g.name)}<small>${all.length}件</small>
        ${o.gedit ? `<span class="ops"><button class="mini plain" data-a="g-rename" data-id="${g.id}">${ic('pencil', 13)}名前</button><button class="mini danger" data-a="g-del" data-id="${g.id}" aria-label="ジャンル「${esc(g.name)}」を削除">${ic('trash', 13)}削除</button></span>` : ''}</div>
      ${items.length ? `<div class="chips">${items.map((c) => {
        const on = c.id === selId;
        return `<div class="chip" style="${on ? `border-color:${g.color};background:${g.color}1F` : ''}">
          <button class="pick" data-a="cs-pick" data-id="${c.id}" aria-pressed="${on}"><i style="color:${g.color};background:${g.color}24">${esc(c.name.slice(0, 1))}</i><span>${esc(c.name)}</span></button>
          ${o.gedit
            ? `<button class="op" data-a="c-rename" data-id="${c.id}" aria-label="${esc(c.name)}の名前を変更">${ic('pencil', 15)}</button><button class="op del" data-a="c-del" data-id="${c.id}" aria-label="${esc(c.name)}を削除">${ic('x', 15)}</button>`
            : `<button class="star${c.fav ? ' on' : ''}" data-a="cs-star" data-id="${c.id}" aria-pressed="${c.fav}" aria-label="${esc(c.name)}を${c.fav ? 'お気に入りから外す' : 'お気に入りに追加'}">${ic('star', 17, 1.6, c.fav ? 'currentColor' : 'none')}</button>`}
        </div>`;
      }).join('')}</div>` : '<div class="dash">まだカテゴリがありません。下の欄から追加できます。</div>'}
    </section>`;
  }).join('');
  if (q && !sections.trim()) sections = '<p class="hint" style="text-align:center;padding:20px 0">該当するカテゴリがありません</p>';
  return `<div class="sheet-bg${o.fresh ? ' anim' : ''}" data-a="close"><div class="sheet tall" data-a="noop" role="dialog" aria-label="${kindLabel(kind)}のカテゴリ">
    <div class="grab"></div>
    <div class="sheet-head">
      <button class="mini ${o.gedit ? 'danger' : 'plain'}" data-a="cs-gedit">${o.gedit ? '編集を終了' : 'ジャンル・カテゴリを編集'}</button>
      <h2>${kindLabel(kind)}のカテゴリ</h2>
      <button class="done" data-a="close">完了</button>
    </div>
    <div style="padding:0 20px 8px;display:flex;flex-direction:column;gap:8px">
      <label class="search">${ic('search', 16)}<span class="sr">カテゴリを検索</span><input type="search" data-f="cs-q" value="${esc(o.q || '')}" placeholder="カテゴリを検索"></label>
      <p class="hint">${o.gedit ? 'ジャンルとカテゴリの名前変更・削除、ジャンルの追加ができます。削除しても過去の記録は残ります。' : `名前をタップで選択、★でお気に入り（${favN}件）。お気に入りは記録画面のタイルに表示されます。`}</p>
    </div>
    <div class="sheet-body" data-scroll="cats">${sections}
      ${o.gedit ? `<div class="dash gold" style="display:flex;flex-direction:column;gap:8px"><b class="gold" style="font-size:12px">新しいジャンル</b>
        <div style="display:flex;gap:8px"><input class="txt" data-f="cs-ng" value="${esc(o.ng || '')}" placeholder="例：子ども、ペット" maxlength="12"><button class="btn-line" data-a="cs-add-genre">追加</button></div></div>` : ''}
    </div>
    <div class="sheet-foot">
      <label style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--sub)"><span style="flex-shrink:0">追加先のジャンル</span>
        <select class="selbox" data-f="cs-to">${gs.map((g) => `<option value="${g.id}"${g.id === o.addTo ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <div style="display:flex;gap:8px"><input class="txt" data-f="cs-nn" value="${esc(o.nn || '')}" placeholder="新しいカテゴリ名" maxlength="12" enterkeyhint="done">
        <button class="btn-gold" data-a="cs-add" style="width:auto;min-height:44px;padding:0 18px;font-size:14px">追加</button></div>
    </div>
  </div></div>`;
}

// ===================== 繰り返しの設定 =====================
function repeatFields(r, startStr) {
  const st = parse(startStr);
  const unitWord = { day: '日', week: '週間', month: 'か月', year: '年' }[r.unit];
  return `<div class="group"><span class="lbl">間隔</span>
      <div class="line"><span>${r.interval === 1 ? '毎回（間隔 1）' : `${r.interval}${unitWord}おき`}</span>${stepper(r.interval, 'rp-n', '間隔')}</div>
      ${seg([['day', '日'], ['week', '週'], ['month', '月'], ['year', '年']], r.unit, 'rp-unit', 'small')}
      ${r.unit === 'week' ? `<div class="wdays" role="group" aria-label="曜日">${WD.map((w, i) => { const on = r.weekdays.includes(i + 1); return `<button class="${on ? 'on' : ''}" data-a="rp-wd" data-v="${i + 1}" aria-pressed="${on}" aria-label="${w}曜日">${w}</button>`; }).join('')}</div>` : ''}
      ${r.unit === 'month' ? `<div class="line"><span>月末に記録</span>${switchBtn(r.monthEnd, 'rp-me', '', '月末に記録')}</div>
        ${r.monthEnd ? '' : `<div class="line"><span>日付</span>${stepper(r.monthDay + '日', 'rp-md', '日付')}</div>`}` : ''}
      ${r.unit === 'year' ? `<div class="line"><span>日付</span><span class="sub">毎年 ${st.getMonth() + 1}月${st.getDate()}日</span></div>` : ''}
    </div>
    <div class="group"><span class="lbl">期間</span>
      <div class="line"><span>開始日</span><span class="sub">${isNaN(st) ? '—' : fullDate(st)}</span></div>
      ${seg([['none', 'なし'], ['count', '回数'], ['date', '日付']], r.end, 'rp-end', 'small')}
      ${r.end === 'count' ? `<div class="line"><span>回数</span>${stepper(r.endCount + '回', 'rp-cnt', '回数')}</div>` : ''}
      ${r.end === 'date' ? `<label class="line"><span>終了日</span><input type="date" class="selbox" style="flex:0 0 auto" data-f="rp-ed" value="${esc(r.endDate)}" min="${esc(startStr.slice(0, 10))}"></label>` : ''}
    </div>
    <div class="summary">${ic('cal', 16)}<b>${esc(repSummary(r, startStr))}</b></div>`;
}
function vRepeat(o) {
  const ed = findOv('editor');
  const r = ed.rep;
  const c = ed.sel[ed.kind] ? catById(ed.sel[ed.kind]) : null;
  const note = r.on
    ? `${c ? `「${esc(c.name)}」の` : ''}${kindLabel(ed.kind)}を、${esc(fullDate(parse(ed.date)))}から「${esc(repSummary(r, ed.date))}」で自動的に記録します。あとから設定画面の「繰り返し入力」で変更・停止できます。`
    : `この${kindLabel(ed.kind)}は今回だけ記録されます。「繰り返す」をオンにすると、間隔・曜日・終了条件を自由に設定できます。`;
  return `<div class="sheet-bg${o.fresh ? ' anim' : ''}" data-a="close"><div class="sheet tall" data-a="noop" role="dialog" aria-label="繰り返しの設定">
    <div class="grab"></div>
    <div class="sheet-head"><span style="width:60px"></span><h2>繰り返し</h2><button class="done" data-a="close">完了</button></div>
    <div class="sheet-body" data-scroll="repeat">
      <div class="group"><div class="line"><span>繰り返す</span>${switchBtn(r.on, 'rp-on', '', '繰り返す')}</div></div>
      ${r.on ? repeatFields(r, ed.date) : ''}
      <p class="hint">${note}</p>
    </div>
  </div></div>`;
}

// ===================== 表示期間（履歴） =====================
function vPeriod(o) {
  const h = U.hist;
  return `<div class="sheet-bg${o.fresh ? ' anim' : ''}" data-a="close"><div class="sheet" data-a="noop" role="dialog" aria-label="表示期間">
    <div class="grab"></div>
    <div class="sheet-head"><span style="width:60px"></span><h2>表示期間</h2><button class="done" data-a="close">完了</button></div>
    <div class="sheet-body">
      <div class="opt-list" role="radiogroup">${PERIODS.map(([id, label]) => `<button class="opt" data-a="h-period" data-v="${id}" role="radio" aria-checked="${h.period === id}">
        <span>${label}${id === 'custom' ? '' : `<small>${rangeText(periodRange(id))}</small>`}</span>${h.period === id ? `<span class="gold">${ic('check', 18, 2)}</span>` : ''}</button>`).join('')}</div>
      ${h.period === 'custom' ? `<div class="group"><label class="line"><span>開始日</span><input type="date" class="selbox" style="flex:0 0 auto" data-f="h-from" value="${h.from}"></label>
        <label class="line"><span>終了日</span><input type="date" class="selbox" style="flex:0 0 auto" data-f="h-to" value="${h.to}"></label></div>` : ''}
    </div>
  </div></div>`;
}

// ===================== 繰り返し入力の追加・編集（設定） =====================
function ruleEditor(r) {
  if (!r) {
    const start = toLocal(new Date());
    const rep = defaultRep(start);
    rep.on = true;
    const f = favCats('expense')[0] || allCats('expense')[0];
    return { type: 'rule', id: null, kind: 'expense', amount: '', catId: f ? f.id : '', memo: '', start, rep, active: true };
  }
  const c = findCatByName(r.kind, r.cat);
  return { type: 'rule', id: r.id, kind: r.kind, amount: String(r.amount), catId: c ? c.id : '', memo: r.memo, start: r.start,
    rep: Object.assign({ on: true, touched: true }, repFields(r)), active: r.active };
}
function vRule(o) {
  const r = o.id ? S.rules.find((x) => x.id === o.id) : null;
  const gs = genresOf(o.kind);
  const next = r && r.active ? nextOccurrence(r) : null;
  return `<div class="page${o.fresh ? ' anim' : ''}" role="dialog" aria-label="${r ? '繰り返しを編集' : '繰り返しを追加'}">
    <div class="page-head">
      <button class="back" data-a="close">${ic('chevL', 18, 2)}${r ? '戻る' : 'キャンセル'}</button>
      <span class="ttl">${r ? '繰り返しを編集' : '繰り返しを追加'}</span>
      <span class="right"><button class="link" data-a="rule-save" style="font-size:15px;padding:0 8px">保存</button></span>
    </div>
    <div class="scroll" data-scroll="rule"><div class="editor-body" style="padding-bottom:28px">
      ${seg([['expense', '支出', 'exp'], ['income', '収入', 'inc']], o.kind, 'rule-kind')}
      <div class="fields">
        <label class="field"><span>金額（円）</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-f="rule-amt" value="${esc(o.amount)}" placeholder="0"></label>
        <label class="field"><span>カテゴリ</span><select data-f="rule-cat">${gs.map((g) => `<optgroup label="${esc(g.name)}">${catsOfGenre(g.id).map((c) => `<option value="${c.id}"${c.id === o.catId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <label class="field"><span>メモ</span><input type="text" data-f="rule-memo" value="${esc(o.memo)}" placeholder="例：家賃、動画サブスク" maxlength="60"></label>
        <label class="field"><span>開始日時</span><input type="datetime-local" data-f="rule-start" value="${esc(o.start)}"></label>
      </div>
      ${repeatFields(o.rep, o.start)}
      ${r ? `<div class="group">
          <div class="line"><span>自動で記録する</span>${switchBtn(o.active, 'rule-active', '', '自動で記録する')}</div>
          <div class="line"><span>これまでに作成</span><span class="sub">${r.genCount || 0}件</span></div>
          ${next ? `<div class="line"><span>次回</span><span class="sub">${fullDate(next)}</span></div>` : ''}
        </div>
        <button class="btn-line" data-a="rule-del" style="border-color:#5A2E2A;color:#F08A80;min-height:46px">${ic('trash', 16)}この繰り返しを削除</button>
        <p class="note">削除しても、これまでに作成された記録は残ります。</p>` : ''}
    </div></div>
  </div>`;
}
function saveRule(o) {
  const amount = Number(String(o.amount).replace(/[^0-9]/g, '')) || 0;
  const c = catById(o.catId);
  if (amount <= 0) return toast('金額を入力してください');
  if (!c) return toast('カテゴリを選んでください');
  if (isNaN(parse(o.start))) return toast('開始日時を入力してください');
  const info = catInfo(c);
  const fields = { kind: o.kind, amount, cat: info.cat, genre: info.genre, color: info.color, memo: o.memo.trim(), start: o.start };
  if (o.id) {
    const r = S.rules.find((x) => x.id === o.id);
    if (r) {
      Object.assign(r, fields, repFields(o.rep));
      if (o.active && !r.active) {
        const now = toLocal(new Date());
        if (!r.lastGen || r.lastGen < now) r.lastGen = now; // 停止中の分はさかのぼらない
      }
      r.active = o.active;
    }
  } else {
    S.rules.push(Object.assign({ id: uid(), active: true, lastGen: null, genCount: 0, createdAt: toLocal(new Date()) }, fields, repFields(o.rep)));
  }
  const n = generateRecurring();
  persist();
  U.ov = U.ov.filter((x) => x !== o);
  toast(n ? `保存し、${n}件を記録しました` : '保存しました');
  render();
}

// ===================== カテゴリの管理（設定） =====================
function vCatman(o) {
  const gs = genresOf(o.kind);
  return `<div class="page${o.fresh ? ' anim' : ''}" role="dialog" aria-label="カテゴリの管理">
    <div class="page-head">
      <button class="back" data-a="close">${ic('chevL', 18, 2)}設定</button>
      <span class="ttl">カテゴリの管理</span><span class="right"></span>
    </div>
    <div class="scroll" data-scroll="catman"><div class="editor-body" style="padding-bottom:28px">
      ${seg([['expense', '支出'], ['income', '収入']], o.kind, 'cm-kind')}
      <p class="hint">★はお気に入り（記録画面のタイルに表示）です。矢印で並べ替え、✎で名前の変更、×で削除できます。削除しても過去の記録は残ります。</p>
      ${gs.map((g, gi) => {
        const cs = catsOfGenre(g.id);
        return `<section class="list-card" aria-label="${esc(g.name)}">
          <div class="genre-h" style="padding:8px 8px 8px 16px;border-bottom:1px solid var(--divider)"><i class="dot" style="background:${g.color}"></i>${esc(g.name)}<small>${cs.length}件</small>
            <span class="ops">
              <button class="mini plain" data-a="g-up" data-id="${g.id}" aria-label="${esc(g.name)}を上へ"${gi === 0 ? ' disabled' : ''}>${ic('chevU', 14, 2)}</button>
              <button class="mini plain" data-a="g-down" data-id="${g.id}" aria-label="${esc(g.name)}を下へ"${gi === gs.length - 1 ? ' disabled' : ''}>${ic('chevD', 14, 2)}</button>
              <button class="mini plain" data-a="g-rename" data-id="${g.id}" aria-label="${esc(g.name)}の名前を変更">${ic('pencil', 14)}</button>
              <button class="mini danger" data-a="g-del" data-id="${g.id}" aria-label="${esc(g.name)}を削除">${ic('trash', 14)}</button>
            </span></div>
          ${cs.map((c, ci) => `<div class="cm-row">
            <button class="star${c.fav ? ' on' : ''}" data-a="cm-star" data-id="${c.id}" aria-pressed="${c.fav}" aria-label="${esc(c.name)}を${c.fav ? 'お気に入りから外す' : 'お気に入りに追加'}">${ic('star', 17, 1.6, c.fav ? 'currentColor' : 'none')}</button>
            <span class="name">${esc(c.name)}</span>
            <button data-a="c-up" data-id="${c.id}" aria-label="${esc(c.name)}を上へ"${ci === 0 ? ' disabled' : ''}>${ic('chevU', 16)}</button>
            <button data-a="c-down" data-id="${c.id}" aria-label="${esc(c.name)}を下へ"${ci === cs.length - 1 ? ' disabled' : ''}>${ic('chevD', 16)}</button>
            <button data-a="c-rename" data-id="${c.id}" aria-label="${esc(c.name)}の名前を変更">${ic('pencil', 16)}</button>
            <button class="del" data-a="c-del" data-id="${c.id}" aria-label="${esc(c.name)}を削除">${ic('x', 16)}</button>
          </div>`).join('')}
          <button class="item" data-a="cm-add-cat" data-id="${g.id}" style="color:var(--gold);min-height:46px">${ic('plus', 16, 2.2)}カテゴリを追加</button>
        </section>`;
      }).join('')}
      <button class="btn-line" data-a="cm-add-genre" style="min-height:48px">${ic('folder', 17)}ジャンルを追加</button>
    </div></div>
  </div>`;
}

function addGenre(kind, name) {
  name = (name || '').trim();
  if (!name) return false;
  if (genresOf(kind).some((g) => g.name === name)) { toast('同じ名前のジャンルがあります'); return false; }
  const g = { id: uid(), name, kind, color: PALETTE[genresOf(kind).length % PALETTE.length], order: Math.max(-1, ...S.genres.map((x) => x.order)) + 1 };
  S.genres.push(g);
  persist();
  return g;
}
function addCategory(kind, gid, name, fav) {
  name = (name || '').trim();
  if (!name || !gid) return false;
  if (allCats(kind).some((c) => c.name === name)) { toast('同じ名前のカテゴリがあります'); return false; }
  const c = { id: uid(), name, genreId: gid, order: Math.max(-1, ...catsOfGenre(gid).map((x) => x.order)) + 1, fav: !!fav, favOrder: fav ? nextFavOrder() : 0 };
  S.categories.push(c);
  persist();
  return c;
}
function moveItem(list, id, dir) {
  const i = list.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((x, k) => { x.order = k; });
  persist();
}

// ===================== 描画 =====================
function vOverlay(o) {
  switch (o.type) {
    case 'editor': return vEditor(o);
    case 'cats': return vCats(o);
    case 'repeat': return vRepeat(o);
    case 'period': return vPeriod(o);
    case 'rule': return vRule(o);
    case 'catman': return vCatman(o);
    default: return '';
  }
}
function vScreen() {
  switch (U.tab) {
    case 'history': return vHistory();
    case 'analysis': return vAnalysis();
    case 'settings': return vSettings();
    default: return vHome();
  }
}
function render() {
  const keep = {};
  document.querySelectorAll('[data-scroll]').forEach((el) => { keep[el.dataset.scroll] = el.scrollTop; });
  const ae = document.activeElement;
  const fKey = ae && ae.dataset && ae.dataset.f ? ae.dataset.f + '|' + (ae.dataset.k || '') : null;
  let s0 = null, s1 = null;
  try { s0 = ae.selectionStart; s1 = ae.selectionEnd; } catch (_) { /* 対象外の入力 */ }

  $('#app').innerHTML = vScreen() + vTabbar();
  $('#overlay').innerHTML = U.ov.map(vOverlay).join('');
  U.ov.forEach((o) => { o.fresh = false; });
  document.body.style.overflow = U.ov.length ? 'hidden' : '';

  document.querySelectorAll('[data-scroll]').forEach((el) => { if (keep[el.dataset.scroll] != null) el.scrollTop = keep[el.dataset.scroll]; });
  if (fKey) {
    const [f, k] = fKey.split('|');
    const el = document.querySelector(`[data-f="${f}"]${k ? `[data-k="${k}"]` : ''}`);
    if (el && el.type !== 'range' && el.tagName !== 'SELECT') {
      el.focus({ preventScroll: true });
      try { if (s0 != null) el.setSelectionRange(s0, s1); } catch (_) { /* 対象外 */ }
    }
  }
}

// ===================== 操作 =====================
function act(a, el, ev) {
  const d = el.dataset;
  const o = top();
  switch (a) {
    case 'noop': return;
    case 'close': return closeTop();
    case 'tab': U.tab = d.v; U.ov = []; render(); document.querySelector('.scroll')?.scrollTo(0, 0); return;
    case 'new-entry': return openOv(newEditor());
    case 'new-on': {
      const now = new Date();
      const day = parse(d.d);
      return openOv(newEditor(toLocal(new Date(day.getFullYear(), day.getMonth(), day.getDate(), now.getHours(), now.getMinutes()))));
    }
    case 'edit': { const e = S.entries.find((x) => x.id === d.id); if (e) openOv(editEditor(e)); return; }
    case 'ym-prev': setYM(d.k, YM.add(getYM(d.k), -1)); return render();
    case 'ym-next': setYM(d.k, YM.add(getYM(d.k), 1)); return render();

    // --- 記録する ---
    case 'ed-kind': o.kind = d.v; ensureSel(o); return render();
    case 'ed-cat': o.sel[o.kind] = d.id; return render();
    case 'key': {
      let s = o.digits === '0' ? '' : o.digits;
      if (d.k === 'del') s = s.slice(0, -1);
      else if (s.length < 9) s = (s + d.k).replace(/^0+/, '');
      o.digits = s.slice(0, 9) || '0';
      return render();
    }
    case 'ed-save': return saveEditor(o);
    case 'ed-del':
      if (confirm('この記録を削除しますか？')) {
        S.entries = S.entries.filter((x) => x.id !== o.id);
        persist(); U.ov.pop(); toast('削除しました'); render();
      }
      return;
    case 'open-cats': { const ed = findOv('editor'); return openOv({ type: 'cats', q: '', gedit: false, addTo: null, nn: '', ng: '', kind: ed.kind }); }
    case 'open-repeat': return openOv({ type: 'repeat' });

    // --- カテゴリシート ---
    case 'cs-pick': { const ed = findOv('editor'); ed.sel[ed.kind] = d.id; U.ov.pop(); return render(); }
    case 'cs-star': case 'cm-star': { const c = catById(d.id); if (c) { toggleFav(c); persist(); } return render(); }
    case 'cs-gedit': o.gedit = !o.gedit; return render();
    case 'cs-add': {
      const ed = findOv('editor');
      const c = addCategory(ed.kind, o.addTo, o.nn, true);
      if (c) { o.nn = ''; ed.sel[ed.kind] = c.id; toast(`「${c.name}」を追加しました`); }
      return render();
    }
    case 'cs-add-genre': {
      const g = addGenre(findOv('editor').kind, o.ng);
      if (g) { o.ng = ''; o.addTo = g.id; toast(`ジャンル「${g.name}」を追加しました`); }
      return render();
    }
    case 'g-rename': {
      const g = genreById(d.id); if (!g) return;
      const n = prompt('ジャンル名を変更', g.name);
      if (n && n.trim()) { g.name = n.trim(); persist(); render(); }
      return;
    }
    case 'g-del': {
      const g = genreById(d.id); if (!g) return;
      if (confirm(`ジャンル「${g.name}」と中のカテゴリ${catsOfGenre(g.id).length}件を削除しますか？\n（過去の記録は残ります）`)) {
        deleteGenre(g);
        const ed = findOv('editor'); if (ed) ensureSel(ed);
        persist(); render();
      }
      return;
    }
    case 'c-rename': {
      const c = catById(d.id); if (!c) return;
      const n = prompt('カテゴリ名を変更', c.name);
      if (n && n.trim()) { c.name = n.trim(); persist(); render(); }
      return;
    }
    case 'c-del': {
      const c = catById(d.id); if (!c) return;
      if (confirm(`カテゴリ「${c.name}」を削除しますか？\n（過去の記録は残ります）`)) {
        S.categories = S.categories.filter((x) => x.id !== c.id);
        const ed = findOv('editor'); if (ed) ensureSel(ed);
        persist(); render();
      }
      return;
    }

    // --- 繰り返し（記録画面・設定の両方） ---
    case 'rp-on': { const ed = findOv('editor'); ed.rep.on = !ed.rep.on; return render(); }
    case 'rp-n': case 'rp-unit': case 'rp-wd': case 'rp-me': case 'rp-md': case 'rp-end': case 'rp-cnt': {
      const holder = findOv('rule') && top().type === 'rule' ? top() : findOv('editor');
      const r = holder.rep, v = Number(d.v);
      r.touched = true;
      if (a === 'rp-n') r.interval = clamp(r.interval + v, 1, 99);
      if (a === 'rp-unit') r.unit = d.v;
      if (a === 'rp-wd') {
        if (r.weekdays.includes(v)) { if (r.weekdays.length > 1) r.weekdays = r.weekdays.filter((x) => x !== v); }
        else r.weekdays = r.weekdays.concat([v]).sort((x, y) => x - y);
      }
      if (a === 'rp-me') r.monthEnd = !r.monthEnd;
      if (a === 'rp-md') r.monthDay = clamp(r.monthDay + v, 1, 31);
      if (a === 'rp-end') r.end = d.v;
      if (a === 'rp-cnt') r.endCount = clamp(r.endCount + v, 1, 999);
      return render();
    }

    // --- 履歴 ---
    case 'h-view': U.hist.view = d.v; return render();
    case 'h-sort': U.hist.asc = !U.hist.asc; return render();
    case 'open-period': return openOv({ type: 'period' });
    case 'h-period': U.hist.period = d.v; if (d.v !== 'custom') U.ov.pop(); return render();
    case 'cal-day': U.hist.selDay = d.d; return render();

    // --- 分析 ---
    case 'ana-tab': U.ana.tab = d.v; return render();
    case 'ana-month': U.ana.monthSel = Number(d.i); return render();
    case 'net-mode': U.ana.netMode = d.v; U.ana.netSel = null; return render();
    case 'net-sel': U.ana.netSel = Number(d.i); return render();
    case 'pace-tap': {
      const svg = el, rect = svg.getBoundingClientRect();
      const W = Number(d.w), padL = Number(d.padl), xMax = Number(d.xmax);
      const xv = (ev.clientX - rect.left) / rect.width * W;
      U.ana.pace[d.k] = clamp(Math.round(1 + (xv - padL) / (W - padL) * (xMax - 1)), 1, xMax);
      return render();
    }

    // --- 設定：繰り返し入力 ---
    case 'rule-new': return openOv(ruleEditor(null));
    case 'rule-open': { const r = S.rules.find((x) => x.id === d.id); if (r) openOv(ruleEditor(r)); return; }
    case 'rule-toggle': {
      const r = S.rules.find((x) => x.id === d.id); if (!r) return;
      r.active = !r.active;
      if (r.active) { const now = toLocal(new Date()); if (!r.lastGen || r.lastGen < now) r.lastGen = now; }
      persist(); render(); toast(r.active ? '自動記録を再開しました' : '自動記録を停止しました');
      return;
    }
    case 'rule-kind': {
      o.kind = d.v;
      const cur = catById(o.catId);
      if (!cur || genreById(cur.genreId)?.kind !== o.kind) { const f = favCats(o.kind)[0] || allCats(o.kind)[0]; o.catId = f ? f.id : ''; }
      return render();
    }
    case 'rule-active': o.active = !o.active; return render();
    case 'rule-save': return saveRule(o);
    case 'rule-del':
      if (confirm('この繰り返しを削除しますか？\n（これまでに作成された記録は残ります）')) {
        S.rules = S.rules.filter((x) => x.id !== o.id);
        persist(); U.ov.pop(); toast('削除しました'); render();
      }
      return;

    // --- 設定：カテゴリの管理 ---
    case 'catman-open': return openOv({ type: 'catman', kind: 'expense' });
    case 'cm-kind': o.kind = d.v; return render();
    case 'g-up': case 'g-down': { const g = genreById(d.id); if (g) moveItem(genresOf(g.kind), g.id, a === 'g-up' ? -1 : 1); return render(); }
    case 'c-up': case 'c-down': { const c = catById(d.id); if (c) moveItem(catsOfGenre(c.genreId), c.id, a === 'c-up' ? -1 : 1); return render(); }
    case 'cm-add-cat': {
      const g = genreById(d.id); if (!g) return;
      const n = prompt(`「${g.name}」に追加するカテゴリ名`);
      if (n && addCategory(g.kind, g.id, n, false)) render();
      return;
    }
    case 'cm-add-genre': {
      const n = prompt(`追加する${kindLabel(o.kind)}のジャンル名`);
      if (n && addGenre(o.kind, n)) render();
      return;
    }

    // --- 設定：データ ---
    case 'export-csv': return exportCSV();
    case 'export-json': return exportJSON();
    case 'import-json': return $('#restoreFile')?.click();
    case 'reset':
      if (confirm('すべての記録と繰り返し入力を削除しますか？\nカテゴリとジャンルは残ります。この操作は取り消せません。')) {
        S.entries = []; S.rules = []; persist(); render(); toast('すべての記録を削除しました');
      }
      return;
    default:
  }
}

function field(f, el, evType) {
  const o = top();
  const v = el.value;
  switch (f) {
    case 'ym-year': {
      const k = el.dataset.k, cur = getYM(k);
      setYM(k, { y: Number(v), m: cur.m });
      return render();
    }
    case 'ed-date': if (v) { o.date = v; if (!o.rep.touched) o.rep = Object.assign(defaultRep(v), { on: o.rep.on }); if (evType === 'change') render(); } return;
    case 'ed-memo': o.memo = v; return;
    case 'cs-q': o.q = v; return render();
    case 'cs-nn': o.nn = v; return;
    case 'cs-ng': o.ng = v; return;
    case 'cs-to': o.addTo = v; return;
    case 'rp-ed': {
      const holder = top().type === 'rule' ? top() : findOv('editor');
      if (v) { holder.rep.endDate = v; holder.rep.touched = true; }
      if (evType === 'change') render();
      return;
    }
    case 'h-from': if (v) { U.hist.from = v; if (evType === 'change') render(); } return;
    case 'h-to': if (v) { U.hist.to = v; if (evType === 'change') render(); } return;
    case 'net-year': U.ana.netYear = Number(v); U.ana.netSel = null; return render();
    case 'pace': U.ana.pace[el.dataset.k] = Number(v); return render();
    case 'rule-amt': o.amount = v.replace(/[^0-9]/g, ''); if (evType === 'change') { el.value = o.amount; } return;
    case 'rule-cat': o.catId = v; return;
    case 'rule-memo': o.memo = v; return;
    case 'rule-start': if (v) { o.start = v; if (!o.rep.touched) o.rep = Object.assign(defaultRep(v), { on: true }); if (evType === 'change') render(); } return;
    default:
  }
}

// ===================== 書き出し・バックアップ =====================
async function shareOrDownload(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
function exportCSV() {
  if (!S.entries.length) return toast('書き出す記録がありません');
  const q = (s) => { s = String(s ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['日時', '種類', 'ジャンル', 'カテゴリ', '金額', 'メモ', '繰り返し']];
  S.entries.slice().sort((a, b) => dt(a) - dt(b)).forEach((e) =>
    rows.push([e.date.replace('T', ' '), kindLabel(e.kind), e.genre, e.cat, e.amount, e.memo, e.ruleId ? '○' : '']));
  shareOrDownload(`家計簿_${stamp()}.csv`, '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv');
}
function exportJSON() {
  const data = { app: 'kakeibo', exportedAt: toLocal(new Date()), version: APP_VERSION, state: S };
  shareOrDownload(`家計簿バックアップ_${stamp()}.json`, JSON.stringify(data), 'application/json');
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const st = data && data.state ? data.state : data;
      if (!validState(st)) throw new Error('形式が違います');
      if (!confirm(`バックアップから復元しますか？\n記録 ${st.entries.length}件・繰り返し ${st.rules.length}件\n今のデータはすべて置き換わります。`)) return;
      S = st;
      dateCache.clear();
      generateRecurring();
      persist(); U.ov = []; render();
      toast('復元しました');
    } catch (e) {
      alert('このファイルは復元できません。家計簿アプリで保存したバックアップ（.json）を選んでください。');
    }
  };
  reader.readAsText(file);
}

// ===================== 起動 =====================
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a]');
  if (!el || el.disabled) return;
  act(el.dataset.a, el, ev);
});
document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-f]');
  if (el && el.tagName !== 'SELECT') field(el.dataset.f, el, 'input');
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'restoreFile') {
    const f = ev.target.files && ev.target.files[0];
    if (f) importJSON(f);
    ev.target.value = '';
    return;
  }
  const el = ev.target.closest('[data-f]');
  if (el) field(el.dataset.f, el, 'change');
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.matches('input[type="text"], input[type="search"]')) {
    const f = ev.target.dataset.f;
    if (f === 'cs-nn') { ev.preventDefault(); act('cs-add', ev.target, ev); return; }
    if (f === 'cs-ng') { ev.preventDefault(); act('cs-add-genre', ev.target, ev); return; }
    ev.target.blur();
  }
  if (ev.key === 'Escape' && U.ov.length) closeTop();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { clearTimeout(saveTimer); writeState(); }
  else if (S && generateRecurring()) render();
});

async function start() {
  const saved = await loadState();
  S = validState(saved) ? saved : freshState();
  if (!validState(saved)) await writeState();
  generateRecurring();
  render();
  try { if (navigator.storage && navigator.storage.persist) U.persisted = await navigator.storage.persist(); } catch (_) { /* 未対応 */ }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン化できない環境 */ });
  }
  // 日付が変わったら繰り返し入力を反映
  setInterval(() => { if (generateRecurring()) render(); }, 60 * 1000);
}
start();

// テスト用（動作確認でのみ使用）
window.__kakeibo = { get state() { return S; }, ui: U, occurrences, repSummary };
})();
