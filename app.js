const SB_URL = "https://zxhnxblflouukxagwmbb.supabase.co";
const SB_KEY = "sb_publishable_WxNJKw54UB5cQkgr-Mq1XA_vxWGNiAL";
const BUCKET = "clipmarket";
const sb = window.supabase ? window.supabase.createClient(SB_URL, SB_KEY) : null;

// Perfiles ficticios con video generado con IA. Se muestran solo mientras hay pocas muestras reales.
const examples = [
  {id:"ex-serum", example:true, video:"clip-1.mp4", title:"Rutina en 30 segundos", creator:"Sofi Vega", category:"Belleza", city:"Palermo, Ciudad Autónoma de Buenos Aires", price_from:45000, image:"clip-1.webp", description:"Presentación de un sérum con luz natural y aplicación en cámara.", created_at:"2026-11-10"},
  {id:"ex-matcha", example:true, video:"clip-2.mp4", title:"Matcha para llevar", creator:"Nico Paz", category:"Gastronomía", city:"Córdoba, Córdoba", price_from:30000, image:"clip-2.webp", description:"Preparación y primera impresión de un matcha frío.", created_at:"2026-11-10"},
  {id:"ex-sneaker", example:true, video:"clip-3.mp4", title:"Zapatillas en movimiento", creator:"Juli Ríos", category:"Moda", city:"Rosario, Santa Fe", price_from:60000, image:"clip-3.webp", description:"Detalles, ajuste y una toma caminando en exteriores.", created_at:"2026-11-10"},
];
const categories = ["Belleza","Gastronomía","Moda","Tecnología","Mascotas","Hogar","Deportes","Otro"];
const provinces = [
  "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba",
  "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones",
  "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe",
  "Santiago del Estero", "Tierra del Fuego", "Tucumán"
];
const videoTypes = ["Cómo se usa","Unboxing","Testimonio","Reseña","Anuncio"];
const durations = ["15 segundos","30 segundos","60 segundos"];
const stages = ["Enviado","En producción","Entregado","Aprobado"];
const EXT = {"video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov"};
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

const $ = s => document.querySelector(s);
const grid = $("#grid"), dialog = $("dialog"), panel = $("#panel");
const fCategory = $("#category"), fSearch = $("#search"), fPrice = $("#price"), fSort = $("#sort"), fProvince = $("#province");
let clips = [], user = null, pending = null, loading = true, loadError = false;
let portfolioClips = [], stats = new Map(), ratings = new Map();

const esc = s => String(s ?? "").replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[x]);
const money = n => "$ " + Number(n).toLocaleString("es-AR");
const pub = path => `${SB_URL}/storage/v1/object/public/${BUCKET}/${path}`;
const myName = () => user?.user_metadata?.name || user?.email?.split("@")[0] || "";
const find = id => [...clips, ...portfolioClips, ...examples].find(x => x.id === id);
const creatorKey = clip => clip.example ? clip.id : clip.user_id;
const profileHref = key => "#creador=" + encodeURIComponent(key);
const normalize = value => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
const provinceNames = new Map(provinces.map(name => [normalize(name), name]));
provinceNames.set("caba", "Ciudad Autónoma de Buenos Aires");
provinceNames.set("capital federal", "Ciudad Autónoma de Buenos Aires");
provinceNames.set("rosario", "Santa Fe");
const provinceOptions = provinces.map(name => `<option>${name}</option>`).join("");
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

// Earlier uploads saved a single free-text location.
function clipProvince(clip) {
  const parts = normalize(clip.city).split(",").map(part => part.trim());
  if (parts.at(-1) === "argentina") parts.pop();
  return provinceNames.get(parts.at(-1));
}
const place = x => {
  const short = v => v === "Ciudad Autónoma de Buenos Aires" ? "CABA" : v;
  const town = x.city ? x.city.split(",")[0].trim() : "", prov = clipProvince(x);
  return [short(town), short(prov)].filter((v, i, a) => v && a.indexOf(v) === i).join(", ");
};

/* ---------- Estrellas ---------- */
let deliveries = new Map();
async function loadDeliveries() {
  if (!sb) return;
  const { data } = await sb.rpc("cm_creator_deliveries");
  deliveries = new Map((data || []).map(d => [d.creator_id, Number(d.delivered)]));
}
function verifiedHtml(key) {
  const n = deliveries.get(key);
  return n ? `<span class="verified" title="Completó ${n} ${n === 1 ? "encargo aprobado" : "encargos aprobados"}">✓ Verificado</span>` : "";
}
function starsHtml(key) {
  return verifiedHtml(key) + starsOnly(key);
}
function starsOnly(key) {
  const r = ratings.get(key);
  if (!r) return '<span class="stars new"><i>✦</i> Nuevo</span>';
  return `<span class="stars" aria-label="${r.avg.toFixed(1)} de 5 estrellas, ${r.count} ${r.count === 1 ? "reseña" : "reseñas"}"><i>★</i> ${r.avg.toFixed(1).replace(".", ",")} <em>· ${r.count} ${r.count === 1 ? "reseña" : "reseñas"}</em></span>`;
}
async function loadRatings() {
  if (!sb) return;
  const { data } = await sb.from("cm_reviews").select("creator_id, stars");
  const acc = new Map();
  (data || []).forEach(r => { const a = acc.get(r.creator_id) || { sum:0, count:0 }; a.sum += r.stars; a.count++; acc.set(r.creator_id, a); });
  ratings = new Map([...acc].map(([k, a]) => [k, { avg:a.sum / a.count, count:a.count }]));
}

/* ---------- Algoritmo Para vos ----------
   Nunca usa seguidores. Mezcla: cuánto se mira completo y cuántos ♥ recibe el video (con todos los usuarios),
   las estrellas que dejan las marcas, un empujón para lo nuevo y el gusto de quien está mirando. */
const taste = store.get("cm-taste", {});
const seen = new Set(store.get("cm-seen", []));
const seed = Math.random();
function jitter(id) { let h = 0; for (const c of id + seed) h = (h * 31 + c.charCodeAt(0)) | 0; return ((h >>> 0) % 1000) / 1000; }
function score(x) {
  const s = stats.get(x.id) || { views:0, completes:0, likes:0, passes:0 };
  const watch = (s.completes + 1) / (s.views + 2);
  const love = (s.likes + 1) / (s.likes + s.passes + 2);
  const r = ratings.get(creatorKey(x));
  const starBoost = r ? ((r.avg - 3) / 2) * Math.min(r.count, 5) / 5 : 0;
  const age = Math.max(0, (Date.now() - new Date(x.created_at || Date.now())) / 864e5);
  const fresh = Math.exp(-age / 7);
  const maxTaste = Math.max(1, ...Object.values(taste));
  const mine = (taste[x.category] || 0) / maxTaste;
  return watch * .35 + love * .35 + starBoost * .3 + fresh * .35 + mine * .3 + jitter(x.id) * .15;
}
function learn(cat, amount) {
  if (!cat) return;
  taste[cat] = Math.max(-5, Math.min(30, (taste[cat] || 0) + amount));
  store.set("cm-taste", taste);
}
function track(id, kind) { if (sb && UUID.test(id)) sb.from("cm_events").insert({ clip_id:id, kind }).then(() => {}, () => {}); }
async function loadStats() {
  if (!sb) return;
  const { data } = await sb.rpc("cm_stats");
  stats = new Map((data || []).map(s => [s.clip_id, s]));
}

