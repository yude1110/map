(() => {
'use strict';

/* ================= 小工具 ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function el(tag, cls, html){ const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const ls = {
  get(k){ try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch (e) {} },
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const pad = n => String(n).padStart(2,'0');
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (date, time) => new Date(`${date}T${time || '12:00'}:00`);
function clockRel(d, ref){
  const day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())) / 864e5);
  return (day < 0 ? '前一天 ' : day > 0 ? '隔天 ' : '') + hm(d);
}
function dur(m){
  if (!isFinite(m)) return '—';
  m = Math.round(m);
  if (m < 60) return m + ' 分';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
}
const durS = m => { m = Math.round(m); return m < 60 ? m + '分' : Math.floor(m / 60) + 'h' + pad(m % 60); };
const km = m => m < 1000 ? Math.round(m) + ' 公尺' : (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + ' 公里';
function hav(a,b){
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat/2) ** 2 + Math.cos(a.lat*r) * Math.cos(b.lat*r) * Math.sin(dLng/2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(s)));
}
function decodePoly(str){
  const out = []; let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const k of [0,1]) {
      let b, shift = 0, res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = (res & 1) ? ~(res >> 1) : (res >> 1);
      if (k === 0) lat += d; else lng += d;
    }
    out.push({lat:lat / 1e5, lng:lng / 1e5});
  }
  return out;
}

/* ================= 設定 ================= */
const KEY_STORE = 'yqn-gkey', STORE = 'yqn-state-v2';
let KEY = ls.get(KEY_STORE) || '';
const COLORS = ['#2F6FDB','#D6336C','#2B9348','#9C36B5','#B7791F','#0B7285','#5F3DC4','#A61E4D','#3B5BDB','#2F9E44','#C2255C','#495057'];
const MODES = {
  transit:{label:'大眾運輸', api:'TRANSIT', gm:'transit', extra:0},
  car:{label:'開車', api:'DRIVE', gm:'driving', extra:10},
  scooter:{label:'機車', api:'TWO_WHEELER', gm:'driving', extra:3},
  taxi:{label:'計程車', api:'DRIVE', gm:'driving', extra:5},
  walk:{label:'步行', api:'WALK', gm:'walking', extra:0},
  bike:{label:'單車', api:'BICYCLE', gm:'bicycling', extra:2},
};
const MODE_ORDER = ['transit','car','scooter','taxi','walk','bike'];
const CATS = [
  {k:'food', label:'餐廳', q:'餐廳'},
  {k:'cafe', label:'咖啡廳', q:'咖啡廳'},
  {k:'station', label:'車站', q:'車站'},
  {k:'mall', label:'百貨商場', q:'百貨公司'},
  {k:'sight', label:'景點', q:'景點'},
];
const OBJ_HINT = {
  balanced:'兼顧平均時間和大家之間的落差，多數情況最好用。',
  max:'讓花最久的那個人盡量少花，最公平。',
  sum:'大家加起來花的時間最少，不在意誰多跑一點。',
};

/* ================= Google API ================= */
const PLACES = 'https://places.googleapis.com/v1/places';
const ROUTES_DIR = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ROUTES_MATRIX = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const PLACE_FIELDS = ['id','displayName','formattedAddress','location','googleMapsUri','rating','userRatingCount','primaryTypeDisplayName'];

async function gfetch(url, {body, mask}){
  if (!KEY) { showSetup(); throw new Error('還沒設定 Google Maps API 金鑰。'); }
  let r;
  try {
    r = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {'Content-Type':'application/json', 'X-Goog-Api-Key':KEY, 'X-Goog-FieldMask':mask},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new Error('連不上 Google 服務，請確認網路連線。'); }
  let j = null;
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) {
    const err = (Array.isArray(j) ? j[0] : j)?.error || {};
    const api = url.includes('routes.') ? 'Routes API' : 'Places API (New)';
    const msg = err.message || r.statusText || '未知錯誤';
    if (r.status === 403 || err.status === 'PERMISSION_DENIED')
      throw new Error(`${api} 拒絕了請求：${msg}。請確認已啟用 ${api}，而且金鑰的網站限制包含目前網址（${location.origin}/*）。`);
    throw new Error(`${api}：${msg}`);
  }
  return j;
}
const sec = d => d == null ? NaN : parseFloat(d);
const wp = p => p.placeId ? {placeId:p.placeId} : {location:{latLng:{latitude:p.lat, longitude:p.lng}}};
const toLoc = p => ({
  placeId:p.id, name:p.displayName?.text || '未命名地點', address:p.formattedAddress || '',
  lat:p.location?.latitude, lng:p.location?.longitude, uri:p.googleMapsUri || '',
  rating:p.rating || 0, ratings:p.userRatingCount || 0, type:p.primaryTypeDisplayName?.text || '',
});

function timeParams(api, t = {}){
  const soon = Date.now() + 2 * 60000;
  if (api === 'TRANSIT') {
    if (t.arrive && +t.arrive > soon) return {arrivalTime:new Date(t.arrive).toISOString()};
    if (t.depart && +t.depart > soon) return {departureTime:new Date(t.depart).toISOString()};
    return {};
  }
  if (api === 'DRIVE' || api === 'TWO_WHEELER') {
    const d = t.depart || (t.arrive ? new Date(+t.arrive - 60 * 60000) : null);
    if (d && +d > soon) return {departureTime:new Date(d).toISOString(), routingPreference:'TRAFFIC_AWARE'};
    return {routingPreference:'TRAFFIC_AWARE'};
  }
  return {};
}

async function searchText(q, center, radiusM, n){
  const j = await gfetch(`${PLACES}:searchText`, {
    body:{textQuery:q, languageCode:'zh-TW', regionCode:'TW', pageSize:n,
      locationBias:{circle:{center:{latitude:center.lat, longitude:center.lng}, radius:clamp(radiusM, 100, 50000)}}},
    mask:PLACE_FIELDS.map(f => 'places.' + f).join(','),
  });
  return (j?.places || []).map(toLoc).filter(p => isFinite(p.lat));
}
async function autocomplete(input, token){
  const body = {input, languageCode:'zh-TW', includedRegionCodes:['tw'], sessionToken:token};
  if (map) { const c = map.getCenter(); body.locationBias = {circle:{center:{latitude:c.lat(), longitude:c.lng()}, radius:50000}}; }
  const j = await gfetch(`${PLACES}:autocomplete`, {body, mask:'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat'});
  return (j?.suggestions || []).map(s => s.placePrediction).filter(Boolean).map(p => ({
    placeId:p.placeId, main:p.structuredFormat?.mainText?.text || p.text?.text || '', sub:p.structuredFormat?.secondaryText?.text || '',
  }));
}
async function placeDetails(id, token){
  const j = await gfetch(`${PLACES}/${encodeURIComponent(id)}?languageCode=zh-TW&regionCode=TW${token ? '&sessionToken=' + encodeURIComponent(token) : ''}`, {mask:PLACE_FIELDS.join(',')});
  return toLoc(j);
}

/* 交通時間矩陣：每次最多 100 格，超過就切塊。機車／單車沒有路線時改用開車／步行估。 */
async function matrixRaw(origins, dests, api, t){
  const arr = await gfetch(ROUTES_MATRIX, {
    body:{origins:origins.map(p => ({waypoint:wp(p)})), destinations:dests.map(p => ({waypoint:wp(p)})),
      travelMode:api, languageCode:'zh-TW', regionCode:'TW', ...timeParams(api, t)},
    mask:'originIndex,destinationIndex,duration,distanceMeters,condition,status',
  });
  const M = origins.map(() => dests.map(() => null));
  for (const e of arr || []) {
    if (e.condition === 'ROUTE_EXISTS' && e.duration != null) M[e.originIndex || 0][e.destinationIndex || 0] = {sec:sec(e.duration), m:e.distanceMeters || 0};
  }
  return M;
}
async function matrix(origins, dests, mode, t){
  const run = async api => {
    const per = Math.max(1, Math.floor(100 / origins.length)), parts = [];
    for (let i = 0; i < dests.length; i += per) parts.push(matrixRaw(origins, dests.slice(i, i + per), api, t));
    const res = await Promise.all(parts);
    return origins.map((_, oi) => res.flatMap(r => r[oi]));
  };
  const api = MODES[mode].api, alt = api === 'TWO_WHEELER' ? 'DRIVE' : api === 'BICYCLE' ? 'WALK' : null;
  let M;
  try { M = await run(api); }
  catch (e) { if (!alt) throw e; return {M:await run(alt), api:alt}; }
  if (alt && M.every(row => row.every(x => !x))) return {M:await run(alt), api:alt};
  return {M, api};
}

const VEH = {HIGH_SPEED_TRAIN:'hsr', HEAVY_RAIL:'rail', RAIL:'rail', COMMUTER_TRAIN:'rail', LONG_DISTANCE_TRAIN:'rail',
  SUBWAY:'mrt', METRO_RAIL:'mrt', MONORAIL:'mrt', TRAM:'mrt', LIGHT_RAIL:'mrt', CABLE_CAR:'mrt', FUNICULAR:'mrt', GONDOLA_LIFT:'mrt',
  BUS:'bus', INTERCITY_BUS:'bus', TROLLEYBUS:'bus', SHARE_TAXI:'bus', FERRY:'ferry'};
const ROUTE_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.distanceMeters,routes.legs.steps.transitDetails';
async function routeOne(a, b, mode, t){
  let api = MODES[mode].api;
  const call = api => gfetch(ROUTES_DIR, {body:{origin:wp(a), destination:wp(b), travelMode:api, languageCode:'zh-TW', regionCode:'TW', ...timeParams(api, t)}, mask:ROUTE_MASK});
  let j;
  try { j = await call(api); }
  catch (e) { if (api !== 'TWO_WHEELER' && api !== 'BICYCLE') throw e; api = api === 'TWO_WHEELER' ? 'DRIVE' : 'WALK'; j = await call(api); }
  if (!j?.routes?.length && (api === 'TWO_WHEELER' || api === 'BICYCLE')) { api = api === 'TWO_WHEELER' ? 'DRIVE' : 'WALK'; j = await call(api); }
  const r = j?.routes?.[0];
  return r ? parseRoute(r, mode, api) : null;
}
function parseRoute(r, mode, api){
  const out = {sec:sec(r.duration), m:r.distanceMeters || 0, path:decodePoly(r.polyline?.encodedPolyline || ''), legs:[], firstDep:null, lastArr:null, walkBefore:0, walkAfter:0};
  const fallback = api !== MODES[mode].api;
  if (api !== 'TRANSIT') {
    out.legs.push({kind:mode, label:MODES[mode].label, note:km(out.m) + (fallback ? `（Google 沒有${MODES[mode].label}路線，以${api === 'DRIVE' ? '開車' : '步行'}估算）` : ''), min:out.sec / 60});
    return out;
  }
  let walk = 0, walkM = 0, seen = false;
  const flush = () => { if (walk >= 30) out.legs.push({kind:'walk', label:'步行', note:km(walkM), min:walk / 60}); walk = 0; walkM = 0; };
  for (const s of (r.legs || []).flatMap(l => l.steps || [])) {
    const td = s.transitDetails;
    if (td) {
      flush();
      const sd = td.stopDetails || {}, ln = td.transitLine || {};
      const dep = sd.departureTime ? new Date(sd.departureTime) : null, arr = sd.arrivalTime ? new Date(sd.arrivalTime) : null;
      if (!seen) { out.firstDep = dep; seen = true; }
      out.lastArr = arr; out.walkAfter = 0;
      const vname = ln.vehicle?.name?.text || '大眾運輸', lname = ln.nameShort || ln.name || '';
      out.legs.push({
        kind:VEH[ln.vehicle?.type] || 'bus', label:vname,
        note:`${lname ? lname + '・' : ''}${sd.departureStop?.name || ''} → ${sd.arrivalStop?.name || ''}${td.stopCount ? `（${td.stopCount} 站）` : ''}`,
        time:dep && arr ? `${hm(dep)}–${hm(arr)}` : '', min:dep && arr ? (arr - dep) / 60000 : sec(s.staticDuration) / 60,
      });
    } else {
      const d = sec(s.staticDuration) || 0;
      walk += d; walkM += s.distanceMeters || 0;
      if (!seen) out.walkBefore += d; else out.walkAfter += d;
    }
  }
  flush();
  if (!out.legs.length) out.legs.push({kind:'walk', label:'步行', note:km(out.m), min:out.sec / 60});
  return out;
}

function gmapDir(a, b, mode, wps){
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api','1');
  u.searchParams.set('origin', `${a.lat},${a.lng}`);
  if (a.placeId) u.searchParams.set('origin_place_id', a.placeId);
  u.searchParams.set('destination', `${b.lat},${b.lng}`);
  if (b.placeId) u.searchParams.set('destination_place_id', b.placeId);
  u.searchParams.set('travelmode', MODES[mode].gm);
  if (wps && wps.length) {
    u.searchParams.set('waypoints', wps.map(p => `${p.lat},${p.lng}`).join('|'));
    if (wps.every(p => p.placeId)) u.searchParams.set('waypoint_place_ids', wps.map(p => p.placeId).join('|'));
  }
  return u.toString();
}

/* ================= 狀態 ================= */
let uid = 1;
function tomorrow(){ const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); }
function defaultState(){
  return {
    tab:'meet',
    friends:[1,2,3].map((n,i) => ({id:uid++, c:i, name:'朋友' + n, loc:null, mode:'transit'})),
    opt:{obj:'balanced', cats:{food:true, cafe:false, station:false, mall:false, sight:false}, keyword:'', minRating:true, maxPer:180, date:tomorrow(), time:'12:00', buffer:10, topN:5},
    trip:{start:null, date:tomorrow(), time:'10:00', mode:'transit', end:'loop', endLoc:null, stops:[{id:uid++, loc:null, stay:60, earliest:'', latest:''}]},
  };
}
const okLoc = l => l && isFinite(l.lat) && isFinite(l.lng) && typeof l.name === 'string'
  ? {placeId:l.placeId || '', name:l.name, address:l.address || '', lat:+l.lat, lng:+l.lng, uri:l.uri || '', rating:+l.rating || 0, ratings:+l.ratings || 0, type:l.type || ''} : null;
function load(){
  const s = defaultState();
  try {
    const d = JSON.parse(ls.get(STORE) || 'null');
    if (!d) return s;
    if (Array.isArray(d.friends) && d.friends.length) s.friends = d.friends.slice(0,12).map((f,i) => ({id:uid++, c:Number.isInteger(f.c) ? f.c : i, name:String(f.name || '').slice(0,12), loc:okLoc(f.loc), mode:MODES[f.mode] ? f.mode : 'transit'}));
    if (d.opt) Object.assign(s.opt, d.opt, {cats:Object.assign({}, s.opt.cats, d.opt.cats)});
    if (d.trip) {
      Object.assign(s.trip, {date:d.trip.date || s.trip.date, time:d.trip.time || s.trip.time, mode:MODES[d.trip.mode] ? d.trip.mode : 'transit', end:['loop','open','fixed'].includes(d.trip.end) ? d.trip.end : 'loop', start:okLoc(d.trip.start), endLoc:okLoc(d.trip.endLoc)});
      if (Array.isArray(d.trip.stops) && d.trip.stops.length) s.trip.stops = d.trip.stops.slice(0,12).map(x => ({id:uid++, loc:okLoc(x.loc), stay:Math.max(0, +x.stay || 0), earliest:x.earliest || '', latest:x.latest || ''}));
    }
    if (s.opt.date < ymd(new Date())) s.opt.date = tomorrow();
    if (s.trip.date < ymd(new Date())) s.trip.date = tomorrow();
    s.tab = d.tab === 'trip' ? 'trip' : 'meet';
  } catch (e) {}
  return s;
}
const state = load();
let saveT = 0;
function save(){
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const {tab, opt, friends, trip} = state;
    ls.set(STORE, JSON.stringify({tab, opt, friends:friends.map(({c,name,loc,mode}) => ({c,name,loc,mode})), trip:{...trip, stops:trip.stops.map(({loc,stay,earliest,latest}) => ({loc,stay,earliest,latest}))}}));
  }, 250);
}
const colorOf = f => COLORS[f.c % COLORS.length];
function nextColor(){
  const used = new Set(state.friends.map(f => f.c % COLORS.length));
  for (let i = 0; i < COLORS.length; i++) if (!used.has(i)) return i;
  return state.friends.length;
}
function setStatus(id, msg, kind){
  const p = $(id);
  p.hidden = !msg; p.className = 'status' + (kind ? ' ' + kind : '');
  p.textContent = msg || '';
}