/* ---------- Vidriera ---------- */
const pool = () => clips.length >= 6 ? clips : [...clips, ...examples];
function shown() {
  const q = normalize(fSearch.value), cat = fCategory.value, max = Number(fPrice.value);
  const list = pool().filter(x => (!cat || x.category === cat)
    && (!fProvince.value || clipProvince(x) === fProvince.value)
    && (!max || (x.price_from && x.price_from <= max))
    && normalize([x.title, x.creator, x.category, x.description, x.city].join(" ")).includes(q));
  if (fSort.value === "cheap") list.sort((a, b) => (a.price_from || Infinity) - (b.price_from || Infinity));
  else if (fSort.value === "new") list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (fSort.value === "top") {
    const r = x => { const v = ratings.get(creatorKey(x)); return v ? v.avg * Math.min(v.count, 5) / 5 : 0; };
    list.sort((a, b) => r(b) - r(a) || score(b) - score(a));
  }
  else if (fSort.value === "views") list.sort((a, b) => (stats.get(b.id)?.views || 0) - (stats.get(a.id)?.views || 0) || score(b) - score(a));
  else list.sort((a, b) => score(b) - score(a));
  return list;
}
function media(x, big) {
  if (!x.video_path && !x.video) return `<img src="${esc(x.image)}" alt="" ${big ? "" : 'loading="lazy"'}>`;
  const thumb = x.video ? x.image : x.thumb_path && pub(x.thumb_path);
  const poster = thumb ? ` poster="${esc(thumb)}"` : "";
  const src = esc(x.video || pub(x.video_path)) + (thumb || big ? "" : "#t=0.1");
  return big ? `<video src="${src}"${poster} controls autoplay playsinline></video>`
    : `<video src="${src}"${poster} muted loop playsinline preload="${thumb ? "none" : "metadata"}"></video>`;
}
function card(x, i = 0) {
  return `<article class="clip-card" style="--i:${Math.min(i, 8)}"><button class="clip" data-clip="${esc(x.id)}" aria-label="${esc(x.title)}, de ${esc(x.creator)}">
    <span class="shot">${media(x)}${x.example ? '<span class="pill ex">Ejemplo</span>' : ""}<span class="playdot" aria-hidden="true">▶</span>
      <span class="who"><b>${esc(x.creator)}</b>${starsHtml(creatorKey(x))}<small>${esc([x.category, place(x)].filter(Boolean).join(" · "))}</small></span></span>
    <span class="line1"><span class="t">${esc(x.title)}</span>${x.price_from ? `<span class="p">${money(x.price_from)}</span>` : ""}</span></button></article>`;
}
const ICON = {
  top:'<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9Z"/>',
  views:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  cheap:'<path d="M12 3v18"/><path d="M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.8 0-4.5 1.4-4.5 3.2 0 4.3 9 2.3 9 6.6 0 1.9-1.8 3.2-4.5 3.2-2.2 0-3.9-.8-4.8-2.2"/>',
  all:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  "Belleza":'<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z"/>',
  "Gastronomía":'<path d="M5 9h11v4a5.5 5.5 0 0 1-11 0Z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3v3M12 3v3"/>',
  "Moda":'<path d="M9 4 4.5 6.5 6 10l2-.8V20h8V9.2l2 .8 1.5-3.5L15 4a3 3 0 0 1-6 0Z"/>',
  "Tecnología":'<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
  "Mascotas":'<circle cx="7" cy="10" r="1.8"/><circle cx="17" cy="10" r="1.8"/><circle cx="10" cy="6" r="1.8"/><circle cx="14" cy="6" r="1.8"/><path d="M8 17c0-2.6 1.8-4.5 4-4.5s4 1.9 4 4.5c0 1.6-1.6 2.5-4 2.5s-4-.9-4-2.5Z"/>',
  "Hogar":'<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  "Deportes":'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5S9.5 5.8 12 3.5Z"/>',
  "Otro":'<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>'
};
const icon = k => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ""}</svg>`;
const shortcuts = [
  { chip:"sort:top", label:"Mejor calificados", icon:"top", on:() => fSort.value === "top" },
  { chip:"sort:views", label:"Más vistos", icon:"views", on:() => fSort.value === "views" },
  { chip:"price:30000", label:"Hasta $ 30.000", icon:"cheap", on:() => fPrice.value === "30000" },
  { chip:"cat:", label:"Todos", icon:"all", on:() => !fCategory.value },
  ...categories.map(c => ({ chip:"cat:" + c, label:c, icon:c, on:() => fCategory.value === c }))
];
function renderCats() {
  $("#cats").innerHTML = shortcuts.map(x =>
    `<button type="button" data-chip="${esc(x.chip)}" aria-pressed="${x.on()}">${icon(x.icon)}${esc(x.label)}</button>`).join("");
}
function chip(value) {
  const [kind, v] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
  if (kind === "sort") fSort.value = fSort.value === v ? "foryou" : v;
  else if (kind === "price") fPrice.value = fPrice.value === v ? "" : v;
  else fCategory.value = v;
  render();
}
function renderRail(list) {
  const tile = `<button type="button" class="feed-tile" data-feed>
    <svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><path d="M12 20.5s-7.5-4.4-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.8-7.5 10.2-7.5 10.2Z" fill="#fff"/></svg>
    <b>Deslizá creadores</b><span>Como Tinder, pero de UGC.</span><em>Empezar</em></button>`;
  $("#rail").innerHTML = tile + list.slice(0, 10).map((x, i) => card(x, i + 1)).join("");
}
const touch = matchMedia("(hover: none)").matches;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
// En celular no hay hover: cada video arranca solo (sin sonido) cuando queda visible.
const io = "IntersectionObserver" in window ? new IntersectionObserver(entries => entries.forEach(e => {
  const clip = e.target.closest(".clip");
  if (e.isIntersecting && e.intersectionRatio >= .6) e.target.play().then(() => clip?.classList.add("playing")).catch(() => {});
  else { e.target.pause(); clip?.classList.remove("playing"); }
}), { threshold:[0, .6] }) : null;
function watchVideos() {
  if (!io || calm) return;
  io.disconnect();
  document.querySelectorAll(".grid video, .rail video").forEach(v => io.observe(v));
}
function render() {
  const filtered = fCategory.value || fSearch.value.trim() || fPrice.value || fProvince.value;
  $("#clear").hidden = !filtered;
  renderCats();
  if (loading) {
    grid.innerHTML = Array(4).fill('<div class="clip skel"><span class="shot"></span></div>').join("");
    return;
  }
  const list = shown();
  $("#gridtitle").textContent = filtered ? `${list.length} ${list.length === 1 ? "video" : "videos"}`
    : ({ foryou:"Todos los videos", top:"Mejor calificados", views:"Más vistos", new:"Más nuevos", cheap:"Menor precio" })[fSort.value];
  renderRail(list);
  grid.innerHTML = list.map((x, i) => card(x, i)).join("") || `<div class="empty"><h3>No hay videos con esa búsqueda</h3>
    <button class="outline" id="clear2">Ver todos</button></div>`;
  if (loadError && !filtered) grid.insertAdjacentHTML("beforeend", '<div class="empty"><p>No pudimos cargar los videos nuevos. Recargá la página.</p></div>');
  watchVideos();
}
async function loadClips() {
  if (!sb) { loading = false; loadError = true; return render(); }
  const [res] = await Promise.all([
    sb.from("cm_clips").select("*").order("created_at", { ascending:false }).limit(200),
    loadStats().catch(() => {}), loadRatings().catch(() => {}), loadDeliveries().catch(() => {})
  ]);
  loading = false; loadError = !!res.error; clips = res.data || [];
  liveStats();
  render();
}

function liveStats() {
  const el = $("#livestats");
  if (!clips.length) { el.hidden = true; return; }
  const creators = new Set(clips.map(c => c.user_id)).size;
  const week = clips.filter(c => Date.now() - new Date(c.created_at) < 7 * 864e5).length;
  el.querySelector("span").innerHTML = `<b>${clips.length}</b> ${clips.length === 1 ? "video" : "videos"} de <b>${creators}</b> ${creators === 1 ? "creador" : "creadores"}`
    + (week ? ` · <b>${week}</b> ${week === 1 ? "nuevo" : "nuevos"} esta semana` : "");
  el.hidden = false;
}

/* ---------- Pila tipo Tinder ---------- */
const feed = $("#feed"), deck = $("#deck"), toast = $("#decktoast");
let queue = [], current = null, shownAt = 0, sound = false, toastTimer = null;
let saved = store.get("cm-saved", []);
function setSaved(list) { saved = list; store.set("cm-saved", saved); $("#savedcount").textContent = saved.length; }
function cardHtml(x, back) {
  const vid = x.video || (x.video_path && pub(x.video_path));
  const poster = x.video ? x.image : x.thumb_path ? pub(x.thumb_path) : "";
  const m = vid ? `<video src="${esc(vid)}"${poster ? ` poster="${esc(poster)}"` : ""} playsinline loop ${back ? 'preload="metadata"' : ""} muted></video>` : `<img src="${esc(x.image)}" alt="">`;
  return `<div class="card${back ? " back" : " enter"}" data-id="${esc(x.id)}">${m}<span class="progress"><i></i></span>${x.example ? '<span class="pill ex">Ejemplo</span>' : ""}
    <span class="stamp like">♥ ME GUSTA</span><span class="stamp pass">PASO</span>
    <div class="card-info"><div class="row"><h3>${esc(x.creator)}</h3>${x.price_from ? `<span class="price">${money(x.price_from)}</span>` : ""}</div>
      ${starsHtml(creatorKey(x))}<p>${esc(x.title)}</p><p>${esc([x.category, place(x)].filter(Boolean).join(" · "))}</p></div></div>`;
}
function drawDeck() {
  current = queue[0] || null;
  if (!current) {
    deck.innerHTML = `<div class="deck-end"><h3>Viste todos los videos</h3><p>Volvé más tarde: todos los días se suben nuevos.</p>
      ${saved.length ? `<button class="primary cta" data-view="saved">Ver mis ${saved.length} guardados</button>` : ""}
      <button class="outline" data-restart>Empezar de nuevo</button></div>`;
    $("#deckactions").hidden = true;
    return;
  }
  $("#deckactions").hidden = false;
  deck.innerHTML = (queue[1] ? cardHtml(queue[1], true) : "") + cardHtml(current);
  const top = deck.lastElementChild, v = top.querySelector("video");
  if (v) {
    v.muted = !sound;
    v.play().catch(() => { v.muted = true; sound = false; syncSound(); v.play().catch(() => {}); });
    const bar = top.querySelector(".progress i");
    v.addEventListener("timeupdate", () => {
      if (v.duration) bar.style.width = (v.currentTime / v.duration * 100) + "%";
      if (!v.dataset.done && v.duration && v.currentTime / v.duration > .9) { v.dataset.done = "1"; track(current.id, "complete"); learn(current.category, 1); }
    });
  }
  shownAt = Date.now();
  track(current.id, "view");
  bindDrag(top);
}
const ICON_ON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="m17 9 5 6m0-6-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function syncSound() {
  $("#feedsound").innerHTML = sound ? ICON_ON : ICON_OFF;
  $("#feedsound").setAttribute("aria-label", sound ? "Silenciar" : "Activar sonido");
}
function openFeed(startId) {
  const list = pool().slice().sort((a, b) => score(b) - score(a));
  const fresh = list.filter(x => !seen.has(x.id));
  queue = fresh.length ? fresh : list;
  if (startId) queue = [find(startId), ...queue.filter(x => x.id !== startId)].filter(Boolean);
  setSaved(saved);
  sound = true; syncSound();
  feed.hidden = false; document.body.classList.add("locked");
  document.querySelectorAll(".phones video, .grid video").forEach(v => v.pause());
  drawDeck();
  $("#feedclose").focus();
}
function closeFeed() {
  deck.querySelectorAll("video").forEach(v => v.pause());
  feed.hidden = true; document.body.classList.remove("locked");
  if (!calm) document.querySelectorAll(".phones video").forEach(v => v.play().catch(() => {}));
  render();
}
function pulse(el) { if (!el || calm) return; el.classList.remove("beat"); void el.offsetWidth; el.classList.add("beat"); }
function heart() {
  navigator.vibrate?.(35);
  pulse($(".round.like")); pulse($("#savedcount"));
  if (calm) return;
  const h = document.createElement("span"); h.className = "burst"; h.setAttribute("aria-hidden", "true"); h.textContent = "♥";
  deck.appendChild(h); setTimeout(() => h.remove(), 800);
}
function showToast(html) {
  toast.innerHTML = html; toast.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}
function decide(kind) {
  if (!current) return;
  const x = current, top = deck.lastElementChild;
  const watched = (Date.now() - shownAt) / 1000;
  seen.add(x.id); store.set("cm-seen", [...seen].slice(-300));
  if (kind === "like") {
    track(x.id, "like"); learn(x.category, 3);
    heart();
    if (!saved.includes(x.id)) setSaved([x.id, ...saved]);
    showToast(x.example ? "Guardado. Es un perfil de ejemplo."
      : `Guardaste a ${esc(x.creator)} <button class="primary cta" data-order="${esc(x.id)}">Pedirle un video</button>`);
  } else {
    track(x.id, "pass"); if (watched < 2.5) learn(x.category, -.5);
  }
  queue.shift();
  if (top && top.classList.contains("card")) {
    top.classList.add("fly");
    top.style.transform = `translateX(${kind === "like" ? 140 : -140}%) rotate(${kind === "like" ? 18 : -18}deg)`;
    top.style.opacity = "0";
    top.querySelector(`.stamp.${kind}`).style.opacity = 1;
    setTimeout(drawDeck, calm ? 0 : 260);
  } else drawDeck();
}
let lastTap = 0, tapTimer = null;
function tapCard(el) {
  const now = Date.now();
  if (now - lastTap < 280) { clearTimeout(tapTimer); lastTap = 0; return decide("like"); }
  lastTap = now;
  tapTimer = setTimeout(() => {
    const v = el.querySelector("video");
    if (!v) return;
    if (v.muted) { v.muted = false; sound = true; syncSound(); }
    else if (v.paused) v.play().catch(() => {}); else v.pause();
  }, 280);
}
function bindDrag(el) {
  let x0 = 0, y0 = 0, dx = 0, dragging = false;
  const like = el.querySelector(".stamp.like"), pass = el.querySelector(".stamp.pass");
  el.addEventListener("pointerdown", e => { dragging = true; x0 = e.clientX; y0 = e.clientY; dx = 0; el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointermove", e => {
    if (!dragging) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) < 6 && Math.abs(e.clientY - y0) > 10) return;
    el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    like.style.opacity = Math.max(0, Math.min(1, dx / 90));
    pass.style.opacity = Math.max(0, Math.min(1, -dx / 90));
  });
  const end = () => {
    if (!dragging) return; dragging = false;
    if (dx > 100) return decide("like");
    if (dx < -100) return decide("pass");
    if (Math.abs(dx) < 6) tapCard(el);
    el.classList.add("fly"); el.style.transform = ""; like.style.opacity = pass.style.opacity = 0;
    setTimeout(() => el.classList.remove("fly"), 320);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
function savedView() {
  const list = saved.map(find).filter(Boolean);
  show(title("Guardados") + (list.length
    ? `<p>Los creadores que te gustaron. Pedile un video al que más te convenza.</p><div class="saved-list">${list.map(x => `
      <div class="saved-item"><img src="${esc(x.video ? x.image : x.thumb_path ? pub(x.thumb_path) : x.image || "")}" alt="">
        <div><b>${esc(x.creator)}</b>${starsHtml(creatorKey(x))}<br><small>${esc(x.title)}${x.price_from ? " · " + money(x.price_from) : ""}</small></div>
        <div class="acts">${x.example ? "" : `<button class="primary cta" data-order="${esc(x.id)}">Pedir</button>`}
          <button class="outline" data-unsave="${esc(x.id)}" aria-label="Quitar de guardados">✕</button></div></div>`).join("")}</div>`
    : "<p>Todavía no guardaste a nadie. Abrí el feed y deslizá a la derecha los videos que te gusten.</p><form><button type=\"button\" class=\"primary cta\" data-feed>Abrir el feed</button></form>"));
}

/* ---------- Diálogo ---------- */
function show(html, wide) {
  dialog.classList.toggle("wide", !!wide);
  panel.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  panel.querySelector("h2")?.focus();
}
const title = t => `<h2 id="dialog-title" tabindex="-1">${esc(t)}</h2>`;
const notice = '<p class="notice" role="alert"></p>';
function needUser(action) {
  if (user) return action();
  pending = action;
  auth("signup");
}

async function openPortfolio() {
  const hash = location.hash;
  if (!hash.startsWith("#creador=")) return;
  const key = decodeURIComponent(hash.slice("#creador=".length));
  const example = examples.find(clip => clip.id === key);
  let samples = example ? [example] : clips.filter(clip => clip.user_id === key);
  let reviews = [];
  if (!example && sb && UUID.test(key)) {
    show(title("Cargando perfil…"), true);
    const [c, r] = await Promise.all([
      sb.from("cm_clips").select("*").eq("user_id", key).order("created_at", { ascending:false }),
      sb.from("cm_reviews").select("brand, stars, comment, created_at").eq("creator_id", key).order("created_at", { ascending:false }).limit(20)
    ]);
    if (location.hash !== hash) return;
    if (!c.error) samples = c.data || [];
    else if (!samples.length) return show(title("No pudimos cargar el perfil") + "<p>Volvé a abrir el enlace para intentar de nuevo.</p>");
    reviews = r.data || [];
  }
  if (!samples.length) return show(title("Perfil no disponible") + "<p>Este perfil no tiene muestras públicas.</p>");
  portfolioClips = samples;
  const lead = samples[0];
  const tags = [...new Set(samples.map(clip => clip.category).filter(Boolean))];
  const action = example ? "<p>Perfil de ejemplo.</p>" : user?.id === key
    ? '<button class="primary" data-view="upload">Subir otro video</button>'
    : `<button class="primary cta" data-order="${esc(lead.id)}">Pedir un video</button>`;
  show(`<div class="portfolio">
    <div class="portfolio-info">
      ${title(lead.creator)}
      ${starsHtml(key)}
      <div class="facts">${place(lead) ? `<span class="fact">${esc(place(lead))}</span>` : ""}${tags.map(tag => `<span class="fact">${esc(tag)}</span>`).join("")}
        ${lead.price_from ? `<span class="fact">Desde ${money(lead.price_from)}</span>` : ""}</div>
      <div class="portfolio-actions">${action}<button type="button" class="outline" data-copy-profile>Copiar enlace</button></div>
      <p class="notice" role="status"></p>
    </div>
    <h3>Videos</h3>
    <div class="portfolio-grid">${samples.map(clip => `<button class="clip" data-clip="${esc(clip.id)}"><span class="shot">${media(clip)}<span class="playdot" aria-hidden="true">▶</span></span><span class="t">${esc(clip.title)}</span></button>`).join("")}</div>
    ${reviews.length ? `<h3>Reseñas de marcas</h3><div class="reviews">${reviews.map(r => `<div class="review">
      <span class="stars"><i>${"★".repeat(r.stars)}</i><em>${"★".repeat(5 - r.stars)}</em></span>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}<small>${esc(r.brand)} · ${new Date(r.created_at).toLocaleDateString("es-AR", { month:"long", year:"numeric" })}</small></div>`).join("")}</div>` : ""}
  </div>`, true);
}

function perfHtml(x) {
  if (x.example) return "";
  const st = stats.get(x.id);
  if (!st || st.views < 5) return '<p class="fine">Todavía juntando datos de este video.</p>';
  const pct = Math.round(Number(st.completes) / Number(st.views) * 100);
  return `<div class="perf"><span><b>${Number(st.views).toLocaleString("es-AR")}</b> vistas</span><span><b>${pct}%</b> lo mira completo</span><span><b>${Number(st.likes).toLocaleString("es-AR")}</b> ♥</span></div>`;
}
function detail(id) {
  const x = find(id);
  if (!x) return;
  const mine = user && x.user_id === user.id;
  const cta = x.example ? `<p>Perfil de ejemplo con video generado con IA. No recibe pedidos.</p><button class="primary" data-view="upload">Subir mi video</button>`
    : mine ? `<p class="notice ok">Este video es tuyo. Así lo ven las marcas.</p><button class="outline" data-del="${esc(x.id)}">Borrar video</button>`
    : `<button class="primary cta" data-order="${esc(x.id)}">Pedir un video</button><p class="fine">Le pagás directo al creador. Sin comisión.</p>`;
  const key = creatorKey(x);
  show(`<div class="detail">${media(x, true)}<div class="side">
    <div class="facts"><span class="fact">${esc(x.category)}</span>${place(x) ? `<span class="fact">${esc(place(x))}</span>` : ""}</div>
    ${title(x.title)}
    <div class="byline"><span class="av">${esc(x.creator.charAt(0).toUpperCase())}</span>${key ? `<a class="profile-link" href="${profileHref(key)}">${esc(x.creator)}</a>` : esc(x.creator)} ${starsHtml(key)}</div>
    <p>${esc(x.description)}</p>
    ${perfHtml(x)}
    ${x.instagram ? `<a class="outline" href="https://instagram.com/${esc(x.instagram)}" target="_blank" rel="noopener">@${esc(x.instagram)}</a>` : ""}
    ${x.price_from ? `<div class="bigprice">${money(x.price_from)} <small>desde, por video</small></div>` : ""}
    ${cta}${notice}
    ${x.example || mine ? "" : `<button class="linkbtn report-link" data-report="${esc(x.id)}">Reportar este video</button>`}</div></div>`, true);
}

/* ---------- Reportar ---------- */
function report(id) {
  const x = find(id);
  if (!x) return;
  show(title("Reportar video") + `<p>${esc(x.title)} · ${esc(x.creator)}</p><form data-form="report" data-id="${esc(x.id)}">
    <fieldset class="chips"><legend>¿Qué pasa con este video?</legend>
      <label><input type="radio" name="reason" value="inapropiado" required><span>Contenido inapropiado</span></label>
      <label><input type="radio" name="reason" value="spam"><span>Spam o no es UGC</span></label>
      <label><input type="radio" name="reason" value="ajeno"><span>Usa contenido ajeno</span></label></fieldset>
    <p class="fine">Con varios reportes, el video se oculta hasta que lo revisemos.</p>
    <button class="primary">Enviar reporte</button>${notice}</form>`);
}

/* ---------- Cuenta ---------- */
function auth(mode) {
  const up = mode === "signup";
  show(title(up ? "Creá tu cuenta gratis" : "Entrá a tu cuenta") + `<form data-form="${up ? "signup" : "login"}">
    ${up ? '<label>Tu nombre o el de tu marca<input name="name" required maxlength="60" autocomplete="name"></label>' : ""}
    <label>Mail<input name="email" type="email" required autocomplete="email"></label>
    <label>Contraseña ${up ? "<small>Al menos 6 caracteres</small>" : ""}<input name="password" type="password" required minlength="6" autocomplete="${up ? "new-password" : "current-password"}"></label>
    <button class="primary">${up ? "Crear cuenta" : "Entrar"}</button>${notice}
    ${up ? '<p class="fine">Al crear una cuenta aceptás los <a href="terminos.html" target="_blank" rel="noopener">Términos</a> y la <a href="privacidad.html" target="_blank" rel="noopener">Política de privacidad</a>.</p>' : ""}</form>
  <p class="switch">${up ? "¿Ya tenés cuenta?" : "¿No tenés cuenta?"} <button class="linkbtn" data-auth="${up ? "login" : "signup"}">${up ? "Entrá" : "Creala gratis"}</button></p>`);
}
function account() {
  if (!user) return auth("login");
  show(title("Hola, " + myName()) + `<p>${esc(user.email)}</p><form>
    <button type="button" class="outline" data-view="orders">Mis encargos</button>
    <button type="button" class="outline" data-view="saved">Mis guardados (${saved.length})</button>
    <a class="outline" href="${profileHref(user.id)}">Mi perfil</a>
    <button type="button" class="outline" data-view="logout">Cerrar sesión</button></form>`);
}
function authError(error) {
  const m = error?.message || "";
  if (/already registered/i.test(m)) return "Ese mail ya tiene cuenta. Entrá con tu contraseña.";
  if (/invalid login/i.test(m)) return "Mail o contraseña incorrectos.";
  if (/not confirmed/i.test(m)) return "Todavía no confirmaste el mail. Abrí el link que te mandamos.";
  if (/rate limit|too many/i.test(m)) return "Hubo muchos intentos seguidos. Esperá unos minutos y probá de nuevo.";
  if (/password/i.test(m)) return "La contraseña tiene que tener al menos 6 caracteres.";
  return "No pudimos completar el registro. Probá de nuevo.";
}

/* ---------- Subir video ---------- */
function upload() {
  show(title("Subí tu video") + `<p>No importan los seguidores: si tu video rinde, sube en el feed.</p><form data-form="upload">
  <label class="drop"><b>Elegí tu video</b><small>MP4, MOV o WebM · hasta 50 MB</small>
    <input name="file" type="file" accept="video/mp4,video/webm,video/quicktime" required></label>
  <label>Título<input name="title" required maxlength="85" placeholder="Ej. Probé este sérum por una semana"></label>
  <div class="two"><label>Rubro<select name="category" required>${categories.map(c => `<option>${c}</option>`).join("")}</select></label>
    <label>Provincia<select name="province" required><option value="">Elegí</option>${provinceOptions}</select></label></div>
  <label>Tu nombre como creador<input name="creator" required maxlength="60" value="${esc(myName())}"></label>
  <details class="more"><summary>Más datos (opcional)</summary><div>
    <div class="two"><label>Precio desde (ARS)<input name="price_from" type="number" min="1" step="1" inputmode="numeric"></label>
      <label>Ciudad<input name="city" maxlength="60"></label></div>
    <label>Instagram<input name="instagram" maxlength="31" autocapitalize="none" placeholder="@usuario"></label>
    <label>Descripción<textarea name="description" rows="2" maxlength="240" placeholder="Qué producto es y qué mostrás"></textarea></label>
  </div></details>
  <label class="check"><input type="checkbox" name="rights" required><span>El video es mío y acepto que sea público.</span></label>
  <div class="bar" hidden><i></i></div>
  <button class="primary cta">Publicar</button>${notice}</form>`);
}
function makeThumb(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file), v = document.createElement("video");
    const done = blob => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(blob); };
    const timer = setTimeout(() => done(null), 5000);
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    v.onloadeddata = () => { v.currentTime = Math.min(0.6, (v.duration || 1) / 2); };
    v.onseeked = () => {
      try {
        const w = 480, h = Math.round(w * v.videoHeight / v.videoWidth) || 600, c = document.createElement("canvas");
        c.width = w; c.height = h; c.getContext("2d").drawImage(v, 0, 0, w, h);
        c.toBlob(done, "image/jpeg", 0.8);
      } catch { done(null); }
    };
    v.onerror = () => done(null);
  });
}
async function putFile(path, blob, type, onProgress) {
  const { data } = await sb.auth.getSession();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SB_URL}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader("apikey", SB_KEY);
    xhr.setRequestHeader("authorization", "Bearer " + data.session.access_token);
    xhr.setRequestHeader("content-type", type);
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(String(xhr.status)));
    xhr.onerror = () => reject(new Error("red"));
    xhr.send(blob);
  });
}

/* ---------- Brief en un toque ---------- */
const BRIEF = {
  "Cómo se usa": ["Mostrá el problema que resuelve en los primeros 3 segundos.", "Usá {p} paso a paso, con primer plano del resultado.", "Cerrá con el resultado final y «probalo»."],
  "Unboxing": ["Arrancá con la caja cerrada y tu reacción al abrirla.", "Mostrá cada pieza de {p}, texturas y detalles.", "Cerrá con tu primera impresión en una frase."],
  "Testimonio": ["Arrancá con «Hace un tiempo que uso {p} y…».", "Contá por qué lo elegiste y qué cambió.", "Cerrá recomendándolo a alguien como vos."],
  "Reseña": ["Decí tu veredicto en los primeros 3 segundos.", "Mostrá 3 cosas que te gustan de {p} y 1 detalle honesto.", "Cerrá con para quién lo recomendás."],
  "Anuncio": ["Poné el beneficio principal de {p} en pantalla de entrada.", "Mostrá el producto en uso, rápido y con ritmo.", "Cerrá con un llamado a la acción claro."]
};
function writeBrief(form) {
  const p = (form.querySelector("[name=product]")?.value || "").trim() || "el producto";
  const type = form.querySelector("[name=video_type]:checked")?.value || "Cómo se usa";
  const dur = form.querySelector("[name=duration]:checked")?.value || "30 segundos";
  const [hook, show, close] = BRIEF[type].map(t => t.replace("{p}", p));
  form.querySelector("[name=brief]").value =
    `Gancho: ${hook}\nQué mostrar: ${show}\nCierre: ${close}\nFormato: vertical 9:16, ${dur}, luz natural y audio claro.`;
}
const briefBtn = '<button type="button" class="brief-btn" data-brief>✦ Armar el brief por mí</button>';

/* ---------- Formas de pago ---------- */
const PAY = [["dinero", "Dinero"], ["canje", "Canje"], ["mixto", "Dinero + canje"]];
function payFields(amount, label) {
  return `<fieldset class="chips"><legend>Cómo pagás</legend>${PAY.map(([v, l]) =>
    `<label><input type="radio" name="pay_type" value="${v}" ${v === "dinero" ? "checked" : ""} required><span>${l}</span></label>`).join("")}</fieldset>
    <label class="pay-money">${label}<input name="budget" type="number" min="1" step="1" inputmode="numeric" required value="${amount || ""}"></label>
    <label class="pay-canje" hidden>Qué producto enviás <small>El canje no tiene costo extra</small><input name="canje_detail" maxlength="200" placeholder="Ej. 2 sérums y envío gratis"></label>`;
}
function syncPay(form) {
  const t = form?.querySelector("[name=pay_type]:checked")?.value, m = form?.querySelector(".pay-money"), c = form?.querySelector(".pay-canje");
  if (!m || !c) return;
  m.hidden = t === "canje"; m.querySelector("input").required = t !== "canje";
  c.hidden = t === "dinero"; c.querySelector("input").required = t !== "dinero";
  const pr = form.querySelector(".pay-protect");
  if (pr) pr.hidden = t === "canje";
}
const payText = (amount, type, detail) => type === "canje" ? "Canje: " + esc(detail)
  : type === "mixto" ? `${money(amount)} + canje (${esc(detail)})` : money(amount);
const payData = data => ({ pay_type:data.pay_type, budget:data.pay_type === "canje" ? 0 : Number(data.budget),
  canje_detail:data.pay_type === "dinero" ? null : (data.canje_detail || "").trim() });

/* ---------- Encargos ---------- */
function order(id) {
  const x = find(id);
  if (!x || x.example) return;
  const brand = store.get("cm-brand", "");
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const chips = (name, list, picked) => `<fieldset class="chips"><legend>${name === "video_type" ? "Tipo de video" : "Duración"}</legend>${list.map(v =>
    `<label><input type="radio" name="${name}" value="${v}" ${v === picked ? "checked" : ""} required><span>${v}</span></label>`).join("")}</fieldset>`;
  show(title("Pedile un video a " + x.creator) + `${starsHtml(creatorKey(x))}<form data-form="order" data-id="${esc(x.id)}">
    <div class="two"><label>Tu marca<input name="brand" required maxlength="70" value="${esc(brand || myName())}"></label>
      <label>Producto<input name="product" required maxlength="100"></label></div>
    ${chips("video_type", videoTypes, videoTypes[0])}${chips("duration", durations, durations[1])}
    <label>Qué tiene que mostrar<textarea name="brief" required rows="4" maxlength="2000" placeholder="Lo que sí o sí tiene que verse o decirse."></textarea></label>${briefBtn}
    ${payFields(x.price_from, "Cuánto pagás (ARS)")}
    <div class="two"><label>Para cuándo<input name="deadline" type="date" required min="${tomorrow}"></label>
      <label>Dónde lo vas a usar<select name="usage"><option>Redes de la marca</option><option>Anuncios pagos</option><option>Redes y anuncios pagos</option></select></label></div>
    <label class="check pay-protect"><input type="checkbox" name="protected" checked><span><b>Pago protegido con Mercado Pago.</b> Pagás al aceptar el creador y el dinero queda retenido hasta que apruebes el video.</span></label>
    <p class="fine">Incluye hasta 2 rondas de cambios. Sin comisión.</p>
    <button class="primary cta">Enviar pedido</button>${notice}</form>`);
  syncPay(panel.querySelector("form"));
}
function rateForm(o) {
  return `<form data-form="rate" data-id="${o.id}" data-creator="${o.creator_id}" data-brand="${esc(o.brand)}" data-approve="${o.stage === 2 ? 1 : ""}">
    <fieldset class="rate"><legend>¿Cómo vendió el video?</legend>
      ${[5,4,3,2,1].map(n => `<input type="radio" id="r${o.id}-${n}" name="stars" value="${n}" required><label for="r${o.id}-${n}" title="${n} de 5">★</label>`).join("")}</fieldset>
    <label>Comentario <small>Opcional, lo ven otras marcas</small><textarea name="comment" rows="2" maxlength="300"></textarea></label>
    <button class="primary cta">${o.stage === 2 ? "Aprobar y calificar" : "Calificar"}</button></form>`;
}
async function orders(tab, message) {
  show(title("Encargos") + "<p>Cargando…</p>");
  const head = t => `<div class="tabs three"><button data-tab="sent" aria-pressed="${t === "sent"}">Pedí</button>
      <button data-tab="got" aria-pressed="${t === "got"}">Me pidieron</button><button data-tab="camps" aria-pressed="${t === "camps"}">Campañas</button></div>`;
  if (tab === "camps") return campaignsTab(head("camps"), message);
  const [{ data, error }, rev, pay] = await Promise.all([
    sb.from("cm_orders").select("*").order("created_at", { ascending:false }),
    sb.from("cm_reviews").select("order_id").eq("brand_id", user.id),
    sb.from("cm_payouts").select("holder, alias").maybeSingle()
  ]);
  const payout = pay.data;
  if (error) return show(title("Encargos") + "<p>No pudimos cargar tus encargos. Revisá la conexión y probá de nuevo.</p>");
  const rated = new Set((rev.data || []).map(r => r.order_id));
  const sent = data.filter(o => o.brand_id === user.id), got = data.filter(o => o.creator_id === user.id);
  tab = tab || (got.some(o => o.stage < 2) ? "got" : "sent");
  const list = tab === "got" ? got : sent;
  const row = o => {
    const creator = tab === "got", link = o.delivery_url && /^https:\/\//.test(o.delivery_url)
      ? `<a class="outline" href="${esc(o.delivery_url)}" target="_blank" rel="noopener">Ver video entregado</a>` : "";
    const canje = o.pay_type === "canje";
    const note = o.revision_note && o.stage === 1 ? `<p class="revnote"><b>Cambios pedidos (${o.revisions} de 2):</b> ${esc(o.revision_note)}</p>` : "";
    const changes = o.revisions < 2 ? `<details class="more"><summary>Pedir cambios · te ${2 - o.revisions === 1 ? "queda 1 ronda" : "quedan 2 rondas"}</summary><div>
      <form data-form="changes" data-id="${o.id}" data-rev="${o.revisions}"><textarea name="note" rows="2" required maxlength="500" placeholder="Qué hay que ajustar"></textarea>
      <button class="primary">Pedir cambios</button></form></div></details>` : '<p class="fine">Ya usaste las 2 rondas de cambios.</p>';
    const done = '<p class="done">✓ Pago confirmado por los dos.</p>';
    const prot = o.protected;
    const payoutForm = `<form class="payout" data-form="payout"><p><b>¿A dónde te transferimos?</b></p>
      <div class="two"><input name="holder" required maxlength="80" placeholder="Titular de la cuenta" aria-label="Titular de la cuenta" value="${esc(payout?.holder || "")}">
      <input name="alias" required maxlength="22" placeholder="Alias o CBU" aria-label="Alias o CBU" value="${esc(payout?.alias || "")}"></div>
      <button class="primary">Guardar</button></form>`;
    const brandPay = prot
      ? ({ release:'<p class="escrow">Aprobado. Clip Market le transfiere el pago retenido al creador.</p>', released:done.replace("Pago confirmado por los dos", "Pago liberado al creador"),
           refunded:'<p class="escrow">El pago fue devuelto.</p>' })[o.escrow_status] || ""
      : o.received_at ? done : o.paid_at ? "<p>Marcaste el pago. Falta que el creador lo confirme.</p>"
      : `<button class="primary" data-paid="${o.id}">${canje ? "Marcar canje enviado" : "Marcar como pagado"}</button>`;
    const creatorPay = prot
      ? (o.received_at ? done : o.escrow_status === "released" ? `<button class="primary cta" data-received="${o.id}">Confirmar que cobré</button>`
        : o.escrow_status === "release" ? (payout ? `<p class="escrow">Aprobado. Te transferimos el pago a ${esc(payout.alias)}.</p>` : payoutForm)
        : '<p class="escrow">El pago fue devuelto a la marca.</p>')
      : o.received_at ? done : o.paid_at ? `<button class="primary cta" data-received="${o.id}">${canje ? "Confirmar que lo recibí" : "Confirmar que cobré"}</button>`
      : `<p>Aprobado. Esperando ${canje ? "el canje" : "el pago"} de la marca.</p>`;
    const needsPay = prot && (o.escrow_status === "none" || o.escrow_status === "pending");
    const escrowTag = prot ? `<span class="escrow-tag e-${o.escrow_status}">${({ none:"Pago protegido · sin pagar", pending:"Pago protegido · en proceso",
      held:"Pago protegido · dinero retenido", release:"Pago protegido · liberando", released:"Pago protegido · liberado", refunded:"Pago devuelto" })[o.escrow_status]}</span>` : "";
    const payBtn = `<button class="primary cta" data-mp="${o.id}">Pagar ${money(o.budget)} con Mercado Pago</button><p class="fine">El dinero queda retenido hasta que apruebes el video.</p>`;
    const action = creator
      ? [`<button class="primary cta" data-stage="${o.id}" data-to="1">Aceptar pedido</button>`,
         needsPay ? '<p class="escrow">Esperando que la marca pague. Cuando el dinero quede retenido, podés grabar tranquilo.</p>'
           : note + (prot && !o.revisions ? '<p class="escrow">El pago ya está retenido. Grabá y entregá.</p>' : "") + `<form class="deliver" data-form="deliver" data-id="${o.id}"><input name="url" type="url" required placeholder="Link al video (Drive, WeTransfer…)" aria-label="Link al video"><button class="primary">${o.revisions ? "Entregar de nuevo" : "Entregar"}</button></form>`,
         link + "<p>Esperando que la marca lo revise.</p>", link + creatorPay][o.stage]
      : ["<p>Esperando que el creador acepte.</p>", needsPay ? payBtn : o.revisions ? "<p>El creador está haciendo los cambios.</p>" : "<p>El creador está grabando.</p>",
         link + rateForm(o) + changes, link + (rated.has(o.id) ? "" : rateForm(o)) + brandPay][o.stage];
    return `<article class="order"><span class="stage s${o.stage}">${stages[o.stage]}</span>${escrowTag}
      <h3>${esc(o.product)} · ${creator ? "de " + esc(o.brand) : "para " + esc(o.creator_name)}</h3>
      <p>${esc(o.video_type)} · ${esc(o.duration)} · ${payText(o.budget, o.pay_type, o.canje_detail)} · entrega ${esc(o.deadline.split("-").reverse().join("/"))} · ${esc(o.usage)}</p>
      <p class="brief">${esc(o.brief)}</p>
      <div class="track">${stages.map((s, i) => `<span class="${i <= o.stage ? "on" : ""}">${s}</span>`).join("")}</div>${action}</article>`;
  };
  show(title("Encargos") + (message ? `<p class="notice ok">${esc(message)}</p>` : "") +
    head(tab) +
    (list.map(row).join("") || `<article class="order"><p>${tab === "got" ? "Todavía nadie te pidió un video. Subí uno para que te encuentren." : "Todavía no pediste ningún video. Deslizá el feed y guardá los que te gusten."}</p></article>`) + notice);
}

/* ---------- Campañas abiertas ---------- */
let campaigns = [], campCounts = new Map();
const ddmm = d => d.split("-").reverse().slice(0, 2).join("/");
async function loadCampaigns() {
  if (!sb) return;
  const [c, n] = await Promise.all([
    sb.from("cm_campaigns").select("*").eq("open", true).order("created_at", { ascending:false }).limit(30),
    sb.rpc("cm_campaign_counts")
  ]);
  campaigns = c.data || [];
  campCounts = new Map((n.data || []).map(r => [r.campaign_id, r]));
  renderCampaigns();
}
function campCard(c) {
  const taken = Number(campCounts.get(c.id)?.accepted || 0), full = taken >= c.slots, mine = user && c.brand_id === user.id;
  const action = mine ? `<button class="outline" data-view="orders" data-goto="camps">Ver postulantes</button>`
    : full ? `<button class="outline" disabled>Cupos completos</button>`
    : `<button class="primary cta" data-apply="${c.id}">Postularme</button>`;
  return `<article class="camp">
    <div class="camp-top"><span class="av">${esc(c.brand.charAt(0).toUpperCase())}</span><div><b>${esc(c.brand)}</b><small>${esc(c.category)}</small></div></div>
    <h3>${esc(c.product)}</h3>
    <p class="brief">${esc(c.brief)}</p>
    <div class="camp-pay">${c.pay_type === "canje" ? `<b>Canje</b><span>${esc(c.canje_detail)}</span>`
      : `<b>${money(c.pay_per_video)}</b><span>${c.pay_type === "mixto" ? "+ canje " : ""}por video</span>`}</div>
    <div class="camp-meta"><span>${esc(c.video_type)}</span><span>${esc(c.duration)}</span><span>Hasta ${ddmm(c.deadline)}</span></div>
    <div><div class="slots"><i style="width:${Math.min(100, taken / c.slots * 100)}%"></i></div>
      <small class="fine">${taken} de ${c.slots} ${c.slots === 1 ? "cupo tomado" : "cupos tomados"}</small></div>
    ${action}</article>`;
}
function renderCampaigns() {
  $("#camplist").innerHTML = campaigns.map(campCard).join("") || `<div class="camp-empty"><h3>Todavía no hay campañas abiertas</h3>
    <p>Publicá la primera y recibí postulaciones de creadores con sus clips.</p><button class="primary" data-view="newcampaign">Publicar campaña</button></div>`;
}
function newCampaign() {
  const brand = store.get("cm-brand", "") || myName();
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const chips = (name, legend, list, picked) => `<fieldset class="chips"><legend>${legend}</legend>${list.map(v =>
    `<label><input type="radio" name="${name}" value="${v}" ${v === picked ? "checked" : ""} required><span>${v}</span></label>`).join("")}</fieldset>`;
  show(title("Publicá una campaña") + `<p>Los creadores se postulan con un clip y vos elegís.</p><form data-form="campaign">
    <div class="two"><label>Tu marca<input name="brand" required maxlength="70" value="${esc(brand)}"></label>
      <label>Producto<input name="product" required maxlength="100"></label></div>
    <label>Rubro<select name="category">${categories.map(c => `<option>${c}</option>`).join("")}</select></label>
    ${chips("video_type", "Tipo de video", videoTypes, videoTypes[0])}${chips("duration", "Duración", durations, durations[1])}
    <label>Qué tiene que mostrar<textarea name="brief" required rows="4" maxlength="1500"></textarea></label>${briefBtn}
    ${payFields("", "Pago por video (ARS)")}
    <div class="two"><label>Cupos<input name="slots" type="number" min="1" max="50" value="3" required></label>
      <label>Hasta cuándo<input name="deadline" type="date" required min="${tomorrow}"></label></div>
    <label>Uso<select name="usage"><option>Redes de la marca</option><option>Anuncios pagos</option><option>Redes y anuncios pagos</option></select></label>
    <button class="primary cta">Publicar campaña</button>${notice}</form>`);
  syncPay(panel.querySelector("form"));
}
async function apply(id) {
  const c = campaigns.find(x => x.id === id);
  if (!c) return;
  show(title("Postulate a " + c.product) + "<p>Cargando tus videos…</p>");
  const { data } = await sb.from("cm_clips").select("id, title, thumb_path").eq("user_id", user.id).order("created_at", { ascending:false });
  if (!data?.length) return show(title("Primero subí un video") + `<p>Te postulás con uno de tus clips. Subí uno y volvé a esta campaña.</p>
    <form><button type="button" class="primary cta" data-view="upload">Subir mi video</button></form>`);
  show(title("Postulate a " + c.product) + `<p>${esc(c.brand)} paga ${payText(c.pay_per_video, c.pay_type, c.canje_detail)} por video. Elegí el clip que mejor muestra cómo grabás.</p>
    <form data-form="apply" data-id="${c.id}">
    <fieldset class="pick-clips"><legend>Tu clip</legend>${data.map((k, i) => `<label><input type="radio" name="clip" value="${k.id}" ${i ? "" : "checked"} required>
      ${k.thumb_path ? `<img src="${esc(pub(k.thumb_path))}" alt="">` : '<span class="ph"></span>'}<span>${esc(k.title)}</span></label>`).join("")}</fieldset>
    <label>Mensaje para la marca <small>Opcional</small><textarea name="message" rows="2" maxlength="300"></textarea></label>
    <button class="primary cta">Postularme</button>${notice}</form>`);
}
async function campaignsTab(head, message) {
  const [mine, apps] = await Promise.all([
    sb.from("cm_campaigns").select("*").eq("brand_id", user.id).order("created_at", { ascending:false }),
    sb.from("cm_applications").select("*").order("created_at", { ascending:false })
  ]);
  const myCamps = mine.data || [], all = apps.data || [];
  const myApps = all.filter(a => a.creator_id === user.id);
  const others = myApps.filter(a => !myCamps.some(c => c.id === a.campaign_id)).map(a => a.campaign_id);
  const extra = others.length ? (await sb.from("cm_campaigns").select("*").in("id", others)).data || [] : [];
  const campById = new Map([...myCamps, ...extra].map(c => [c.id, c]));
  const statusTxt = { pending:"Pendiente", accepted:"Aceptada", declined:"No seleccionada" };
  const brandBlock = myCamps.map(c => {
    const list = all.filter(a => a.campaign_id === c.id);
    return `<article class="order"><span class="stage ${c.open ? "s2" : ""}">${c.open ? "Abierta" : "Cerrada"}</span>
      <h3>${esc(c.product)} · ${payText(c.pay_per_video, c.pay_type, c.canje_detail)}</h3>
      <p>${list.filter(a => a.status === "accepted").length} de ${c.slots} cupos · ${list.length} ${list.length === 1 ? "postulación" : "postulaciones"}</p>
      ${list.map(a => `<div class="applicant"><span class="av">${esc(a.creator_name.charAt(0).toUpperCase())}</span>
        <div><b>${esc(a.creator_name)}</b> ${starsHtml(a.creator_id)}${a.message ? `<p>${esc(a.message)}</p>` : ""}</div>
        <div class="acts"><button class="outline" data-clip="${a.clip_id}">Ver clip</button>
          ${a.status === "pending" && c.open ? `<button class="primary cta" data-accept="${a.id}">Aceptar</button><button class="outline" data-decline="${a.id}">No, gracias</button>`
            : `<span class="stage ${a.status === "accepted" ? "s2" : ""}">${statusTxt[a.status]}</span>`}</div></div>`).join("") || "<p>Todavía no hay postulaciones.</p>"}
      ${c.open ? `<button class="linkbtn" data-close-camp="${c.id}">Cerrar campaña</button>` : ""}</article>`;
  }).join("");
  const creatorBlock = myApps.map(a => { const c = campById.get(a.campaign_id); return c ? `<article class="order">
      <span class="stage ${a.status === "accepted" ? "s2" : ""}">${statusTxt[a.status]}</span>
      <h3>${esc(c.product)} · ${esc(c.brand)}</h3><p>${payText(c.pay_per_video, c.pay_type, c.canje_detail)} · hasta ${ddmm(c.deadline)}</p>
      ${a.status === "accepted" ? "<p>Te eligieron. El pedido ya está en «Me pidieron».</p>" : ""}</article>` : ""; }).join("");
  show(title("Encargos") + (message ? `<p class="notice ok">${esc(message)}</p>` : "") + head +
    (brandBlock ? `<h3 class="sub">Mis campañas</h3>${brandBlock}` : "") +
    (creatorBlock ? `<h3 class="sub">Mis postulaciones</h3>${creatorBlock}` : "") +
    (!brandBlock && !creatorBlock ? `<article class="order"><p>No publicaste campañas ni te postulaste a ninguna.</p>
      <button class="primary" data-view="newcampaign">Publicar campaña</button></article>` : "") + notice);
  for (const id of ["accept", "decline"]) panel.querySelectorAll(`[data-${id}]`).forEach(b => { b.dataset.camp = (all.find(a => a.id === b.dataset[id]) || {}).campaign_id; });
}
async function decideApplication(appId, accept, b) {
  b.disabled = true;
  const say = t => { const n = panel.querySelector(".notice:last-child"); if (n) n.textContent = t; };
  const { data:a } = await sb.from("cm_applications").select("*").eq("id", appId).single();
  const { data:c } = await sb.from("cm_campaigns").select("*").eq("id", a.campaign_id).single();
  if (!a || !c) { b.disabled = false; return say("No pudimos cargar la postulación. Probá de nuevo."); }
  if (accept) {
    const { data:k } = await sb.from("cm_clips").select("title").eq("id", a.clip_id).single();
    const { error } = await sb.from("cm_orders").insert({ clip_id:a.clip_id, clip_title:k?.title || c.product, creator_id:a.creator_id, creator_name:a.creator_name,
      brand:c.brand, product:c.product, video_type:c.video_type, duration:c.duration, brief:c.brief, budget:c.pay_per_video, pay_type:c.pay_type, canje_detail:c.canje_detail, protected:c.pay_type !== "canje", deadline:c.deadline, usage:c.usage });
    if (error) { b.disabled = false; return say("No pudimos crear el pedido. Probá de nuevo."); }
  }
  const { error } = await sb.from("cm_applications").update({ status:accept ? "accepted" : "declined" }).eq("id", appId);
  if (error) { b.disabled = false; return say("No pudimos guardar el cambio. Probá de nuevo."); }
  loadCampaigns().catch(() => {});
  return orders("camps", accept ? `Aceptaste a ${a.creator_name}. El pedido quedó en «Los que pedí».` : "");
}

/* ---------- Eventos ---------- */
document.addEventListener("click", async event => {
  const link = event.target.closest('a[href^="#creador="]');
  if (link && link.hash === location.hash && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    return openPortfolio();
  }
  const b = event.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if ("copyProfile" in d) {
    const status = panel.querySelector("[role=status]");
    try { await navigator.clipboard.writeText(location.href); status.textContent = "Enlace copiado."; }
    catch { status.textContent = "Podés copiar el enlace desde la barra de direcciones."; }
    return;
  }
  if (b.classList.contains("close")) return dialog.close();
  if ("feed" in d) { if (dialog.open) dialog.close(); return openFeed(); }
  if ("restart" in d) { seen.clear(); store.set("cm-seen", []); return openFeed(); }
  if (d.swipe === "like" || d.swipe === "pass") return decide(d.swipe);
  if (d.swipe === "info") { if (current) detail(current.id); return; }
  if (d.chip) return chip(d.chip);
  if (b.getAttribute("role") === "tab") return selectTab(b);
  if (d.unsave) { setSaved(saved.filter(id => id !== d.unsave)); return savedView(); }
  if (b.id === "feedclose") return closeFeed();
  if (b.id === "feedsound") {
    sound = !sound; syncSound();
    const v = deck.lastElementChild?.querySelector("video"); if (v) v.muted = !sound;
    return;
  }
  if (b.id === "clear" || b.id === "clear2") {
    [fCategory, fSearch, fPrice, fProvince].forEach(field => { field.value = ""; });
    return render();
  }
  if (d.clip) return detail(d.clip);
  if (d.auth) return auth(d.auth);
  if (d.tab) return orders(d.tab);
  if (d.order) { toast.classList.remove("show"); return needUser(() => order(d.order)); }
  if (d.view === "saved") return savedView();
  if (d.view === "notes") return needUser(notesView);
  if (d.noteTab) { $("#pagetoast").classList.remove("show"); return needUser(() => orders(d.noteTab)); }
  if ("enableNotes" in d) {
    try { await Notification.requestPermission(); } catch {}
    return notesView();
  }
  if ("brief" in d) return writeBrief(b.form);
  if (d.report) return needUser(() => report(d.report));
  if (d.view === "newcampaign") return needUser(newCampaign);
  if (d.mp) {
    b.disabled = true; b.textContent = "Abriendo Mercado Pago…";
    const say = t => { const n = panel.querySelector(".notice:last-child"); if (n) n.textContent = t; };
    const { data, error } = await sb.functions.invoke("cm-pay-create", { body:{ order_id:d.mp, return_url:location.origin + location.pathname } });
    if (data?.url) { location.href = data.url; return; }
    let code = ""; try { code = (await error?.context?.json())?.error || ""; } catch {}
    b.disabled = false; b.textContent = "Pagar con Mercado Pago";
    return say(code === "not_configured" ? "Los pagos protegidos todavía no están activados. Escribinos a infoclipmarket@gmail.com."
      : "No pudimos abrir Mercado Pago. Probá de nuevo en unos minutos.");
  }
  if (d.paid || d.received) {
    b.disabled = true;
    const patch = d.paid ? { paid_at:new Date().toISOString() } : { received_at:new Date().toISOString() };
    const { error } = await sb.from("cm_orders").update(patch).eq("id", d.paid || d.received);
    if (error) { b.disabled = false; panel.querySelector(".notice:last-child").textContent = "No pudimos guardar el cambio. Probá de nuevo."; return; }
    return orders(d.paid ? "sent" : "got");
  }
  if (d.apply) return needUser(() => apply(d.apply));
  if (d.accept) return decideApplication(d.accept, true, b);
  if (d.decline) return decideApplication(d.decline, false, b);
  if (d.closeCamp) {
    b.disabled = true;
    await sb.from("cm_campaigns").update({ open:false }).eq("id", d.closeCamp);
    loadCampaigns().catch(() => {});
    return orders("camps", "Campaña cerrada.");
  }
  if (d.view === "upload") return needUser(upload);
  if (d.view === "orders") return needUser(() => orders(d.goto));
  if (d.view === "account") return account();
  if (d.view === "logout") { await sb.auth.signOut(); return dialog.close(); }
  if (d.stage) {
    b.disabled = true;
    const { error } = await sb.from("cm_orders").update({ stage:Number(d.to) }).eq("id", d.stage);
    if (error) { b.disabled = false; panel.querySelector(".notice:last-child").textContent = "No pudimos guardar el cambio. Probá de nuevo."; return; }
    return orders(d.to === "1" ? "got" : "sent");
  }
  if (d.del) {
    if (!d.sure) { d.sure = "1"; b.textContent = "Tocá de nuevo para borrarlo"; return; }
    b.disabled = true;
    const x = find(d.del);
    await sb.storage.from(BUCKET).remove([x.video_path, x.thumb_path].filter(Boolean));
    const { error } = await sb.from("cm_clips").delete().eq("id", x.id);
    if (error) { b.disabled = false; panel.querySelector("[role=alert]").textContent = "No pudimos borrarlo. Probá de nuevo."; return; }
    clips = clips.filter(c => c.id !== x.id);
    portfolioClips = portfolioClips.filter(c => c.id !== x.id);
    render(); dialog.close();
  }
});
document.addEventListener("keydown", e => {
  if (feed.hidden || dialog.open) return;
  if (e.key === "Escape") closeFeed();
  else if (e.key === "ArrowRight") decide("like");
  else if (e.key === "ArrowLeft") decide("pass");
  else if (e.key === " ") {
    e.preventDefault();
    const v = deck.lastElementChild?.querySelector("video");
    if (v) { if (v.paused) v.play().catch(() => {}); else v.pause(); }
  }
});
dialog.addEventListener("close", () => {
  if (dialog.open) return;
  panel.innerHTML = "";
  if (location.hash.startsWith("#creador=")) history.replaceState(null, "", location.pathname + location.search);
  if (!feed.hidden) deck.lastElementChild?.querySelector("video")?.play().catch(() => {});
});
dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });
window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#creador=")) openPortfolio();
  else if (panel.querySelector(".portfolio")) dialog.close();
});
grid.addEventListener("pointerover", e => {
  if (touch) return;
  const c = e.target.closest(".clip"); const v = c?.querySelector("video");
  v?.play().then(() => c.classList.add("playing")).catch(() => {});
});
grid.addEventListener("pointerout", e => {
  if (touch) return;
  const c = e.target.closest(".clip");
  if (c && !c.contains(e.relatedTarget)) { c.querySelector("video")?.pause(); c.classList.remove("playing"); }
});
panel.addEventListener("change", e => {
  if (e.target.name === "pay_type") return syncPay(e.target.form);
  if (e.target.type !== "file") return;
  const drop = e.target.closest(".drop"), f = e.target.files[0];
  drop.classList.toggle("has", !!f);
  drop.querySelector("b").textContent = f ? f.name : "Elegí tu video";
});
$("#searchform").addEventListener("submit", e => { e.preventDefault(); render(); $("#rail").scrollIntoView({ block:"nearest", behavior:calm ? "auto" : "smooth" }); });
fProvince.innerHTML = '<option value="">Argentina</option>' + provinceOptions;
[fSearch, fPrice, fSort, fProvince].forEach(el => el.addEventListener("input", render));

panel.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target, type = form.dataset.form;
  if (!type) return;
  const message = form.querySelector("[role=alert]") || panel.querySelector("[role=alert]");
  const button = form.querySelector("button.primary");
  const data = Object.fromEntries(new FormData(form));
  const say = (t, ok) => { if (!message) return; message.textContent = t; message.classList.toggle("ok", !!ok); };
  button.disabled = true; say("");
  try {
    if (type === "signup") {
      const { data:res, error } = await sb.auth.signUp({ email:data.email.trim(), password:data.password,
        options:{ data:{ name:data.name.trim() }, emailRedirectTo:location.origin + location.pathname } });
      if (error) return say(authError(error));
      if (res.user && res.user.identities && !res.user.identities.length) return say("Ese mail ya tiene cuenta. Entrá con tu contraseña.");
      if (!res.session) return say(`Te mandamos un mail a ${data.email.trim()}. Confirmá la cuenta desde ahí y después entrá.`, true);
    } else if (type === "login") {
      const { error } = await sb.auth.signInWithPassword({ email:data.email.trim(), password:data.password });
      if (error) return say(authError(error));
    } else if (type === "upload") {
      const file = data.file, ext = EXT[file.type];
      if (!ext) return say("Usá un video MP4, MOV o WebM.");
      if (file.size > 50 * 1024 * 1024) return say("El video supera los 50 MB. Recortalo o bajale la calidad.");
      const ig = (data.instagram || "").trim().replace(/^@/, "");
      if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) return say("Revisá el usuario de Instagram: solo letras, números, punto y guion bajo.");
      const id = crypto.randomUUID(), bar = form.querySelector(".bar");
      bar.hidden = false; button.textContent = "Subiendo…";
      let thumb = null;
      const blob = await makeThumb(file);
      if (blob) { try { await putFile(`thumbs/${id}.jpg`, blob, "image/jpeg"); thumb = `thumbs/${id}.jpg`; } catch {} }
      try { await putFile(`videos/${id}.${ext}`, file, file.type, p => { bar.firstElementChild.style.width = Math.round(p * 100) + "%"; }); }
      catch (e) { bar.hidden = true; button.textContent = "Publicar"; return say(e.message === "413" ? "El video supera los 50 MB." : "No pudimos subir el video. Revisá la conexión y probá de nuevo."); }
      const t = data.title.trim();
      const { data:row, error } = await sb.from("cm_clips").insert({ creator:data.creator.trim(), title:t, category:data.category,
        description:(data.description || "").trim() || t, city:[(data.city || "").trim(), data.province, "Argentina"].filter(Boolean).join(", "),
        price_from:data.price_from ? Number(data.price_from) : null,
        instagram:ig || null, video_path:`videos/${id}.${ext}`, thumb_path:thumb }).select().single();
      if (error) { bar.hidden = true; button.textContent = "Publicar"; return say("El video subió pero no pudimos publicarlo. Probá de nuevo."); }
      clips = [row, ...clips]; [fCategory, fSearch, fPrice, fProvince].forEach(f => { f.value = ""; }); fSort.value = "new";
      render(); dialog.close(); $("#buscar").scrollIntoView();
    } else if (type === "order") {
      const x = find(form.dataset.id);
      const { error } = await sb.from("cm_orders").insert({ clip_id:x.id, clip_title:x.title, creator_id:x.user_id, creator_name:x.creator,
        brand:data.brand.trim(), product:data.product.trim(), video_type:data.video_type, duration:data.duration, brief:data.brief.trim(),
        ...payData(data), protected:data.pay_type !== "canje" && data.protected === "on", deadline:data.deadline, usage:data.usage });
      if (error) return say(x.user_id === user.id ? "No podés pedirte un video a vos mismo." : "No pudimos enviar el pedido. Revisá los datos y probá de nuevo.");
      store.set("cm-brand", data.brand.trim());
      return orders("sent", `Pedido enviado a ${x.creator}. Lo va a ver en sus encargos.`);
    } else if (type === "deliver") {
      const url = data.url.trim();
      if (!/^https:\/\//.test(url)) return say("El link tiene que empezar con https://");
      const { error } = await sb.from("cm_orders").update({ stage:2, delivery_url:url }).eq("id", form.dataset.id);
      if (error) return say("No pudimos guardar la entrega. Probá de nuevo.");
      return orders("got");
    } else if (type === "report") {
      const { error } = await sb.from("cm_reports").insert({ clip_id:form.dataset.id, reason:data.reason });
      if (error && error.code !== "23505") return say("No pudimos enviar el reporte. Probá de nuevo.");
      return say("Gracias. Ya lo recibimos y lo vamos a revisar.", true);
    } else if (type === "payout") {
      const alias = data.alias.trim();
      if (!/^([A-Za-z0-9.\-]{6,20}|[0-9]{22})$/.test(alias)) return say("Revisá el alias (6 a 20 letras, números o puntos) o el CBU (22 números).");
      const { error } = await sb.from("cm_payouts").upsert({ user_id:user.id, holder:data.holder.trim(), alias, updated_at:new Date().toISOString() });
      if (error) return say("No pudimos guardar tus datos de cobro. Probá de nuevo.");
      return orders("got", "Listo. Te transferimos a " + alias + ".");
    } else if (type === "changes") {
      const { error } = await sb.from("cm_orders").update({ stage:1, revisions:Number(form.dataset.rev) + 1, revision_note:data.note.trim() }).eq("id", form.dataset.id);
      if (error) return say("No pudimos enviar el pedido de cambios. Probá de nuevo.");
      return orders("sent", "Pedido de cambios enviado al creador.");
    } else if (type === "campaign") {
      const { error } = await sb.from("cm_campaigns").insert({ brand:data.brand.trim(), product:data.product.trim(), category:data.category,
        video_type:data.video_type, duration:data.duration, brief:data.brief.trim(), pay_per_video:payData(data).budget, pay_type:data.pay_type, canje_detail:payData(data).canje_detail,
        slots:Number(data.slots), deadline:data.deadline, usage:data.usage });
      if (error) return say("No pudimos publicar la campaña. Revisá los datos y probá de nuevo.");
      store.set("cm-brand", data.brand.trim());
      await loadCampaigns();
      dialog.close();
      $("#campanas").scrollIntoView({ behavior:calm ? "auto" : "smooth" });
      return;
    } else if (type === "apply") {
      const { error } = await sb.from("cm_applications").insert({ campaign_id:form.dataset.id, creator_name:myName() || "Creador",
        clip_id:data.clip, message:(data.message || "").trim() || null });
      if (error) return say(error.code === "23505" ? "Ya te postulaste a esta campaña." : "No pudimos enviar la postulación. Probá de nuevo.");
      loadCampaigns().catch(() => {});
      return orders("camps", "Postulación enviada. Te avisamos acá cuando la marca decida.");
    } else if (type === "rate") {
      const id = form.dataset.id;
      if (form.dataset.approve) {
        const { error } = await sb.from("cm_orders").update({ stage:3 }).eq("id", id);
        if (error) return say("No pudimos aprobar el video. Probá de nuevo.");
      }
      const { error } = await sb.from("cm_reviews").insert({ order_id:id, creator_id:form.dataset.creator, brand:form.dataset.brand,
        stars:Number(data.stars), comment:(data.comment || "").trim() || null });
      if (error) return orders("sent", "El video quedó aprobado, pero no pudimos guardar la calificación. Probá de nuevo.");
      loadRatings().then(render).catch(() => {});
      return orders("sent", "¡Gracias! Tu calificación ayuda a otras marcas a elegir.");
    }
  } catch {
    say("Algo falló. Revisá la conexión y probá de nuevo.");
  } finally { if (button.isConnected) button.disabled = false; }
});

/* ---------- Pestañas ---------- */
function selectTab(tab) {
  document.querySelectorAll('.flow-tabs [role="tab"]').forEach(t => {
    const on = t === tab;
    t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
  tab.focus();
  tab.scrollIntoView({ block:"nearest", inline:"nearest" });
}
document.querySelector(".flow-tabs")?.addEventListener("keydown", e => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const tabs = [...document.querySelectorAll('.flow-tabs [role="tab"]')];
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  selectTab(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]);
});

/* ---------- Notificaciones ---------- */
const baseTitle = document.title;
let notes = [], noteChannel = null, noteUid = null;
const unread = () => notes.filter(n => !n.read_at).length;
function paintBell() {
  const bell = $("#bell"), badge = bell.querySelector(".badge"), n = unread();
  bell.hidden = !user;
  badge.textContent = n > 9 ? "9+" : String(n);
  badge.hidden = !n;
  bell.setAttribute("aria-label", n ? `Notificaciones, ${n} sin leer` : "Notificaciones");
  document.title = (n ? `(${n}) ` : "") + baseTitle;
}
async function loadNotes() {
  if (!user || !sb) { notes = []; return paintBell(); }
  const { data } = await sb.from("cm_notifications").select("*").order("created_at", { ascending:false }).limit(40);
  notes = data || [];
  paintBell();
}
function ago(d) {
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  if (m < 1) return "Recién";
  if (m < 60) return `Hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `Hace ${h} h`;
  const days = Math.round(h / 24);
  return days < 7 ? `Hace ${days} ${days === 1 ? "día" : "días"}` : new Date(d).toLocaleDateString("es-AR", { day:"numeric", month:"short" });
}
function deviceNotesHtml() {
  if (!("Notification" in window)) return "";
  if (Notification.permission === "granted") return '<p class="fine notes-foot">✓ Avisos activados en este dispositivo.</p>';
  if (Notification.permission === "denied") return '<p class="fine notes-foot">Bloqueaste los avisos en este navegador. Podés activarlos desde la configuración del sitio.</p>';
  return '<div class="notes-foot"><button class="outline" data-enable-notes>Activar avisos en este dispositivo</button></div>';
}
function notesView() {
  show(title("Notificaciones") + (notes.length
    ? `<div class="notes">${notes.map(n => `<button class="note-item${n.read_at ? "" : " unread"}" data-note-tab="${esc(n.tab)}">
        <b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ""}<small>${ago(n.created_at)}</small></button>`).join("")}</div>`
    : '<p class="notes-empty">Todavía no tenés notificaciones. Acá vas a ver pedidos, pagos, entregas, postulaciones y estrellas.</p>')
    + deviceNotesHtml());
  markRead();
}
async function markRead() {
  const ids = notes.filter(n => !n.read_at).map(n => n.id);
  if (!ids.length) return;
  const now = new Date().toISOString();
  notes.forEach(n => { if (!n.read_at) n.read_at = now; });
  paintBell();
  await sb.from("cm_notifications").update({ read_at:now }).in("id", ids);
}
function pageToast(n) {
  const t = $("#pagetoast");
  t.innerHTML = `<span><b>${esc(n.title)}</b>${n.body ? `<small>${esc(n.body)}</small>` : ""}</span><button class="primary" data-note-tab="${esc(n.tab)}">Ver</button>`;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 7000);
}
function listenNotes() {
  if (noteUid === (user?.id || null)) return;
  noteUid = user?.id || null;
  if (noteChannel) { sb.removeChannel(noteChannel); noteChannel = null; }
  if (!user) return;
  noteChannel = sb.channel("notes-" + user.id)
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"cm_notifications", filter:`user_id=eq.${user.id}` }, ({ new:n }) => {
      if (notes.some(x => x.id === n.id)) return;
      notes = [n, ...notes].slice(0, 40);
      paintBell();
      if (dialog.open && panel.querySelector(".notes, .notes-empty")) return notesView();
      pageToast(n);
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try { new Notification(n.title, { body:n.body || "", icon:"icon.svg", tag:"cm-" + n.id }); } catch {}
      }
    })
    .subscribe();
}