/* ================= 地點搜尋框 ================= */
const ICON = {
  pin:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/></svg>',
  x:'<svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>',
};
function makePicker(loc, onPick, opts = {}){
  const wrap = el('div','picker');
  const input = el('input');
  input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false;
  input.placeholder = opts.placeholder || '搜尋地址、店名、站名';
  input.value = loc ? loc.name : '';
  if (opts.id) input.id = opts.id;
  input.setAttribute('role','combobox'); input.setAttribute('aria-expanded','false');
  const btn = el('button','icon-btn', ICON.pin);
  btn.type = 'button'; btn.title = '在地圖上點選'; btn.setAttribute('aria-label','在地圖上點選位置');
  const list = el('ul','picker-list'); list.hidden = true; list.setAttribute('role','listbox');
  let cur = loc, items = [], active = 0, token = null, seq = 0, timer = 0;

  function draw(){
    list.innerHTML = items.map((it,i) => {
      if (it.kind === 'map') return `<li class="map-opt" role="option" data-i="${i}" aria-selected="${i === active}">在地圖上點選位置</li>`;
      if (it.kind === 'info') return `<li class="info${it.err ? ' err' : ''}">${esc(it.text)}</li>`;
      return `<li role="option" data-i="${i}" aria-selected="${i === active}"><span>${esc(it.main)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</li>`;
    }).join('');
    list.hidden = false; input.setAttribute('aria-expanded','true');
  }
  const selectable = () => items.map((it,i) => it.kind === 'info' ? -1 : i).filter(i => i >= 0);
  async function search(){
    const q = input.value.trim(), my = ++seq, out = [];
    const m = q.match(/^(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) {
      let a = +m[1], b = +m[2];
      if (Math.abs(a) > 90) [a,b] = [b,a];
      out.push({kind:'coord', main:`座標 ${a}, ${b}`, sub:'直接使用這個座標', loc:{placeId:'', name:`座標 ${a.toFixed(5)}, ${b.toFixed(5)}`, address:'', lat:a, lng:b}});
    } else if (q) {
      items = [{kind:'info', text:'搜尋中…'}, {kind:'map'}]; active = 1; draw();
      try {
        token = token || uuid();
        const res = await autocomplete(q, token);
        if (my !== seq) return;
        for (const p of res) out.push({kind:'ac', ...p});
        if (!res.length) out.push({kind:'info', text:'找不到符合的地點，換個說法試試。'});
      } catch (e) { if (my !== seq) return; out.push({kind:'info', err:true, text:e.message}); }
    }
    out.push({kind:'map'});
    items = out; active = selectable()[0] ?? 0; draw();
  }
  function close(){ list.hidden = true; input.setAttribute('aria-expanded','false'); }
  function set(l){ cur = l; input.value = l ? l.name : ''; onPick(l); }
  async function choose(i){
    const it = items[i];
    if (!it || it.kind === 'info') return;
    close();
    if (it.kind === 'map') { input.value = cur ? cur.name : ''; startPick(set); return; }
    if (it.kind === 'coord') { set(it.loc); return; }
    input.value = '讀取中…';
    try { const l = await placeDetails(it.placeId, token); token = null; set(l); }
    catch (e) { input.value = cur ? cur.name : ''; alertBox(e.message); }
  }
  input.addEventListener('focus', () => { input.select(); items = [{kind:'map'}]; active = 0; if (input.value && (!cur || input.value !== cur.name)) search(); else draw(); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  input.addEventListener('blur', () => setTimeout(() => { close(); if (cur && input.value !== '讀取中…') input.value = cur.name; }, 150));
  input.addEventListener('keydown', e => {
    const sel = selectable(), pos = sel.indexOf(active);
    if (e.key === 'ArrowDown') { active = sel[Math.min(sel.length - 1, pos + 1)] ?? active; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = sel[Math.max(0, pos - 1)] ?? active; draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); if (!list.hidden) { choose(active); input.blur(); } }
    else if (e.key === 'Escape') { close(); input.value = cur ? cur.name : ''; }
  });
  list.addEventListener('mousedown', e => e.preventDefault());
  list.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) { choose(+li.dataset.i); input.blur(); } });
  btn.addEventListener('click', () => startPick(set));
  wrap.append(input, btn, list);
  return wrap;
}
function alertBox(msg){
  const id = state.tab === 'trip' ? '#trip-status' : '#meet-status';
  setStatus(id, msg, 'err');
}

/* ================= Google 地圖 ================= */
let map = null, overlays = [], picking = null;
function loadMaps(){
  return new Promise((resolve, reject) => {
    window.__yqnInit = resolve;
    window.gm_authFailure = () => showSetup('Google 拒絕了這個金鑰。請確認金鑰正確、已啟用 Maps JavaScript API，且網站限制包含 ' + location.origin + '/*');
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&libraries=marker&language=zh-TW&region=TW&loading=async&callback=__yqnInit`;
    s.async = true;
    s.onerror = () => reject(new Error('無法載入 Google 地圖，請確認網路連線。'));
    document.head.append(s);
  });
}
function initMap(){
  const opts = {center:{lat:23.75, lng:120.95}, zoom:7, mapId:'DEMO_MAP_ID', gestureHandling:'greedy', mapTypeControl:false, streetViewControl:false, fullscreenControl:false, clickableIcons:true};
  if (google.maps.ColorScheme) opts.colorScheme = google.maps.ColorScheme.FOLLOW_SYSTEM;
  map = new google.maps.Map($('#map'), opts);
  map.addListener('click', async e => {
    if (!picking) return;
    const cb = picking;
    if (e.placeId) {
      e.stop();
      stopPick();
      try { cb(await placeDetails(e.placeId)); } catch (err) { alertBox(err.message); }
      return;
    }
    stopPick();
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    cb({placeId:'', name:`地圖選點 ${lat.toFixed(5)}, ${lng.toFixed(5)}`, address:'', lat, lng});
  });
  renderMap(true);
}
function startPick(cb){
  picking = cb;
  $('#pick-banner').hidden = false;
  if (map) map.setOptions({draggableCursor:'crosshair'});
  if (window.matchMedia('(max-width:860px)').matches) $('.mapwrap').scrollIntoView({behavior:'smooth', block:'start'});
}
function stopPick(){ picking = null; $('#pick-banner').hidden = true; if (map) map.setOptions({draggableCursor:null}); }
$('#pick-cancel').onclick = stopPick;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && picking) stopPick(); });

function clearOverlays(){ for (const o of overlays) { if (o.setMap) o.setMap(null); else o.map = null; } overlays = []; }
function marker(pos, cls, text, title, z, onClick, color){
  const div = el('div', 'mk ' + cls);
  div.textContent = text;
  if (color) div.style.setProperty('--c', color);
  const m = new google.maps.marker.AdvancedMarkerElement({map, position:{lat:pos.lat, lng:pos.lng}, content:div, zIndex:z, title});
  if (onClick) div.addEventListener('click', ev => { ev.stopPropagation(); onClick(); });
  overlays.push(m);
}
function line(path, color, weight = 4.5, opacity = .85){
  overlays.push(new google.maps.Polyline({map, path, strokeColor:color, strokeWeight:weight, strokeOpacity:opacity, zIndex:1}));
}
function renderMap(fit){
  if (!map) return;
  clearOverlays();
  const pts = [];
  if (state.tab === 'meet') {
    const fs = meet ? meet.fs : state.friends.filter(f => f.loc);
    if (meet) {
      const sel = meet.top[meet.selIdx], det = sel && meet.detail.get(sel.p.placeId || sel.key);
      if (det) for (const d of det) if (d.r && d.r.path.length) line(d.r.path, colorOf(d.f));
      meet.top.forEach((r,i) => {
        const isSel = i === meet.selIdx;
        marker(r.p, 'cand' + (isSel ? ' sel' : ''), String(i + 1), r.p.name, isSel ? 30 : 10 + (9 - i), () => selectResult(i));
        pts.push(r.p);
      });
    }
    for (const f of fs) { marker(f.loc, 'friend', (f.name || '?').slice(0,1), `${f.name}：${f.loc.name}`, 20, null, colorOf(f)); pts.push(f.loc); }
  } else {
    const T = state.trip;
    if (trip) {
      for (const lg of trip.legs) if (lg.r && lg.r.path.length) line(lg.r.path, '#0E7A68', 5, .8);
      trip.order.forEach((s,k) => { marker(s.loc, 'stop', String(k + 1), s.loc.name, 15); pts.push(s.loc); });
      if (trip.endLoc && trip.endLoc !== T.start) { marker(trip.endLoc, 'start', '終', '終點：' + trip.endLoc.name, 16); pts.push(trip.endLoc); }
    } else {
      for (const s of T.stops) if (s.loc) { marker(s.loc, 'stop', '・', s.loc.name, 15); pts.push(s.loc); }
    }
    if (T.start) { marker(T.start, 'start', '起', '出發：' + T.start.name, 16); pts.push(T.start); }
  }
  if (fit && pts.length) {
    if (pts.length === 1) { map.setCenter(pts[0]); map.setZoom(14); }
    else { const b = new google.maps.LatLngBounds(); pts.forEach(p => b.extend(p)); map.fitBounds(b, 60); }
  }
  renderLegend();
}
function renderLegend(){
  let h = '';
  if (state.tab === 'meet') {
    const fs = meet ? meet.fs : state.friends.filter(f => f.loc);
    h = fs.map(f => `<span class="sw"><i style="--c:${colorOf(f)}"></i>${esc(f.name || '朋友')}</span>`).join('');
    if (meet && meet.top.length) h += `<span class="sw"><i style="--c:#DD5419"></i>推薦地點</span>`;
  } else if (trip) {
    h = `<span class="sw"><i style="--c:#0E7A68"></i>數字是建議的造訪順序</span>`;
  }
  $('#legend').innerHTML = h;
}

/* ================= 找見面地點 ================= */
let meet = null, meetBusy = false;
function scoreOf(r){
  const o = state.opt.obj;
  if (o === 'sum') return r.sum;
  if (o === 'max') return r.max + r.sum * 0.001;
  return r.mean + r.std;
}
function rankRows(){
  const maxPer = state.opt.maxPer >= 300 ? Infinity : state.opt.maxPer;
  const rows = [];
  let tooFar = 0;
  for (const p of meet.cands) {
    const ts = meet.times.get(p.key);
    if (!ts || ts.some(t => !isFinite(t))) continue;
    const sum = ts.reduce((a,b) => a + b, 0), max = Math.max(...ts), min = Math.min(...ts), mean = sum / ts.length;
    const std = Math.sqrt(ts.reduce((a,b) => a + (b - mean) ** 2, 0) / ts.length);
    if (max > maxPer) { tooFar++; continue; }
    const r = {p, key:p.key, ts, sum, max, min, mean, std};
    r.score = scoreOf(r);
    rows.push(r);
  }
  rows.sort((a,b) => a.score - b.score || a.sum - b.sum);
  return {rows, tooFar};
}
async function evaluate(fs, cands, target, times){
  for (const c of cands) if (!times.has(c.key)) times.set(c.key, fs.map(() => Infinity));
  const groups = {};
  fs.forEach((f,i) => (groups[f.mode] = groups[f.mode] || []).push(i));
  await Promise.all(Object.entries(groups).map(async ([mode, idx]) => {
    const t = MODES[mode].api === 'TRANSIT' ? {arrive:target} : {depart:new Date(+target - 60 * 60000)};
    const {M} = await matrix(idx.map(i => fs[i].loc), cands, mode, t);
    idx.forEach((fi, gi) => cands.forEach((c, j) => {
      const e = M[gi][j];
      times.get(c.key)[fi] = e ? e.sec / 60 + MODES[mode].extra : Infinity;
    }));
  }));
}
async function searchAll(queries, center, radiusM, n){
  const res = await Promise.all(queries.map(q => searchText(q, center, radiusM, n)));
  const seen = new Map();
  for (const list of res) for (const p of list) { p.key = p.placeId; if (!seen.has(p.key)) seen.set(p.key, p); }
  return [...seen.values()];
}
async function runMeet(){
  if (meetBusy) return;
  const o = state.opt;
  const fs = state.friends.filter(f => f.loc).map(f => ({...f}));
  if (fs.length < 2) return setStatus('#meet-status', '至少要兩個人選好所在位置。', 'err');
  const queries = CATS.filter(c => o.cats[c.k]).map(c => c.q);
  if (o.keyword.trim()) queries.push(o.keyword.trim());
  if (!queries.length) return setStatus('#meet-status', '選一種地點類型，或輸入關鍵字。', 'err');
  const meetAt = at(o.date, o.time), target = new Date(+meetAt - o.buffer * 60000);
  const past = +target < Date.now();
  meetBusy = true; $('#run-meet').disabled = true;
  try {
    const cen = {lat:fs.reduce((s,f) => s + f.loc.lat, 0) / fs.length, lng:fs.reduce((s,f) => s + f.loc.lng, 0) / fs.length};
    const spread = Math.max(...fs.map(f => hav(cen, f.loc)));
    const r1 = clamp(spread * 500, 1200, 50000);
    const ok = p => !o.minRating || p.rating >= 4;
    setStatus('#meet-status', '在大家中間搜尋候選地點…', 'busy');
    let cands = (await searchAll(queries, cen, r1, 20)).filter(ok).sort((a,b) => hav(cen,a) - hav(cen,b)).slice(0, 24);
    if (!cands.length) throw new Error('大家中間找不到符合的地點，換個類型、關鍵字，或取消評分限制試試。');
    const times = new Map();
    setStatus('#meet-status', `用 Google 計算 ${fs.length} 人到 ${cands.length} 個地點的交通時間…`, 'busy');
    meet = {fs, cands, times, meetAt, target, detail:new Map(), selIdx:0, top:[]};
    await evaluate(fs, cands, target, times);
    const first = rankRows().rows[0];
    if (first) {
      setStatus('#meet-status', `在「${first.p.name}」附近再找一輪…`, 'busy');
      const more = (await searchAll(queries, first.p, clamp(r1 / 4, 600, 8000), 12)).filter(p => ok(p) && !times.has(p.key)).slice(0, 12);
      if (more.length) { await evaluate(fs, more, target, times); cands.push(...more); }
    }
    meet.selIdx = 0;
    rerank(true);
    setStatus('#meet-status', `比較了 ${cands.length} 個地點。` + (past ? '見面時間已經過了，大眾運輸用現在的班次計算。' : ''), past ? 'err' : 'ok');
    $('#run-meet').textContent = '重新找';
  } catch (e) {
    setStatus('#meet-status', e.message, 'err');
  } finally {
    meetBusy = false; $('#run-meet').disabled = false;
  }
}
function rerank(fit){
  if (!meet) return;
  const prev = meet.top[meet.selIdx]?.key;
  const {rows, tooFar} = rankRows();
  meet.rows = rows; meet.tooFar = tooFar;
  meet.top = rows.slice(0, state.opt.topN);
  meet.selIdx = Math.max(0, meet.top.findIndex(r => r.key === prev));
  renderResults();
  loadDetail();
  renderMap(fit);
}
function selectResult(i){
  if (!meet || !meet.top[i]) return;
  meet.selIdx = i;
  renderResults(); loadDetail(); renderMap(false);
}
function markStale(){
  if (meet) $('#res-hint').innerHTML = '<span class="stale">條件改了，按「重新找」更新</span>';
}

function renderResults(){
  const box = $('#results'), o = state.opt;
  $('#results-block').hidden = false;
  if (!meet.top.length) {
    box.innerHTML = `<li class="empty">${meet.tooFar ? `每個地點都有人要花超過 ${dur(o.maxPer)}，把「每人最多花」調高試試。` : '沒有地點能讓每個人都查到路線，換個類型或時間試試。'}</li>`;
    $('#res-hint').textContent = '';
    $('#detail').hidden = true;
    return;
  }
  $('#res-hint').textContent = `依實際交通時間排序`;
  const scale = Math.max(...meet.top.map(r => r.max), 20);
  box.innerHTML = meet.top.map((r,i) => {
    const big = o.obj === 'sum' ? r.sum : o.obj === 'max' ? r.max : r.mean;
    const cap = o.obj === 'sum' ? '總和' : o.obj === 'max' ? '最久' : '平均';
    const bars = meet.fs.map((f,j) => `<span class="who-n">${esc(f.name || '朋友')}</span><span class="track"><i style="width:${Math.max(2, r.ts[j] / scale * 100).toFixed(1)}%;--c:${colorOf(f)}"></i></span><span class="t">${durS(r.ts[j])}</span>`).join('');
    const rating = r.p.rating ? `<span class="star">★</span>${r.p.rating.toFixed(1)}（${r.p.ratings.toLocaleString()}）・` : '';
    return `<li class="res${i === meet.selIdx ? ' sel' : ''}" data-i="${i}" tabindex="0" role="button" aria-pressed="${i === meet.selIdx}">
      <div class="res-head"><span class="rank">${i + 1}</span><div class="res-name"><b>${esc(r.p.name)}</b><small>${rating}${esc(r.p.type || '')}${r.p.type ? '・' : ''}落差 ${dur(r.max - r.min)}</small><small>${esc(r.p.address)}</small></div>
      <div class="res-score"><b>${durS(big)}</b><small>${cap}</small></div></div>
      <div class="bars">${bars}</div></li>`;
  }).join('');
}
$('#results').addEventListener('click', e => { const li = e.target.closest('.res'); if (li) selectResult(+li.dataset.i); });
$('#results').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('res')) { e.preventDefault(); selectResult(+e.target.dataset.i); } });

function legsHtml(legs){
  return legs.map(l => `<li><span class="k ${l.kind}">${esc(l.label)}</span><span>${esc(l.note)}</span><span class="m">${l.time ? esc(l.time) : dur(l.min)}</span></li>`).join('');
}
async function loadDetail(){
  const r = meet && meet.top[meet.selIdx];
  const box = $('#detail');
  if (!r) { box.hidden = true; return; }
  box.hidden = false;
  if (meet.detail.has(r.key)) return renderDetail(r);
  box.innerHTML = `<p class="status busy">讀取「${esc(r.p.name)}」的詳細路線和班次…</p>`;
  const want = r.key;
  try {
    const det = await Promise.all(meet.fs.map(async (f,i) => {
      const M = MODES[f.mode], transit = M.api === 'TRANSIT';
      const t = transit ? {arrive:meet.target} : {depart:new Date(+meet.target - r.ts[i] * 60000)};
      let route = null, err = '';
      try { route = await routeOne(f.loc, r.p, f.mode, t); } catch (e) { err = e.message; }
      let depart, arrive;
      if (route && transit && route.firstDep) {
        depart = new Date(+route.firstDep - route.walkBefore * 1000);
        arrive = new Date(+(route.lastArr || meet.target) + route.walkAfter * 1000);
      } else {
        const min = route ? route.sec / 60 + M.extra : r.ts[i];
        depart = new Date(+meet.target - min * 60000);
        arrive = meet.target;
      }
      return {f, r:route, depart, arrive, err};
    }));
    meet.detail.set(want, det);
    if (meet.top[meet.selIdx]?.key === want) { renderDetail(r); renderMap(false); }
  } catch (e) {
    box.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
  }
}
function renderDetail(r){
  const det = meet.detail.get(r.key), box = $('#detail'), buf = state.opt.buffer;
  const first = det.reduce((a,b) => (+b.depart < +a.depart ? b : a));
  const items = det.map(d => {
    const M = MODES[d.f.mode];
    const legs = d.r ? legsHtml(d.r.legs) : `<li><span class="k walk">提醒</span><span>${esc(d.err || '查不到詳細路線')}</span><span></span></li>`;
    const extra = M.extra ? `<li><span class="k walk">${d.f.mode === 'taxi' ? '等車' : '停車'}</span><span>預留時間</span><span class="m">${M.extra} 分</span></li>` : '';
    const total = (+meet.target - +d.depart) / 60000;
    return `<li class="who"><span class="dot" style="--c:${colorOf(d.f)}">${esc((d.f.name || '?').slice(0,1))}</span>
      <div style="min-width:0"><div class="who-top"><b>${esc(d.f.name || '朋友')}</b><span class="muted">從 ${esc(d.f.loc.name)}・${M.label} ${dur(total)}</span></div>
      <ol class="legs">${legs}${extra}</ol>
      <a class="ext" href="${esc(gmapDir(d.f.loc, r.p, d.f.mode))}" target="_blank" rel="noopener">在 Google 地圖開啟路線 ↗</a></div>
      <div class="depart"><small>出發</small><b>${clockRel(d.depart, meet.meetAt)}</b>${M.api === 'TRANSIT' && d.r?.firstDep ? `<span class="arr">${hm(d.arrive)} 到</span>` : ''}</div></li>`;
  }).join('');
  const rating = r.p.rating ? `<span class="star">★</span> ${r.p.rating.toFixed(1)}（${r.p.ratings.toLocaleString()} 則評論）` : '';
  box.innerHTML = `
    <div class="detail-head"><div style="min-width:0"><span class="eyebrow">第 ${meet.selIdx + 1} 名</span><h3>${esc(r.p.name)}</h3>
      <span class="muted">${rating}${rating && r.p.type ? '・' : ''}${esc(r.p.type)}</span></div>
      <div class="meet-at"><span class="eyebrow">${esc(ymd(meet.meetAt).slice(5).replace('-', '/'))} 見面</span><b>${hm(meet.meetAt)}</b></div></div>
    <p class="hint">${esc(r.p.address)}${r.p.uri ? `　<a class="ext" href="${esc(r.p.uri)}" target="_blank" rel="noopener">Google 地圖上的這個地點 ↗</a>` : ''}</p>
    <div class="stats"><div><small>平均</small><b>${dur(r.mean)}</b></div><div><small>最久</small><b>${dur(r.max)}</b></div><div><small>落差</small><b>${dur(r.max - r.min)}</b></div><div><small>總和</small><b>${dur(r.sum)}</b></div></div>
    <p class="hint">${esc(first.f.name || '朋友')} 最早出門，${clockRel(first.depart, meet.meetAt)} 就要出發${buf ? `（已算進提早 ${buf} 分鐘到）` : ''}。大眾運輸的出發時間是配合實際班次算的。</p>
    <ul class="whos">${items}</ul>
    <div class="row-actions"><button class="btn primary" type="button" id="to-trip">見面後去哪？從這裡排行程</button></div>`;
  $('#to-trip').onclick = () => {
    const T = state.trip;
    T.start = {...r.p}; T.date = state.opt.date;
    const after = new Date(+meet.meetAt + 90 * 60000);
    T.time = hm(after);
    save(); renderTripForm(); setTab('trip');
  };
}

/* ================= 行程規劃 ================= */
let trip = null, tripBusy = false;
function permutations(arr, fn){
  const a = arr.slice(), c = new Array(a.length).fill(0);
  fn(a);
  let i = 0;
  while (i < a.length) {
    if (c[i] < i) { const j = i % 2 ? c[i] : 0; [a[j],a[i]] = [a[i],a[j]]; fn(a); c[i]++; i = 0; }
    else { c[i] = 0; i++; }
  }
}
async function runTrip(){
  if (tripBusy) return;
  const T = state.trip;
  const stops = T.stops.filter(s => s.loc);
  if (!T.start) return setStatus('#trip-status', '先選出發地。', 'err');
  if (!stops.length) return setStatus('#trip-status', '至少加入一個要去的地方。', 'err');
  if (T.end === 'fixed' && !T.endLoc) return setStatus('#trip-status', '選一個終點，或把「結束在」改成其他選項。', 'err');
  const t0 = at(T.date, T.time);
  const pts = [T.start, ...stops.map(s => s.loc)];
  let endIdx = -1;
  if (T.end === 'loop') endIdx = 0;
  else if (T.end === 'fixed') { pts.push(T.endLoc); endIdx = pts.length - 1; }
  tripBusy = true; $('#run-trip').disabled = true;
  try {
    setStatus('#trip-status', `用 Google 計算 ${pts.length} 個地點之間的交通時間…`, 'busy');
    const {M} = await matrix(pts, pts, T.mode, {depart:t0});
    const extra = MODES[T.mode].extra;
    const D = M.map((row,i) => row.map((e,j) => i === j ? 0 : e ? e.sec / 60 + extra : Infinity));
    const rel = s => s ? (+at(T.date, s) - +t0) / 60000 : null;
    const win = stops.map(s => ({e:rel(s.earliest), l:rel(s.latest)}));
    function evalOrder(order){
      let t = 0, prev = 0, travelSum = 0, late = 0, wait = 0;
      for (const idx of order) {
        const tt = D[prev][idx]; t += tt; travelSum += tt;
        const w = win[idx - 1];
        if (w.e != null && t < w.e) { wait += w.e - t; t = w.e; }
        if (w.l != null && t > w.l) late += t - w.l;
        t += stops[idx - 1].stay; prev = idx;
      }
      if (endIdx >= 0) { const tt = D[prev][endIdx]; t += tt; travelSum += tt; }
      return {order:order.slice(), cost:late * 1000 + t + travelSum * 0.01, end:t, travelSum, late, wait};
    }
    const idxs = stops.map((_,i) => i + 1);
    const given = evalOrder(idxs);
    let best = given;
    if (idxs.length <= 8) permutations(idxs, a => { const r = evalOrder(a); if (r.cost < best.cost) best = r; });
    else {
      const left = new Set(idxs), ord = [];
      let cur = 0;
      while (left.size) { let bj = null; for (const j of left) if (bj == null || D[cur][j] < D[cur][bj]) bj = j; ord.push(bj); left.delete(bj); cur = bj; }
      best = evalOrder(ord);
      for (let improved = true; improved;) {
        improved = false;
        for (let i = 0; i < ord.length - 1; i++) for (let k = i + 1; k < ord.length; k++) {
          const r = evalOrder(best.order.slice(0, i).concat(best.order.slice(i, k + 1).reverse(), best.order.slice(k + 1)));
          if (r.cost < best.cost - 1e-6) { best = r; improved = true; }
        }
      }
      if (given.cost < best.cost) best = given;
    }
    if (!isFinite(best.end)) throw new Error('有些地點之間 Google 查不到路線（例如大眾運輸沒有班次），換個交通方式或時間試試。');

    // 依建議順序，逐段用實際出發時間查詳細路線，排出時間表
    setStatus('#trip-status', '依建議順序查詢每一段的實際路線…', 'busy');
    let now = new Date(t0), prev = pts[0];
    const legs = [], order = [];
    const seqPts = best.order.map(i => ({loc:pts[i], stop:stops[i - 1], idx:i}));
    if (endIdx >= 0) seqPts.push({loc:pts[endIdx], end:true, idx:endIdx});
    let prevIdx = 0;
    for (const sp of seqPts) {
      let r = null;
      try { r = await routeOne(prev, sp.loc, T.mode, {depart:now}); } catch (e) {}
      let arrive;
      if (r && MODES[T.mode].api === 'TRANSIT' && r.lastArr) arrive = new Date(+r.lastArr + r.walkAfter * 1000);
      else arrive = new Date(+now + (r ? r.sec / 60 + extra : D[prevIdx][sp.idx]) * 60000);
      legs.push({from:prev, to:sp.loc, r, depart:now, arrive});
      if (sp.end) { now = arrive; break; }
      const s = sp.stop, e = s.earliest ? at(T.date, s.earliest) : null, l = s.latest ? at(T.date, s.latest) : null;
      const start = e && arrive < e ? e : arrive;
      const leave = new Date(+start + s.stay * 60000);
      order.push({loc:sp.loc, stop:s, arrive, start, leave, lateBy:l && arrive > l ? (arrive - l) / 60000 : 0});
      now = leave; prev = sp.loc; prevIdx = sp.idx;
    }
    trip = {t0, order, legs, end:now, endLoc:endIdx >= 0 ? pts[endIdx] : null, endIsStart:endIdx === 0, best, given, n:idxs.length};
    setStatus('#trip-status', '', '');
    renderTripResult();
    renderMap(true);
  } catch (e) {
    setStatus('#trip-status', e.message, 'err');
  } finally {
    tripBusy = false; $('#run-trip').disabled = false;
  }
}
function renderTripResult(){
  const T = state.trip, box = $('#trip-result');
  $('#trip-block').hidden = !trip;
  if (!trip) return;
  const fact = n => n <= 1 ? 1 : n * fact(n - 1);
  $('#trip-hint').textContent = trip.n <= 8 ? `比較了 ${fact(trip.n)} 種順序` : '用最近鄰居＋2-opt 搜尋';
  const saved = trip.given.end - trip.best.end;
  let h = '';
  if (trip.n > 1) h += saved > 0.5 ? `<div class="note">照你輸入的順序大約要多花 <b>${dur(saved)}</b>，已幫你調整順序。</div>` : `<div class="note">你輸入的順序已經是最順的走法。</div>`;
  const late = trip.order.filter(o => o.lateBy > 0.5);
  if (late.length) h += `<div class="note bad">${late.map(o => esc(o.loc.name)).join('、')} 趕不上最晚抵達時間。試著提早出發或縮短停留。</div>`;
  const travel = trip.legs.reduce((a,l) => a + (l.arrive - l.depart) / 60000, 0);
  const stay = trip.order.reduce((a,o) => a + o.stop.stay, 0);
  const wait = trip.order.reduce((a,o) => a + (o.start - o.arrive) / 60000, 0);
  h += `<div class="stats"><div><small>交通</small><b>${dur(travel)}</b></div><div><small>停留</small><b>${dur(stay)}</b></div><div><small>等待</small><b>${dur(wait)}</b></div><div><small>結束</small><b>${clockRel(trip.end, trip.t0)}</b></div></div>`;
  h += '<ol class="timeline">';
  h += `<li class="tl-node start"><time>${hm(trip.t0)}</time><div><b>出發</b>　${esc(T.start.name)}</div></li>`;
  trip.legs.forEach((lg, k) => {
    const legs = lg.r ? legsHtml(lg.r.legs) : '<li><span class="k walk">估算</span><span>查不到詳細路線</span><span></span></li>';
    h += `<li class="tl-leg"><ol class="legs">${legs}</ol><span class="num">共 ${dur((lg.arrive - lg.depart) / 60000)}</span>　<a class="ext" href="${esc(gmapDir(lg.from, lg.to, T.mode))}" target="_blank" rel="noopener">路線 ↗</a></li>`;
    const o = trip.order[k];
    if (o) {
      const ex = [];
      if (o.start - o.arrive > 30000) ex.push(`${hm(o.arrive)} 到，等到 ${hm(o.start)}`);
      ex.push(`停留 ${dur(o.stop.stay)}・${clockRel(o.leave, trip.t0)} 離開`);
      if (o.lateBy > 0.5) ex.push(`<span class="late">比最晚抵達晚 ${dur(o.lateBy)}</span>`);
      h += `<li class="tl-node"><time>${hm(o.arrive)}</time><div><b>${k + 1}. ${esc(o.loc.name)}</b><small>${ex.join('・')}</small></div></li>`;
    } else {
      h += `<li class="tl-node end"><time>${hm(lg.arrive)}</time><div><b>${trip.endIsStart ? '回到' : '抵達終點'}</b>　${esc(lg.to.name)}</div></li>`;
    }
  });
  if (!trip.endLoc) {
    const last = trip.order[trip.order.length - 1];
    h += `<li class="tl-node end"><time>${hm(trip.end)}</time><div><b>行程結束</b>　${esc(last.loc.name)}</div></li>`;
  }
  h += '</ol>';
  if (MODES[T.mode].api !== 'TRANSIT') {
    const seq = trip.order.map(o => o.loc);
    const dest = trip.endLoc || seq[seq.length - 1];
    const wps = trip.endLoc ? seq : seq.slice(0, -1);
    if (wps.length <= 9) h += `<div class="row-actions" style="margin-top:10px"><a class="btn primary" href="${esc(gmapDir(T.start, dest, T.mode, wps))}" target="_blank" rel="noopener">在 Google 地圖開啟整條路線 ↗</a></div>`;
  } else {
    h += '<p class="hint" style="margin-top:8px">Google 地圖的大眾運輸不支援多個停靠點，請用每一段旁邊的「路線」連結。</p>';
  }
  box.innerHTML = h;
}

/* ================= 表單 ================= */
function modeSelect(value, id){
  const s = el('select');
  s.id = id;
  s.innerHTML = MODE_ORDER.map(m => `<option value="${m}"${m === value ? ' selected' : ''}>${MODES[m].label}</option>`).join('');
  return s;
}
function renderFriends(){
  const box = $('#friends'); box.innerHTML = '';
  state.friends.forEach((f,i) => {
    const row = el('div','friend');
    const dot = el('span','dot'); dot.style.setProperty('--c', colorOf(f)); dot.textContent = (f.name || '?').slice(0,1);
    const name = el('input'); name.type = 'text'; name.value = f.name; name.id = 'fname-' + f.id; name.maxLength = 12;
    name.placeholder = '名字'; name.setAttribute('aria-label','名字');
    name.addEventListener('input', () => { f.name = name.value; dot.textContent = (f.name || '?').slice(0,1); save(); renderLegend(); });
    const mode = modeSelect(f.mode, 'fmode-' + f.id); mode.setAttribute('aria-label','交通方式');
    mode.addEventListener('change', () => { f.mode = mode.value; save(); markStale(); });
    const del = el('button','icon-btn plain', ICON.x); del.type = 'button'; del.title = '移除'; del.setAttribute('aria-label','移除這位朋友');
    del.disabled = state.friends.length <= 1;
    del.onclick = () => { state.friends.splice(i,1); renderFriends(); save(); markStale(); if (!meet) renderMap(true); };
    const addr = el('div','addr'); addr.textContent = f.loc?.address || '';
    const pk = makePicker(f.loc, l => { f.loc = l; addr.textContent = l?.address || ''; save(); markStale(); if (!meet) renderMap(true); }, {id:'floc-' + f.id});
    row.append(dot, name, mode, del, pk, addr);
    box.append(row);
  });
  $('#friend-count').textContent = `${state.friends.filter(f => f.loc).length} 人已選位置`;
  $('#add-friend').disabled = state.friends.length >= 12;
}
$('#add-friend').onclick = () => {
  const f = {id:uid++, c:nextColor(), name:'朋友' + (state.friends.length + 1), loc:null, mode:'transit'};
  state.friends.push(f); renderFriends(); save();
  document.getElementById('floc-' + f.id)?.focus();
};
function renderOpts(){
  const o = state.opt;
  $('#cats').innerHTML = CATS.map(c => `<button type="button" class="chip" data-k="${c.k}" aria-pressed="${!!o.cats[c.k]}">${c.label}</button>`).join('');
  $('#keyword').value = o.keyword;
  $('#min-rating').checked = !!o.minRating;
  $('#meet-date').value = o.date; $('#meet-time').value = o.time; $('#buffer').value = String(o.buffer);
  document.querySelectorAll('#obj button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === o.obj));
  $('#obj-hint').textContent = OBJ_HINT[o.obj];
  $('#max-per').value = o.maxPer; $('#max-per-v').textContent = o.maxPer >= 300 ? '不限' : dur(o.maxPer);
  $('#topn').value = String(o.topN);
}
$('#cats').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; state.opt.cats[b.dataset.k] = !state.opt.cats[b.dataset.k]; renderOpts(); save(); markStale(); });
$('#keyword').addEventListener('input', e => { state.opt.keyword = e.target.value; save(); markStale(); });
$('#min-rating').addEventListener('change', e => { state.opt.minRating = e.target.checked; save(); markStale(); });
$('#meet-date').addEventListener('change', e => { state.opt.date = e.target.value || tomorrow(); save(); markStale(); });
$('#meet-time').addEventListener('change', e => { state.opt.time = e.target.value || '12:00'; save(); markStale(); });
$('#buffer').addEventListener('change', e => { state.opt.buffer = +e.target.value; save(); markStale(); });
$('#obj').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.opt.obj = b.dataset.v; renderOpts(); save(); rerank(false); });
$('#max-per').addEventListener('input', e => { state.opt.maxPer = +e.target.value; renderOpts(); save(); rerank(false); });
$('#topn').addEventListener('change', e => { state.opt.topN = +e.target.value; save(); rerank(false); });
$('#run-meet').onclick = runMeet;

function renderTripForm(){
  const T = state.trip;
  $('#trip-start').innerHTML = '';
  $('#trip-start').append(makePicker(T.start, l => { T.start = l; save(); renderMap(true); }, {id:'trip-start-in'}));
  $('#trip-date').value = T.date; $('#trip-time').value = T.time;
  $('#trip-mode').innerHTML = MODE_ORDER.map(m => `<option value="${m}"${m === T.mode ? ' selected' : ''}>${MODES[m].label}</option>`).join('');
  $('#trip-end').value = T.end;
  $('#trip-endloc-wrap').hidden = T.end !== 'fixed';
  $('#trip-endloc').innerHTML = '';
  $('#trip-endloc').append(makePicker(T.endLoc, l => { T.endLoc = l; save(); }, {id:'trip-endloc-in'}));
  renderStops();
}
function renderStops(){
  const box = $('#stops'); box.innerHTML = '';
  state.trip.stops.forEach((s,i) => {
    const row = el('div','stop');
    const del = el('button','icon-btn plain', ICON.x); del.type = 'button'; del.title = '移除'; del.setAttribute('aria-label','移除這個地點');
    del.onclick = () => { state.trip.stops.splice(i,1); renderStops(); save(); };
    const pk = makePicker(s.loc, l => { s.loc = l; save(); if (!trip) renderMap(true); }, {id:'stop-' + s.id});
    const sub = el('div','sub');
    sub.innerHTML = `<div><label for="stay-${s.id}">停留（分）</label><input type="number" id="stay-${s.id}" min="0" max="720" step="15" value="${s.stay}"></div>
      <div><label for="ea-${s.id}">最早</label><input type="time" id="ea-${s.id}" value="${esc(s.earliest)}"></div>
      <div><label for="la-${s.id}">最晚抵達</label><input type="time" id="la-${s.id}" value="${esc(s.latest)}"></div>`;
    sub.querySelector('#stay-' + s.id).addEventListener('input', e => { s.stay = Math.max(0, +e.target.value || 0); save(); });
    sub.querySelector('#ea-' + s.id).addEventListener('change', e => { s.earliest = e.target.value; save(); });
    sub.querySelector('#la-' + s.id).addEventListener('change', e => { s.latest = e.target.value; save(); });
    row.append(el('span','stop-n', String(i + 1)), pk, del, el('span'), sub);
    box.append(row);
  });
  $('#add-stop').disabled = state.trip.stops.length >= 12;
}
$('#trip-date').addEventListener('change', e => { state.trip.date = e.target.value || tomorrow(); save(); });
$('#trip-time').addEventListener('change', e => { state.trip.time = e.target.value || '10:00'; save(); });
$('#trip-mode').addEventListener('change', e => { state.trip.mode = e.target.value; save(); });
$('#trip-end').addEventListener('change', e => { state.trip.end = e.target.value; $('#trip-endloc-wrap').hidden = state.trip.end !== 'fixed'; save(); });
$('#add-stop').onclick = () => {
  const s = {id:uid++, loc:null, stay:60, earliest:'', latest:''};
  state.trip.stops.push(s); renderStops(); save();
  document.getElementById('stop-' + s.id)?.focus();
};
$('#run-trip').onclick = runTrip;

function setTab(t){
  state.tab = t; save();
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $('#pane-meet').hidden = t !== 'meet';
  $('#pane-trip').hidden = t !== 'trip';
  stopPick();
  renderMap(true);
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b && b.dataset.tab !== state.tab) setTab(b.dataset.tab); });

/* ================= 金鑰 ================= */
function showSetup(err){
  $('#setup').hidden = false;
  $('#key-err').hidden = !err; $('#key-err').textContent = err || '';
  $('#key-input').value = KEY;
  $('#key-cancel').hidden = !KEY || !!err;
}
$('#key-btn').onclick = () => showSetup();
$('#key-cancel').onclick = () => { $('#setup').hidden = true; };
$('#key-form').addEventListener('submit', e => {
  e.preventDefault();
  const k = $('#key-input').value.trim();
  if (!k) { $('#key-err').hidden = false; $('#key-err').textContent = '請貼上金鑰。'; return; }
  const changed = k !== KEY;
  KEY = k; ls.set(KEY_STORE, k);
  if (changed && window.google?.maps) { location.reload(); return; }
  $('#setup').hidden = true;
  if (!map) loadMaps().then(initMap).catch(err => showSetup(err.message));
});

/* ================= 啟動 ================= */
if (location.protocol === 'file:') {
  setStatus('#meet-status', '請用 start.bat 開啟（網址要是 http://localhost:8080），直接開檔案 Google 會拒絕金鑰。', 'err');
}
renderFriends(); renderOpts(); renderTripForm(); setTab(state.tab);
if (KEY) loadMaps().then(initMap).catch(err => showSetup(err.message));
else showSetup();
})();