/* ---------- Inicio ---------- */
function setUser(u) {
  user = u || null;
  $("#account").textContent = user ? myName().split(" ")[0] : "Entrar";
  if (sb) { listenNotes(); loadNotes().catch(() => {}); }
  if (campaigns.length) renderCampaigns();
  if (user && pending) { const next = pending; pending = null; setTimeout(next, 0); }
  else if (user && dialog.open && panel.querySelector('[data-form="signup"],[data-form="login"]')) dialog.close();
}
if (calm) document.querySelectorAll(".phones video").forEach(v => { v.removeAttribute("autoplay"); v.pause(); });
setSaved(saved);
render();
if (sb) {
  sb.auth.getSession().then(({ data }) => setUser(data.session?.user));
  sb.auth.onAuthStateChange((_event, session) => setTimeout(() => setUser(session?.user), 0));
}
loadClips().then(openPortfolio);
(function payReturn() {
  const r = new URLSearchParams(location.search).get("pago");
  if (!r) return;
  history.replaceState(null, "", location.pathname + location.hash);
  const msg = { ok:"Recibimos tu pago. Queda retenido hasta que apruebes el video (puede tardar unos segundos en verse).",
    pendiente:"Tu pago está en proceso. Cuando Mercado Pago lo confirme, queda retenido.", error:"El pago no se completó. Podés intentarlo de nuevo desde el encargo." }[r];
  if (!msg || !sb) return;
  sb.auth.getSession().then(({ data }) => { if (data.session) { user = data.session.user; orders("sent", msg); } });
})();
loadCampaigns().catch(() => { $("#camplist").innerHTML = '<div class="camp-empty"><p>No pudimos cargar las campañas. Recargá la página.</p></div>'; });
