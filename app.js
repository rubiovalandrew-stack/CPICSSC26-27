/* SSC School Site – Firebase version (Firestore + Authentication) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore, limit, collection, addDoc, deleteDoc, deleteField, updateDoc, setDoc, doc, query, where, orderBy, onSnapshot, Timestamp, increment, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential, updateEmail, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
// Long-polling auto-detect keeps the connection working on networks that reset streaming connections.
const fs = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
const auth = getAuth(app);

const DAY = 864e5;        // photos stay up for 24 hours
const LOCK_SECONDS = 15;  // default news pop-up lock duration
const NEW_DAYS = 7;       // only news newer than this triggers the lock
const MESSAGE_LIMIT = 3000;
const MESSAGE_GROW_LIMIT = 1000;
const MAX_IMAGES_PER_COURSE = 6;

/* Campus Moments categories */
const COURSES = [
  { key: "crim", short: "Criminology", name: "Bachelor of Science in Criminology" },
  { key: "cs", short: "Computer Science", name: "Bachelor of Science in Computer Science" },
  { key: "tourism", short: "Tourism Management", name: "Bachelor of Science in Tourism Management" },
  { key: "act", short: "Computer Technology", name: "Associate in Computer Technology" },
  { key: "btvted", short: "Tech-Voc Teacher Ed", name: "Bachelor in Technical Vocational Teacher Education" },
  { key: "hrs", short: "Hotel & Restaurant", name: "Hotel and Restaurant Services" }
];
const COURSE = Object.fromEntries(COURSES.map(c => [c.key, c]));
// SSC positions: each has its own row (level) in the organizational chart and a seat limit.
const SOCIALS = { facebook: "Facebook", instagram: "Instagram", x: "X", tiktok: "TikTok", youtube: "YouTube", other: "Other" };
const socialOf = o => (SOCIALS[o.qrPlatform] ? o.qrPlatform : "other");
const POSITIONS = [
  { name: "Advisor", level: 0, max: 2 },
  { name: "President", level: 1, max: 1 },
  { name: "Vice-President", level: 2, max: 1 },
  { name: "Secretary", level: 3, max: 1 },
  { name: "Treasurer", level: 3, max: 1 },
  { name: "Auditor", level: 3, max: 1 },
  { name: "Senator", level: 4, max: 12 }
];
const courseSelectHTML = (attr, id, cur, blank) => `<select class="course-select" ${attr}="${id}" aria-label="Course">${blank ? `<option value="">Choose course…</option>` : ""}${COURSES.map(c => `<option value="${c.key}"${c.key === cur ? " selected" : ""}>${esc(c.short)}</option>`).join("")}</select>`;
// Calendar days / months are counted in Philippine time so every browser agrees.
const TZ = "Asia/Manila";
const dayKey = t => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });   // YYYY-MM-DD
const monthKey = t => dayKey(t).slice(0, 7);
const lastDayOf = month => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const isLastDayOfMonth = t => +dayKey(t).slice(8) === lastDayOf(monthKey(t));
const monthName = month => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }); };
const dayLabel = day => new Date(day + "T12:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });

const page = document.body.dataset.page;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = t => new Date(t).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
const fmtTime = t => new Date(t).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const shortDate = t => new Date(t).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
const ago = ms => { const m = Math.floor(ms / 60000); return m < 1 ? "Just now" : m < 60 ? m + "m" : Math.floor(m / 60) + "h"; };
const tagClass = s => (s === "SSC" ? "tag ssc" : "tag");
// Everything students see (news, photos, approved messages) lives for 24 hours from when it was posted.
const expiry = i => (i.expireAt && i.expireAt.toMillis ? i.expireAt.toMillis() : (i.postedAt || i.date) + DAY);
const isLive = i => expiry(i) > Date.now();
const liveImageCountForCourse = course => state.images.filter(image => image.course === course && isLive(image)).length;
const byDate = (a, b) => b.date - a.date;

/* likes / dislikes (anonymous; each browser remembers its own votes) */
const votes = () => { try { return JSON.parse(localStorage.getItem("ssc_votes") || "{}"); } catch (e) { return {}; } };
const setVote = (k, v) => { const o = votes(); if (v) o[k] = v; else delete o[k]; try { localStorage.setItem("ssc_votes", JSON.stringify(o)); } catch (e) {} };
const THUMB = `<path fill="currentColor" d="M2 21h4V9H2v12zm20-11c0-1.1-.9-2-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1 6.6 7.6C6.2 8 6 8.5 6 9v10c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7c.1-.2.2-.5.2-.8v-2z"/>`;
const ICON = {
  like: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">${THUMB}</svg>`,
  dislike: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="transform:rotate(180deg)">${THUMB}</svg>`,
  heart: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
};
const rxBtn = (kind, id, icon, count, on) => `<button class="rx${on ? " on" : ""}" type="button" data-rx="${icon === "dislike" ? "dislike" : "like"}" data-id="${id}" aria-pressed="${on}" aria-label="${icon === "dislike" ? "Dislike" : "Like"}">${ICON[icon]}<span>${count || 0}</span></button>`;
async function react(kind, id, type) {
  const col = kind === "m" ? "messages" : kind === "n" ? "news" : "images", key = kind + ":" + id, cur = votes()[key], patch = {};
  const f = t => (t === "like" ? "likes" : "dislikes");
  if (cur === type) { patch[f(type)] = increment(-1); setVote(key, null); }
  else { patch[f(type)] = increment(1); if (cur && kind !== "i") patch[f(cur)] = increment(-1); setVote(key, type); }
  try { await updateDoc(doc(fs, col, id), patch); }
  catch (err) {
    console.error("Could not save reaction:", err);
    setVote(key, cur || null);
    toast(err.code === "permission-denied"
      ? "Could not save your reaction. Firestore rules may need to be published."
      : "Could not save that. Check your connection and try again.");
  }
}
function preview(t) {   // first 1-2 sentences, max ~140 characters
  const full = String(t).trim();
  let p = (full.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [full]).slice(0, 2).join("").trim();
  if (p.length > 140) p = p.slice(0, 140).replace(/\s+\S*$/, "");
  const cut = p.length < full.length;
  return { short: cut ? p + "…" : p, cut };
}
function previewHTML(text, key, expanded) {
  const p = preview(text), open = expanded.has(key);
  return `<span class="short"${open ? " hidden" : ""}>${esc(p.short)}</span>${p.cut ? `<span class="full"${open ? "" : " hidden"}>${esc(text)}</span><button class="more" type="button" data-more="${esc(key)}" aria-expanded="${open}">${open ? "Show less" : "Show more"}</button>` : ""}`;
}
const newsImages = n => Array.isArray(n.images) ? n.images : n.image ? [n.image] : [];
const newsImageHTML = (n, className = "", loading = "lazy", carousel = false) => {
  const images = newsImages(n);
  if (!images.length) return "";
  const label = n.title || "News";
  const imgs = images.map((src, index) => `<img${className ? ` class="${className}"` : ""} src="${src}" alt="${esc(label)} image ${index + 1} of ${images.length}" loading="${loading}">`).join("");
  if (!carousel) return `<div class="news-image-grid">${imgs}</div>`;
  // Student view: show the first image; the rest are swiped left/right.
  const many = images.length > 1;
  return `<div class="news-carousel"><div class="news-image-grid news-image-carousel" role="region" tabindex="0" aria-label="${esc(label)} images${many ? ". Swipe horizontally to view all " + images.length + " images" : ""}">${imgs}</div>${many ? `<button class="cbtn prev" type="button" data-dir="prev" aria-label="Previous image" hidden>&#8249;</button><button class="cbtn next" type="button" data-dir="next" aria-label="Next image">&#8250;</button><span class="ccount" aria-hidden="true">1 / ${images.length}</span>` : ""}</div>`;
};
/* news image carousel: counter + arrows for mouse users */
function carouselSync(sc) {
  const wrap = sc.parentElement, count = sc.children.length, step = sc.clientWidth + 10;
  const i = Math.min(count - 1, Math.max(0, Math.round(sc.scrollLeft / step)));
  const c = $(".ccount", wrap); if (c) c.textContent = `${i + 1} / ${count}`;
  const p = $(".cbtn.prev", wrap), nx = $(".cbtn.next", wrap);
  if (p) p.hidden = i <= 0;
  if (nx) nx.hidden = i >= count - 1;
}
document.addEventListener("scroll", e => { if (e.target.classList && e.target.classList.contains("news-image-carousel")) carouselSync(e.target); }, true);
document.addEventListener("click", e => {
  const b = e.target.closest(".cbtn"); if (!b) return;
  const sc = $(".news-image-carousel", b.parentElement); if (!sc) return;
  sc.scrollBy({ left: (b.dataset.dir === "next" ? 1 : -1) * (sc.clientWidth + 10), behavior: "smooth" });
});
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
}

const state = {
  news: [], images: [], imageSubmissions: [], messages: [], comments: [], dailyBest: [], officers: [],
  contact: { qrCodes: [], phoneNumbers: [] },
  importantAnnouncement: null,
  newsPopupSettings: { lockSeconds: LOCK_SECONDS }
};
const loaded = new Set();
function watch(name, q, render) {
  return onSnapshot(q, snap => {
    state[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    loaded.add(name);
    render();
  }, err => { console.error(err); toast("Could not load data. Check your connection."); });
}
function watchDocument(name, reference, render, fallback = { qrCodes: [], phoneNumbers: [] }) {
  return onSnapshot(reference, snap => {
    state[name] = snap.exists() ? snap.data() : fallback;
    loaded.add(name);
    render();
  }, err => {
    console.error(err);
    const message = name === "importantAnnouncement"
      ? "Could not load the important announcement. Check your connection."
      : name === "newsPopupSettings"
        ? "Could not load the news pop-up timer. Check your connection."
        : "Could not load contact details. Check your connection.";
    toast(message);
  });
}

/* photo date + age counter (like a social post: "Nov 9 · 5h") */
const stampHTML = i => `<div class="stamp"><span>${shortDate(i.date)}</span><span class="dot">·</span><span class="age"></span></div>`;
function stamps() {
  const n = Date.now(); let gone = false;
  document.querySelectorAll("[data-exp]").forEach(f => {
    if (+f.dataset.exp <= n) { gone = true; return; }
    f.querySelector(".age").textContent = ago(n - +f.dataset.up);
  });
  return gone;
}
const purged = new Set();
function purge() {   // admin browser deletes anything older than 24h (photos, news, posted messages + their comments)
  if (!auth.currentUser) return;
  const n = Date.now();
  const drop = (col, id) => {
    const k = col + ":" + id; if (purged.has(k)) return; purged.add(k);
    deleteDoc(doc(fs, col, id)).catch(() => purged.delete(k));
  };
  if (loaded.has("dailyBest")) {
    state.images.filter(i => expiry(i) <= n).forEach(dropImage);
    state.dailyBest.filter(d => (d.month || "") < monthKey(n)).forEach(d => drop("dailyBest", d.id));   // month already highlighted
  }
  state.news.filter(i => expiry(i) <= n).forEach(i => drop("news", i.id));
  state.messages.filter(m => m.status === "approved" && expiry(m) <= n).forEach(async m => {
    const k = "messages:" + m.id; if (purged.has(k)) return; purged.add(k);
    try {
      const cs = await getDocs(query(collection(fs, "comments"), where("messageId", "==", m.id)));
      await Promise.all(cs.docs.map(c => deleteDoc(c.ref)));
      await deleteDoc(doc(fs, "messages", m.id));
    } catch (err) { console.error("Could not delete expired message:", err); purged.delete(k); }
  });
  if (loaded.has("messages") && loaded.has("comments")) {   // comments whose message is already gone
    const ids = new Set(state.messages.map(m => m.id));
    state.comments.filter(c => !ids.has(c.messageId)).forEach(c => drop("comments", c.id));
  }
}
// The most-liked photo of each day is saved (smaller) before the 24-hour delete, for the month-end highlight.
let archiveChain = Promise.resolve();
async function archiveWinner(i) {
  const day = dayKey(i.date), month = day.slice(0, 7);
  if (month !== monthKey(Date.now()) || !(i.likes > 0)) return;
  const cur = state.dailyBest.find(d => d.id === day);
  if (cur && (cur.likes || 0) >= i.likes) return;
  let src = i.src;
  try { src = await compress(await (await fetch(i.src)).blob(), 700, 120000); }
  catch (err) { if (String(src).length > 800000) return; }
  const rec = { day, month, src, caption: i.caption || "", course: i.course || "", likes: i.likes, date: i.date, imageId: i.id };
  await setDoc(doc(fs, "dailyBest", day), rec);
  state.dailyBest = [...state.dailyBest.filter(d => d.id !== day), { id: day, ...rec }];
}
function dropImage(i) {
  const k = "images:" + i.id; if (purged.has(k)) return; purged.add(k);
  archiveChain = archiveChain
    .then(async () => { await archiveWinner(i); await deleteDoc(doc(fs, "images", i.id)); })
    .catch(err => { console.error("Could not archive/delete expired photo:", err); purged.delete(k); });
}
// Best photo of each day this month (saved winners + photos still up), most likes first.
function monthWinners(month) {
  const best = new Map();
  const consider = r => {
    const day = r.day || dayKey(r.date);
    if (!(r.likes > 0) || !day.startsWith(month)) return;
    const c = best.get(day);
    if (!c || r.likes > c.likes) best.set(day, { ...r, day });
  };
  state.dailyBest.forEach(consider);
  state.images.forEach(consider);
  return [...best.values()].sort((a, b) => b.likes - a.likes || (a.day < b.day ? -1 : 1));
}
let refreshStudent = null;
setInterval(() => {
  purge();
  if (page === "student") { if (refreshStudent) refreshStudent(); if (stamps()) renderGallery(); }
  else if (stamps()) renderAdmin();
}, 30000);

/* ---------- STUDENT PAGE ---------- */
// Course tabs open in a random order on every visit so no course is always first.
const courseOrder = (() => { const a = COURSES.map(c => c.key); for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; } return a; })();
let galleryCourse = null;
function renderGallery() {
  const g = $("#gallery"), v = votes(), n = Date.now();
  const all = state.images.filter(i => expiry(i) > n)
    .sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.date - a.date);
  const count = k => all.filter(i => i.course === k).length;
  if (!galleryCourse && loaded.has("images")) galleryCourse = courseOrder.find(k => count(k) > 0) || courseOrder[0];
  const active = galleryCourse || courseOrder[0];
  const tabs = $("#galleryTabs"), keep = tabs.scrollLeft;
  tabs.innerHTML = [...courseOrder, "all"].map(k => `<button class="cat-chip" type="button" role="tab" data-course="${k}" aria-selected="${k === active}"><span>${k === "all" ? "All courses" : esc(COURSE[k].short)}</span><b>${k === "all" ? all.length : count(k)}</b></button>`).join("");
  tabs.scrollLeft = keep;
  $("#galleryCourseName").textContent = active === "all" ? "Photos from every course" : COURSE[active].name;
  const list = active === "all" ? all : all.filter(i => i.course === active);
  const tag = i => active === "all" && COURSE[i.course] ? `<span class="course-tag">${esc(COURSE[i.course].short)}</span>` : "";
  const photo = (i, featured = false) => `
    <figure class="${featured ? "featured" : ""}" data-id="${i.id}" data-up="${i.date}" data-exp="${expiry(i)}"><img src="${esc(i.src)}" alt="${esc(i.caption || "School photo")}" loading="lazy">
    <figcaption>${tag(i)}${stampHTML(i)}</figcaption>${rxBtn("i", i.id, "heart", i.likes, v["i:" + i.id] === "like")}</figure>`;
  const submitTile = `<button class="gallery-submit" type="button" aria-label="Submit a photo for admin approval"><span aria-hidden="true">+</span><span>Share a Campus Moment</span></button>`;
  g.innerHTML = list.length ? `
    ${photo(list[0], true)}
    <div class="gallery-thumbnails">${list.slice(1).map(i => photo(i)).join("")}
      ${submitTile}
    </div>` : `<div class="empty">${active === "all" ? "No photos right now." : "No photos for this course right now."} New photos appear here for 24 hours.</div>
      ${submitTile}`;
  stamps();
  const lb = $(".lightbox .rx");   // keep an open full-size photo in sync
  if (lb) { const im = state.images.find(x => x.id === lb.dataset.id); if (im) { const on = v["i:" + im.id] === "like"; $("span", lb).textContent = im.likes || 0; lb.classList.toggle("on", on); lb.setAttribute("aria-pressed", on); } }
  if (page === "student") renderMonthlyBest();
}
// Month-end highlight: on the last day of the month, every day's most-liked photo is shown for 24 hours with its likes.
let highlightUnsub = null, bestShown = [];
function ensureHighlightWatch() {
  if (highlightUnsub || !isLastDayOfMonth(Date.now())) return;
  highlightUnsub = watch("dailyBest", query(collection(fs, "dailyBest"), where("month", "==", monthKey(Date.now()))), renderMonthlyBest);
}
function renderMonthlyBest() {
  const box = $("#monthlyBest"); if (!box) return;
  const month = monthKey(Date.now());
  bestShown = isLastDayOfMonth(Date.now()) ? monthWinners(month) : [];
  if (!bestShown.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  box.innerHTML = `<div class="best-month">
    <div class="best-head"><span class="best-badge">${ICON.heart}Best of ${esc(monthName(month))}</span>
      <h3>The month's most-loved Campus Moments</h3>
      <p class="meta">The top photo from each day this month. On display today only.</p></div>
    <div class="best-grid">${bestShown.map((w, idx) => `<button class="best-card" type="button" data-best="${idx}">
      <img src="${esc(w.src)}" alt="${esc(w.caption || "Top photo of " + dayLabel(w.day))}" loading="lazy">
      <span class="best-likes">${ICON.heart}${w.likes} like${w.likes === 1 ? "" : "s"}</span>
      <span class="best-info"><strong>${dayLabel(w.day)}</strong>${COURSE[w.course] ? `<span class="course-tag">${esc(COURSE[w.course].short)}</span>` : ""}</span></button>`).join("")}</div></div>`;
}
const officerName = o => [o.firstName, o.middleName, o.lastName].filter(Boolean).join(" ");
const posIndex = o => { const i = POSITIONS.findIndex(p => p.name === o.position); return i < 0 ? 99 : i; };
const officerLevel = o => { const p = POSITIONS.find(x => x.name === o.position); return p ? p.level : [1, 2, 3, 4].includes(Number(o.level)) ? Number(o.level) : 3; };
const sortedOfficers = () => [...state.officers].sort((a, b) => officerLevel(a) - officerLevel(b) || posIndex(a) - posIndex(b) || (a.createdAt || 0) - (b.createdAt || 0));
// Student pop-up: the chart (bigger cards for higher positions) or one officer's profile.
let officerView = null;
function renderOfficers() {
  const box = $("#officerContent"); if (!box) return;
  const o = officerView && state.officers.find(x => x.id === officerView);
  if (officerView && !o) officerView = null;
  $("#officerBack").classList.toggle("hidden", !o);
  if (o) {
    box.innerHTML = `<div class="officer-profile">
      ${o.photo ? `<img class="officer-portrait" src="${esc(o.photo)}" alt="Portrait of ${esc(officerName(o))}">` : ""}
      <h3 class="officer-name">${esc(officerName(o))}</h3><p class="officer-position">${esc(o.position || "")}</p></div>
      ${o.bio ? `<h4>About</h4><p class="officer-text">${esc(o.bio)}</p>` : ""}
      ${o.message ? `<h4>Message to the student body</h4><blockquote class="officer-message">${esc(o.message)}</blockquote>` : ""}
      ${o.email ? `<p><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></p>` : ""}
      ${o.qr ? `<h4>Social media</h4><span class="platform ${socialOf(o)}">${socialOf(o) === "other" ? "Social media" : SOCIALS[socialOf(o)]}</span><img class="officer-qr" src="${esc(o.qr)}" alt="Social media QR code of ${esc(officerName(o))}">` : ""}`;
    box.scrollTop = 0; return;
  }
  const keep = box.scrollTop, list = sortedOfficers();
  if (!list.length) { box.innerHTML = `<div class="empty">The officers will be introduced here soon.</div>`; return; }
  box.innerHTML = `<div class="org">${[0, 1, 2, 3, 4].filter(l => list.some(x => officerLevel(x) === l)).map(l => (l === 0 ? `<h4 class="org-heading">SSC Advisors</h4>` : "") + `<div class="org-level lvl${l}">${list.filter(x => officerLevel(x) === l).map(x => `<button class="org-card" type="button" data-officer="${x.id}">
    <span class="org-photo">${x.photo ? `<img src="${esc(x.photo)}" alt="" loading="lazy">` : esc(((x.firstName || "")[0] || "") + ((x.lastName || "")[0] || ""))}</span>
    <strong>${esc(officerName(x))}</strong><span class="org-role">${esc(x.position || "")}</span></button>`).join("")}</div>`).join("")}</div>`;
  box.scrollTop = keep;
}
function validPhone(phone) { return /^\+?[\d\s().-]+$/.test(phone); }
const PLATFORMS = { facebook: "Facebook", instagram: "Instagram", x: "X", other: "Other" };
function safeWebLink(value) {
  const link = String(value || "").trim();
  if (!link) return "";
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}
// Reads the saved contact doc (also understands the older format of plain strings).
function contactData(c = state.contact) {
  const qrCodes = (Array.isArray(c.qrCodes) ? c.qrCodes : []).map((q, i) => typeof q === "string"
    ? { platform: "facebook", title: `CPIC Facebook page ${i + 1}`, src: q, link: "" }
    : { platform: PLATFORMS[q.platform] ? q.platform : "other", title: String(q.title || ""), src: String(q.src || ""), link: safeWebLink(q.link) }).filter(q => q.src);
  const phones = Array.isArray(c.phones)
    ? c.phones.map(p => ({ title: String(p.title || ""), number: String(p.number || "") })).filter(p => p.number)
    : (Array.isArray(c.phoneNumbers) ? c.phoneNumbers : []).map(n => ({ title: "", number: String(n) }));
  return { qrCodes, phones };
}
const phoneLink = p => validPhone(p.number) ? `<a href="tel:${esc(p.number.replace(/[^\d+]/g, ""))}">${esc(p.number)}</a>` : esc(p.number);
function openImage(src, alt, link = "") {
  const lb = document.createElement("div"); lb.className = "lightbox";
  const im = document.createElement("img"); im.src = src; im.alt = alt || ""; lb.appendChild(im);
  const href = safeWebLink(link);
  if (href) {
    const anchor = document.createElement("a");
    anchor.className = "lightbox-link";
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = "Open destination";
    anchor.addEventListener("click", ev => ev.stopPropagation());
    lb.appendChild(anchor);
  }
  const onKey = ev => { if (ev.key === "Escape") close(); };
  const close = () => { lb.remove(); document.removeEventListener("keydown", onKey); };
  lb.addEventListener("click", close); document.addEventListener("keydown", onKey); document.body.appendChild(lb);
}
const ALERT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
// Lock length in seconds (older announcements were saved in minutes).
const lockSeconds = a => Number(a.durationSeconds) || (Number(a.durationMinutes) || 0) * 60 || 30;
const secs = n => `${n} second${n === 1 ? "" : "s"}`;
// First sentence of the announcement, for the preview card.
function firstSentence(text) {
  const t = String(text || "").trim();
  const line = t.split("\n")[0];
  const m = line.match(/^.*?[.!?]+["')\]]*(?=\s|$)/);
  let s = (m ? m[0] : line).trim(), complete = !!m;
  if (s.length > 220) { s = s.slice(0, 220).replace(/\s+\S*$/, ""); complete = false; }
  return !complete && s.length < t.length ? s + "…" : s;
}
const PHONE_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z"/></svg>`;
// Shared layout for the student page and the admin preview: QR codes grouped by platform, then phone cards.
function contactHTML(admin) {
  const { qrCodes, phones } = contactData();
  const groups = Object.keys(PLATFORMS)
    .map(key => ({ key, items: qrCodes.map((q, i) => ({ ...q, i })).filter(q => q.platform === key) }))
    .filter(g => g.items.length);
  const qrHTML = groups.map(g => `<section class="contact-group">
    <h3 class="contact-heading"><span class="platform ${g.key}">${PLATFORMS[g.key]}</span></h3>
    <div class="contact-grid">${g.items.map(q => `<div class="contact-card">
      <img src="${q.src}" alt="${esc(q.title || PLATFORMS[g.key])} QR code" data-link="${esc(q.link)}" loading="lazy">
      <div class="contact-title">${esc(q.title)}</div>
      ${admin ? `<div class="contact-actions"><button class="btn ghost sm" type="button" data-cact="editqr" data-i="${q.i}">Edit title</button><button class="btn ghost sm" type="button" data-cact="editlink" data-i="${q.i}">Edit link</button><button class="btn danger sm" type="button" data-cact="delqr" data-i="${q.i}">Delete</button></div>` : ""}
    </div>`).join("")}</div></section>`).join("");
  const phoneHTML = phones.length ? `<section class="contact-group">
    <h3 class="contact-heading">Phone numbers</h3>
    <div class="phone-grid">${phones.map((p, i) => {
      const inner = `<span class="phone-icon">${PHONE_ICON}</span><span class="phone-text">${p.title ? `<span class="contact-title">${esc(p.title)}</span>` : ""}<span class="phone-num">${esc(p.number)}</span></span>`;
      if (admin) return `<div class="phone-card">${inner}<div class="contact-actions"><button class="btn ghost sm" type="button" data-cact="editphone" data-i="${i}">Edit</button><button class="btn danger sm" type="button" data-cact="delphone" data-i="${i}">Delete</button></div></div>`;
      return validPhone(p.number)
        ? `<a class="phone-card" href="tel:${esc(p.number.replace(/[^\d+]/g, ""))}">${inner}</a>`
        : `<div class="phone-card">${inner}</div>`;
    }).join("")}</div></section>` : "";
  return qrHTML + phoneHTML;
}
function renderContact() {
  const details = $("#contactDetails");
  if (!details) return;
  details.innerHTML = contactHTML(false) || `<div class="empty">Contact details will be posted here soon.</div>`;
}

/* locked "new news" pop-up */
let gateOpen = false;
let closeNewsGate = null;
const readSet = () => { try { return new Set(JSON.parse(localStorage.getItem("ssc_read") || "[]")); } catch (e) { return new Set(); } };
const markRead = id => { const s = readSet(); s.add(id); try { localStorage.setItem("ssc_read", JSON.stringify([...s])); } catch (e) {} };
const newsPopupLockSeconds = () => {
  const seconds = Number(state.newsPopupSettings && state.newsPopupSettings.lockSeconds);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400 ? seconds : LOCK_SECONDS;
};
function checkGate() {
  if (!loaded.has("newsPopupSettings") || gateOpen || (state.importantAnnouncement && Number(state.importantAnnouncement.lockUntil) > Date.now())) return;
  const read = readSet(), cutoff = Date.now() - NEW_DAYS * DAY;
  const unread = state.news.filter(n => !read.has(n.id) && n.date > cutoff && isLive(n));
  if (unread.length) openGate(unread);
}
function openGate(announcements) {
  gateOpen = true; document.body.style.overflow = "hidden";
  const duration = newsPopupLockSeconds();
  const g = document.createElement("div"); g.className = "gate";
  g.innerHTML = `<div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gt" tabindex="-1">
    <div class="gate-head"><h2 id="gt">New announcements</h2><span class="meta">${announcements.length} announcement${announcements.length === 1 ? "" : "s"} · ${duration} second${duration === 1 ? "" : "s"} reading time</span></div>
    <div class="gate-body">${announcements.map(n => `<article class="gate-news">
      <div class="meta"><span class="${tagClass(n.source)}">${esc(n.source)}</span>${fmt(n.date)}</div>
      <h3>${esc(n.title)}</h3>${newsImageHTML(n, "", "eager", true)}<p>${esc(n.body)}</p>
    </article>`).join("")}</div>
    <div class="gate-foot"><div class="gate-count" role="timer"></div><div class="bar"><i></i></div><button class="btn" disabled></button></div></div>`;
  document.body.appendChild(g);
  const body = $(".gate-body", g), btn = $(".gate-foot button", g), bar = $(".bar i", g), count = $(".gate-count", g);
  let left = duration, started = false, timer;
  const waiting = [...g.querySelectorAll("img")].filter(im => !im.complete);
  let pending = waiting.length;
  const secs = n => `${n} second${n === 1 ? "" : "s"}`;
  const finish = markAnnouncementsRead => {
    clearInterval(timer);
    body.removeEventListener("scroll", check);
    window.removeEventListener("resize", check);
    waiting.forEach(im => {
      im.removeEventListener("load", imageDone);
      im.removeEventListener("error", imageDone);
    });
    g.remove();
    gateOpen = false;
    closeNewsGate = null;
    document.body.style.overflow = document.querySelector(".important-announcement-gate") ? "hidden" : "";
    if (markAnnouncementsRead) {
      announcements.forEach(n => markRead(n.id));
      checkGate();
    }
  };
  const update = () => {
    const ok = started && left <= 0;
    btn.disabled = !ok;
    btn.textContent = ok ? "Done reading" : started ? `Done reading (${left}s)` : "Scroll down to start the timer";
    count.textContent = ok ? "Time's up. You can close this now." : started ? `⏱ ${secs(left)} left` : `⬇ Scroll to the bottom to start the ${secs(duration)} timer`;
    bar.style.width = started ? ((duration - left) / duration * 100) + "%" : "0%";
  };
  // The countdown starts only once the student has scrolled to the end (or nothing needs scrolling).
  const atEnd = () => body.scrollTop + body.clientHeight >= body.scrollHeight - 12;
  const start = () => {
    if (started) return;
    started = true;
    timer = setInterval(() => {   // pauses while the tab is hidden
      if (!document.hidden && left > 0) { left--; update(); if (left <= 0) clearInterval(timer); }
    }, 1000);
    update();
  };
  const check = () => { if (atEnd()) start(); };
  const imageDone = () => { if (--pending <= 0) check(); };
  body.addEventListener("scroll", check, { passive: true });
  window.addEventListener("resize", check);
  // Wait for the images so a short pop-up isn't treated as "already scrolled" before it grows.
  if (!pending) requestAnimationFrame(check);
  else waiting.forEach(im => { im.addEventListener("load", imageDone); im.addEventListener("error", imageDone); });
  btn.addEventListener("click", () => {
    if (!started || left > 0) return;
    finish(true);
  });
  closeNewsGate = finish;
  update(); $(".gate-card", g).focus();
}

function initStudent() {
  const expandedNews = new Set();
  let bulletinView = "recent";
  let importantGateTimer = null;
  let activeImportantLockUntil = 0;
  const importantBanner = $("#importantAnnouncementBanner");
  const importantCard = (item, foot) => `<article class="important-announcement-card">
    <header class="important-announcement-head">
      <span class="important-badge">${ALERT_ICON}Important announcement</span>
      <h2 id="importantAnnouncementTitle">${esc(item.title || "")}</h2>
    </header>
    <div class="important-announcement-content">
      <p>${esc(item.body || "")}</p>
      ${item.image ? `<img src="${esc(item.image)}" alt="${esc(item.title || "Important announcement")}">` : ""}
    </div>
    <div class="important-announcement-foot">${foot}</div>
  </article>`;
  const closeImportantGate = () => {
    clearInterval(importantGateTimer);
    importantGateTimer = null;
    activeImportantLockUntil = 0;
    const gate = $("#importantAnnouncementGate");
    if (gate && gate.open) gate.close();
    if (gate) gate.remove();
    document.body.style.overflow = gateOpen ? "hidden" : "";
  };
  // Tapping the card re-opens the full announcement, with a Close button and no timer.
  const closeImportantReader = () => {
    const reader = $("#importantAnnouncementReader");
    if (reader) { if (reader.open) reader.close(); reader.remove(); }
    document.body.style.overflow = gateOpen || $("#importantAnnouncementGate") ? "hidden" : "";
  };
  const openImportantReader = () => {
    const item = state.importantAnnouncement;
    if (!item || $("#importantAnnouncementReader") || $("#importantAnnouncementGate")) return;
    const reader = document.createElement("dialog");
    reader.id = "importantAnnouncementReader";
    reader.className = "important-announcement-gate";
    reader.setAttribute("aria-labelledby", "importantAnnouncementTitle");
    reader.innerHTML = importantCard(item, `<button class="btn" type="button" data-close>Close</button>`);
    reader.addEventListener("click", e => { if (e.target === reader || e.target.closest("[data-close]")) closeImportantReader(); });
    reader.addEventListener("close", () => { if (reader.isConnected) closeImportantReader(); });   // Escape key
    document.body.appendChild(reader);
    reader.showModal();
    document.body.style.overflow = "hidden";
    $("[data-close]", reader).focus();
  };
  importantBanner.addEventListener("click", e => { if (e.target.closest(".important-banner-inner")) openImportantReader(); });
  const renderImportantAnnouncement = () => {
    const announcement = state.importantAnnouncement;
    if (!announcement) {
      closeImportantGate();
      closeImportantReader();
      importantBanner.classList.add("hidden");
      importantBanner.innerHTML = "";
      checkGate();
      return;
    }

    const lockUntil = Number(announcement.lockUntil) || 0;
    if (lockUntil > Date.now()) {
      // Locked pop-up: cannot be closed until the timer ends.
      closeImportantReader();
      importantBanner.classList.add("hidden");
      importantBanner.innerHTML = "";
      if (activeImportantLockUntil !== lockUntil || !$("#importantAnnouncementGate")) {
        closeImportantGate();
        if (closeNewsGate) closeNewsGate(false);
        const total = Math.max(1, Math.round((lockUntil - (Number(announcement.publishedAt) || Date.now())) / 1000));
        const percentLeft = () => Math.min(100, Math.max(0, (lockUntil - Date.now()) / 10 / total));
        const gate = document.createElement("dialog");
        gate.id = "importantAnnouncementGate";
        gate.className = "important-announcement-gate";
        gate.setAttribute("aria-labelledby", "importantAnnouncementTitle");
        gate.innerHTML = importantCard(announcement, `<div class="gate-count" id="importantAnnouncementCountdown" role="timer"></div><div class="bar"><i id="importantAnnouncementBar" style="width:${percentLeft()}%"></i></div>`);
        gate.addEventListener("cancel", event => event.preventDefault());
        document.body.appendChild(gate);
        gate.showModal();
        activeImportantLockUntil = lockUntil;
        document.body.style.overflow = "hidden";
        const updateCountdown = () => {
          const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
          $("#importantAnnouncementCountdown").textContent = remaining
            ? `You can close this in ${secs(remaining)}`
            : "You can close this now";
          $("#importantAnnouncementBar").style.width = percentLeft() + "%";
          if (!remaining) {
            closeImportantGate();
            renderImportantAnnouncement();
          }
        };
        importantGateTimer = setInterval(updateCountdown, 1000);
        updateCountdown();
      }
      return;
    }

    // Timer is over: the announcement sits above the bulletin as a tappable card.
    closeImportantGate();
    importantBanner.innerHTML = `<button class="important-banner-inner" type="button" aria-haspopup="dialog">
      <span class="important-banner-body">
        <span class="important-banner-main">
          <span class="important-badge">${ALERT_ICON}Important announcement</span>
          <span class="important-banner-title">${esc(announcement.title || "")}</span>
          <span class="important-banner-text">${esc(firstSentence(announcement.body))}</span>
        </span>
        ${announcement.image ? `<img class="important-banner-img" src="${esc(announcement.image)}" alt="">` : ""}
      </span>
      <span class="important-banner-hint">Tap to read the full announcement</span>
    </button>`;
    importantBanner.classList.remove("hidden");
    checkGate();
  };
  watchDocument("importantAnnouncement", doc(fs, "siteContent", "importantAnnouncement"), renderImportantAnnouncement, null);
  watchDocument("newsPopupSettings", doc(fs, "siteContent", "newsPopupSettings"), checkGate, { lockSeconds: LOCK_SECONDS });
  let lastSig = "";
  const liveSig = () => [...state.news, ...state.messages].filter(isLive).map(i => i.id).join();
  const renderNews = () => {
    const v = votes();
    lastSig = liveSig();
    const live = state.news.filter(isLive);
    const announcements = bulletinView === "recent" ? live.slice(0, 3) : live;
    $("#news").innerHTML = announcements.length ? announcements.map(n => `
      <article class="news-item" data-id="${n.id}">
        <div class="meta"><span class="${tagClass(n.source)}">${esc(n.source)}</span>${fmt(n.date)}</div>
        <h3>${esc(n.title)}</h3>${newsImageHTML(n, "", "lazy", true)}<p>${previewHTML(n.body, "news:" + n.id, expandedNews)}</p>
        <div class="react">${rxBtn("n", n.id, "like", n.likes, v["n:" + n.id] === "like")}${rxBtn("n", n.id, "dislike", n.dislikes, v["n:" + n.id] === "dislike")}</div>
      </article>`).join("") : `<div class="empty">Nothing posted yet. Check back soon.</div>`;
  };
  $("#bulletinFilters").addEventListener("click", e => {
    const button = e.target.closest("[data-bulletin-view]");
    if (!button) return;
    bulletinView = button.dataset.bulletinView;
    $("#bulletinFilters").querySelectorAll("[data-bulletin-view]").forEach(item => {
      item.setAttribute("aria-pressed", item === button);
    });
    subscribeNews();
  });
  // "Recent" only downloads the 3 newest posts; "All" downloads the full list.
  let newsUnsub = null;
  function subscribeNews() {
    if (newsUnsub) newsUnsub();
    const q = bulletinView === "recent"
      ? query(collection(fs, "news"), orderBy("date", "desc"), limit(3))
      : query(collection(fs, "news"), orderBy("date", "desc"));
    newsUnsub = watch("news", q, () => { renderNews(); checkGate(); });
  }
  subscribeNews();
  $("#news").addEventListener("click", e => {
    const newsImage = e.target.closest(".news-image-grid img");
    if (newsImage) {
      const lightbox = document.createElement("div");
      lightbox.className = "lightbox";
      const image = document.createElement("img");
      image.src = newsImage.src;
      image.alt = newsImage.alt;
      lightbox.appendChild(image);
      const close = () => {
        lightbox.remove();
        document.removeEventListener("keydown", onKey);
      };
      const onKey = ev => { if (ev.key === "Escape") close(); };
      lightbox.addEventListener("click", close);
      document.addEventListener("keydown", onKey);
      document.body.appendChild(lightbox);
      return;
    }
    const rx = e.target.closest(".rx");
    if (rx) { react("n", rx.dataset.id, rx.dataset.rx); return; }
    const button = e.target.closest("[data-more]");
    if (!button) return;
    const key = button.dataset.more;
    expandedNews.has(key) ? expandedNews.delete(key) : expandedNews.add(key);
    const article = button.closest(".news-item");
    const news = article && state.news.find(n => n.id === article.dataset.id);
    if (news) article.querySelector("p").innerHTML = previewHTML(news.body, key, expandedNews);
  });
  watch("images", query(collection(fs, "images"), orderBy("date", "desc")), renderGallery);
  ensureHighlightWatch();
  watch("officers", query(collection(fs, "officers"), orderBy("createdAt", "asc")), renderOfficers);
  renderOfficers();
  $("#galleryTabs").addEventListener("click", e => {
    const chip = e.target.closest("[data-course]"); if (!chip) return;
    galleryCourse = chip.dataset.course; renderGallery();
  });
  $("#monthlyBest").addEventListener("click", e => {
    const card = e.target.closest("[data-best]"); const w = card && bestShown[+card.dataset.best]; if (!w) return;
    const lb = document.createElement("div"); lb.className = "lightbox";
    lb.innerHTML = `<figure class="lb-fig"><img src="${esc(w.src)}" alt="${esc(w.caption || "Top photo")}"><figcaption>${w.caption ? `<p>${esc(w.caption)}</p>` : ""}<span>${dayLabel(w.day)}${COURSE[w.course] ? " · " + esc(COURSE[w.course].name) : ""} · ♥ ${w.likes} like${w.likes === 1 ? "" : "s"}</span></figcaption></figure>`;
    const onKey = ev => { if (ev.key === "Escape") close(); };
    const close = () => { lb.remove(); document.removeEventListener("keydown", onKey); };
    lb.onclick = close; document.addEventListener("keydown", onKey); document.body.appendChild(lb);
  });
  const officerDialog = $("#officerDialog");
  const openOfficers = () => { officerView = null; renderOfficers(); officerDialog.showModal(); document.body.style.overflow = "hidden"; };
  $("#openOfficers").addEventListener("click", openOfficers);
  $("#officerClose").addEventListener("click", () => officerDialog.close());
  $("#officerBack").addEventListener("click", () => { officerView = null; renderOfficers(); });
  officerDialog.addEventListener("click", e => { if (e.target === officerDialog) officerDialog.close(); });
  officerDialog.addEventListener("close", () => { document.body.style.overflow = gateOpen || $("#importantAnnouncementGate") ? "hidden" : ""; });
  $("#officerContent").addEventListener("click", e => {
    const card = e.target.closest("[data-officer]"); if (!card) return;
    officerView = card.dataset.officer; renderOfficers();
  });
  watchDocument("contact", doc(fs, "siteContent", "contact"), renderContact);
  renderContact();
  $("#contactDetails").addEventListener("click", e => { const im = e.target.closest(".contact-card img"); if (im) openImage(im.src, im.alt, im.dataset.link); });

  const expanded = new Set();
  let messageFilter = "recent";
  const drawWall = () => {
    const v = votes();
    lastSig = liveSig();
    let posted = state.messages.filter(isLive).sort(byDate);
    if (messageFilter === "liked") {
      posted = posted.filter(m => (m.likes || 0) > 0)
        .sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.date - a.date);
    }
    if (messageFilter === "disliked") {
      posted = posted.filter(m => (m.dislikes || 0) > 0)
        .sort((a, b) => (b.dislikes || 0) - (a.dislikes || 0) || b.date - a.date);
    }
    if (messageFilter !== "all") posted = posted.slice(0, 3);
    $("#wall").innerHTML = posted.length ? posted.map(m => {
      const messageKey = "message:" + m.id, replyKey = "reply:" + m.id;
      const comments = state.comments.filter(c => c.messageId === m.id).sort(byDate);
      return `<div class="note" data-id="${m.id}"><div class="note-msg"><p>${previewHTML(m.text, messageKey, expanded)}</p></div><div class="meta">Anonymous · ${fmt(m.date)}</div>
        ${m.reply ? `<div class="reply"><strong>Admin replied</strong><p>${previewHTML(m.reply, replyKey, expanded)}</p></div>` : ""}
        <div class="react">${rxBtn("m", m.id, "like", m.likes, v["m:" + m.id] === "like")}${rxBtn("m", m.id, "dislike", m.dislikes, v["m:" + m.id] === "dislike")}</div>
        <section class="note-comments" aria-label="Comments">
          <h3>Comments (${comments.length})</h3>
          ${comments.length ? comments.map(c => `<div class="note-comment"><p>${esc(c.text)}</p><div class="meta">Anonymous · ${fmt(c.date)}</div></div>`).join("") : `<div class="meta">No approved comments yet.</div>`}
          <button class="btn ghost sm comment-button" type="button" data-comment="${m.id}">Comment</button>
        </section>
      </div>`;
    }).join("") : `<div class="empty">${messageFilter === "liked" ? "No liked messages yet." : messageFilter === "disliked" ? "No disliked messages yet." : "No approved messages yet. Be the first to send one."}</div>`;
  };
  watch("messages", query(collection(fs, "messages"), where("status", "==", "approved")), drawWall);
  refreshStudent = () => { ensureHighlightWatch(); renderMonthlyBest(); if (liveSig() !== lastSig) { renderNews(); drawWall(); } };
  watch("comments", query(collection(fs, "comments"), where("status", "==", "approved")), drawWall);
  let commentMessageId = "";
  $("#wall").addEventListener("click", e => {
    const rx = e.target.closest(".rx"); if (rx) { react("m", rx.dataset.id, rx.dataset.rx); return; }
    const comment = e.target.closest("[data-comment]");
    if (comment) {
      commentMessageId = comment.dataset.comment;
      $("#commentText").value = "";
      $("#commentDialog").showModal();
      $("#commentText").focus();
      return;
    }
    const b = e.target.closest("[data-more]"); if (!b) return;
    expanded.has(b.dataset.more) ? expanded.delete(b.dataset.more) : expanded.add(b.dataset.more);
    drawWall();
  });
  $("#cancelComment").addEventListener("click", () => $("#commentDialog").close());
  $("#commentForm").addEventListener("submit", async e => {
    e.preventDefault();
    const text = $("#commentText").value.trim();
    if (text.length < 2) return toast("Please write a little more.");
    if (text.length > 500) return toast("Comments can be up to 500 characters.");
    const button = $("#submitComment");
    button.disabled = true;
    try {
      await addDoc(collection(fs, "comments"), { messageId: commentMessageId, text, status: "pending", date: Date.now() });
      $("#commentDialog").close();
      toast("Comment submitted. It will appear if the admin approves it.");
    } catch (err) {
      console.error("Could not submit comment:", err);
      toast("Could not submit your comment. Please try again.");
    } finally { button.disabled = false; }
  });
  $("#messages .message-filters").addEventListener("click", e => {
    const button = e.target.closest("[data-filter]");
    if (!button) return;
    messageFilter = button.dataset.filter;
    $("#messages .message-filters").querySelectorAll("[data-filter]").forEach(item => item.setAttribute("aria-pressed", item === button));
    drawWall();
  });

  const g = $("#gallery");
  g.addEventListener("click", e => {
    if (e.target.closest(".gallery-submit")) { openSubmit(); return; }
    const rx = e.target.closest(".rx"); if (rx) { react("i", rx.dataset.id, "like"); return; }
    const fig = e.target.closest("figure[data-id]"); if (!fig) return;
    const i = state.images.find(x => x.id === fig.dataset.id); if (!i) return;
    const lb = document.createElement("div"); lb.className = "lightbox";
    lb.innerHTML = `<figure class="lb-fig"><img src="${i.src}" alt="${esc(i.caption || "School photo")}">
      <figcaption>${i.caption ? `<p>${esc(i.caption)}</p>` : ""}<span>${fmtTime(i.date)} · ${ago(Date.now() - i.date)}</span>
      <div class="lbrx">${rxBtn("i", i.id, "heart", i.likes, votes()["i:" + i.id] === "like")}</div></figcaption></figure>`;
    const onKey = ev => { if (ev.key === "Escape") close(); };
    const close = () => { lb.remove(); document.removeEventListener("keydown", onKey); };
    lb.onclick = ev => { if (ev.target.closest(".rx")) { react("i", i.id, "like"); return; } close(); };
    document.addEventListener("keydown", onKey); document.body.appendChild(lb);
  });
  // Photo submission form: live preview, course picker, caption counter.
  const subDialog = $("#imageSubmissionDialog"), subForm = $("#imageSubmissionForm"), subFile = $("#studentImage"), subPreview = $("#studentImagePreview"), subZone = $("#dropzone"), subCaption = $("#studentImageCaption");
  $("#studentCourse").innerHTML = `<option value="">Choose a course…</option>` + COURSES.map(c => `<option value="${c.key}">${esc(c.name)}</option>`).join("");
  function showPreview(file) {
    if (subPreview.dataset.url) URL.revokeObjectURL(subPreview.dataset.url);
    subPreview.dataset.url = "";
    if (file) { const u = URL.createObjectURL(file); subPreview.dataset.url = u; subPreview.src = u; }
    subPreview.hidden = !file; subZone.classList.toggle("has-file", !!file);
    $(".dz-empty", subZone).hidden = !!file; $(".dz-change", subZone).hidden = !file;
  }
  function resetSubmission() { subForm.reset(); showPreview(null); $("#captionCount").textContent = "0 / 100"; }
  function openSubmit() {
    resetSubmission();
    if (galleryCourse && galleryCourse !== "all") $("#studentCourse").value = galleryCourse;
    subDialog.showModal();
  }
  subFile.addEventListener("change", () => showPreview(subFile.files[0] || null));
  subCaption.addEventListener("input", () => $("#captionCount").textContent = `${subCaption.value.length} / 100`);
  $("#cancelImageSubmission").addEventListener("click", () => subDialog.close());
  $("#closeImageSubmission").addEventListener("click", () => subDialog.close());
  subDialog.addEventListener("click", e => { if (e.target === subDialog) subDialog.close(); });
  subDialog.addEventListener("close", resetSubmission);
  subForm.addEventListener("submit", async e => {
    e.preventDefault();
    const file = subFile.files[0];
    if (!file) return toast("Choose an image first.");
    const courseValue = $("#studentCourse").value;
    if (!COURSE[courseValue]) return toast("Pick the course this photo is for.");
    const button = $("#submitImage");
    button.disabled = true;
    try {
      const src = await compress(file, 900);
      const submission = { src, caption: subCaption.value.trim(), course: courseValue, status: "pending", date: Date.now() };
      if (new TextEncoder().encode(JSON.stringify(submission)).length > 950000) {
        return toast("The image is too large to submit. Choose a smaller image.");
      }
      await addDoc(collection(fs, "imageSubmissions"), submission);
      subDialog.close();
      toast("Photo submitted. It will appear if an admin approves it.");
    } catch (err) {
      console.error("Could not submit campus photo:", err);
      toast(err.message === "too large"
        ? "The image could not be compressed enough. Choose a smaller image."
        : "Could not submit your photo. Please try again.");
    } finally { button.disabled = false; }
  });

  const ta = $("#msg"), cnt = $("#count");
  let messageGrowCap = 0, messageGrowWidth = 0, messageGrowPrefix = "";
  const messageHeightFor = prefix => {
    const width = ta.clientWidth;
    if (messageGrowCap && messageGrowWidth === width && messageGrowPrefix === prefix) return messageGrowCap;
    const style = getComputedStyle(ta);
    const probe = ta.cloneNode(false);
    probe.removeAttribute("id");
    probe.value = prefix;
    Object.assign(probe.style, {
      position: "fixed", left: "-9999px", top: "0", visibility: "hidden",
      width: style.width, minHeight: style.minHeight, maxHeight: "none", height: "auto",
      boxSizing: style.boxSizing, padding: style.padding, border: style.border, overflowY: "hidden",
      font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing
    });
    document.body.append(probe);
    messageGrowCap = probe.scrollHeight;
    probe.remove();
    messageGrowWidth = width;
    messageGrowPrefix = prefix;
    return messageGrowCap;
  };
  const resizeMessage = () => {
    ta.style.height = "auto";
    const value = ta.value;
    if (value.length > MESSAGE_GROW_LIMIT) {
      ta.style.overflowY = "hidden";
      const maxHeight = messageHeightFor(value.slice(0, MESSAGE_GROW_LIMIT));
      ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
      ta.style.overflowY = "auto";
    } else {
      ta.style.overflowY = "hidden";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  };
  resizeMessage();
  window.addEventListener("resize", resizeMessage);
  ta.addEventListener("input", () => {
    cnt.textContent = `${ta.value.length} / ${MESSAGE_LIMIT}`;
    resizeMessage();
  });
  $("#msgForm").addEventListener("submit", async e => {
    e.preventDefault();
    const text = ta.value.trim();
    if (text.length < 5) return toast("Please write a little more.");
    if (text.length > MESSAGE_LIMIT) return toast(`Messages can be up to ${MESSAGE_LIMIT} characters.`);
    $("#messageConfirmText").textContent = text;
    $("#messageConfirm").showModal();
  });
  $("#cancelMessage").addEventListener("click", () => $("#messageConfirm").close());
  $("#confirmMessage").addEventListener("click", async () => {
    const text = $("#messageConfirmText").textContent.trim();
    const button = $("#confirmMessage");
    button.disabled = true;
    try {
      await addDoc(collection(fs, "messages"), { text, status: "pending", date: Date.now() });
      ta.value = ""; cnt.textContent = `0 / ${MESSAGE_LIMIT}`; resizeMessage();
      $("#messageConfirm").close();
      toast("Sent! The admin will review it before it is posted.");
    } catch (err) { console.error(err); toast("Could not send. Please try again."); }
    finally { button.disabled = false; }
  });
}

/* ---------- ADMIN PAGE ---------- */
let unsubs = [];
const openReply = new Set();
const expandedAdminNews = new Set();
const subCourse = new Map();   // course the admin picked for a pending student photo
const imageCourseLocks = new Set();
let adminMessageFilter = "recent";
let adminNewsFilter = "latest";
let adminImageCourse = "all";
function initAdmin() {
  const loginBox = $("#loginBox"), dash = $("#dash");
  $("#officerPosition").innerHTML = `<option value="">Choose a position…</option>` + POSITIONS.map(p => `<option value="${p.name}">${p.name}${p.max > 1 ? ` (${p.max} seats)` : ""}</option>`).join("");
  $("#imgCourse").innerHTML = `<option value="">Choose a course…</option>` + COURSES.map(c => `<option value="${c.key}">${esc(c.name)}</option>`).join("");
  $("#adminImageTabs").addEventListener("click", e => {
    const chip = e.target.closest("[data-admin-image-course]");
    if (!chip) return;
    adminImageCourse = chip.dataset.adminImageCourse;
    renderAdmin();
  });

  onAuthStateChanged(auth, user => {
    unsubs.forEach(u => u()); unsubs = []; loaded.clear();
    loginBox.classList.toggle("hidden", !!user);
    dash.classList.toggle("hidden", !user);
    if (!user) return;
    unsubs.push(
      watch("news", query(collection(fs, "news"), orderBy("date", "desc")), renderAdmin),
      watch("images", query(collection(fs, "images"), orderBy("date", "desc")), () => { purge(); renderAdmin(); }),
      watch("imageSubmissions", query(collection(fs, "imageSubmissions"), orderBy("date", "desc")), renderAdmin),
      watch("dailyBest", query(collection(fs, "dailyBest"), orderBy("day", "desc")), () => { purge(); renderAdmin(); }),
      watch("officers", query(collection(fs, "officers"), orderBy("createdAt", "asc")), renderOfficersAdmin),
      watch("messages", collection(fs, "messages"), renderAdmin),
      watch("comments", collection(fs, "comments"), renderAdmin),
      watchDocument("contact", doc(fs, "siteContent", "contact"), renderContactAdmin),
      watchDocument("importantAnnouncement", doc(fs, "siteContent", "importantAnnouncement"), renderImportantAdmin, null),
      watchDocument("newsPopupSettings", doc(fs, "siteContent", "newsPopupSettings"), renderNewsPopupSettings, { lockSeconds: LOCK_SECONDS })
    );
  });

  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, $("#user").value.trim(), $("#pass").value);
      $("#loginErr").textContent = ""; $("#pass").value = "";
    } catch (err) {
      console.error(err);
      $("#loginErr").textContent = "Incorrect username or password. Check your Firebase Auth account and try again.";
    }
  });
  $("#logout").addEventListener("click", e => { e.preventDefault(); signOut(auth); });
  $("#settingsBtn").addEventListener("click", () => {
    const user = auth.currentUser;
    if (!user) return toast("Log in before changing account settings.");
    $("#currentAdminEmail").textContent = `Current username/email: ${user.email || "Unavailable"}`;
    $("#currentPassword").value = "";
    $("#newEmail").value = "";
    $("#newPassword").value = "";
    $("#confirmNewPassword").value = "";
    $("#settingsError").textContent = "";
    $("#settingsDialog").showModal();
  });
  $("#cancelSettings").addEventListener("click", () => $("#settingsDialog").close());
  $("#settingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    const user = auth.currentUser;
    const currentPassword = $("#currentPassword").value;
    const email = $("#newEmail").value.trim();
    const password = $("#newPassword").value;
    const confirmPassword = $("#confirmNewPassword").value;
    const error = $("#settingsError"), save = $("#saveSettings");
    error.textContent = "";
    if (!user || !user.email) {
      error.textContent = "Could not identify the signed-in Firebase account.";
      return;
    }
    if (!email && !password) {
      error.textContent = "Enter a new email, a new password, or both.";
      return;
    }
    if (password && password.length < 6) {
      error.textContent = "The new password must be at least 6 characters.";
      return;
    }
    if (password !== confirmPassword) {
      error.textContent = "The new passwords do not match.";
      return;
    }
    if (email && email.toLowerCase() !== user.email.toLowerCase()
      && !confirm("Changing your email requires updating the admin email in firestore.rules and publishing those rules. Continue?")) return;
    save.disabled = true;
    let passwordChanged = false;
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
      if (password) {
        await updatePassword(user, password);
        passwordChanged = true;
      }
      if (email && email.toLowerCase() !== user.email.toLowerCase()) {
        await updateEmail(user, email);
        $("#currentAdminEmail").textContent = `Current username/email: ${user.email}`;
        error.textContent = "Email updated. Now update the admin email in firestore.rules and publish the rules before continuing admin work.";
        $("#currentPassword").value = "";
        $("#newEmail").value = "";
        $("#newPassword").value = "";
        $("#confirmNewPassword").value = "";
        return;
      }
      $("#settingsDialog").close();
      toast(password ? "Password updated." : "No account changes were needed.");
    } catch (err) {
      console.error(err);
      const reason = err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
        ? "Current password is incorrect."
        : err.code === "auth/email-already-in-use"
          ? "That email is already used by another Firebase account."
          : err.code === "auth/invalid-email"
            ? "Enter a valid email address."
            : err.code === "auth/requires-recent-login"
              ? "Please log out, log back in, then try changing your account details again."
              : "Could not update account details. Check the email and password requirements, then try again.";
      error.textContent = passwordChanged ? `Password was updated, but the email change failed. ${reason}` : reason;
    } finally { save.disabled = false; }
  });

  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll(".tabpane").forEach(p => p.classList.toggle("hidden", p.id !== b.dataset.tab));
  }));
  $("#newsPopupSettingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    const seconds = Number($("#newsPopupLockSeconds").value);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) {
      return toast("Choose a lock duration from 1 to 86400 seconds.");
    }
    const button = $("#saveNewsPopupSettings");
    button.disabled = true;
    try {
      await setDoc(doc(fs, "siteContent", "newsPopupSettings"), { lockSeconds: seconds });
      state.newsPopupSettings = { lockSeconds: seconds };
      toast(`News pop-up timer saved: ${secs(seconds)}.`);
    } catch (err) {
      console.error("Could not save news pop-up timer:", err);
      toast("Could not save the timer. Check your connection and that you are logged in.");
    } finally { button.disabled = false; }
  });
  $(".admin-message-filters").addEventListener("click", e => {
    const button = e.target.closest("[data-admin-filter]");
    if (!button) return;
    adminMessageFilter = button.dataset.adminFilter;
    $(".admin-message-filters").querySelectorAll("[data-admin-filter]").forEach(item => item.setAttribute("aria-pressed", item === button));
    renderAdmin();
  });
  $(".admin-message-views").addEventListener("click", e => {
    const button = e.target.closest("[data-message-view]");
    if (!button) return;
    const posted = button.dataset.messageView === "posted";
    $("#postedMessages").classList.toggle("hidden", !posted);
    $("#unpostedMessages").classList.toggle("hidden", posted);
    $(".admin-message-filters").classList.toggle("hidden", !posted);
    $(".admin-message-views").querySelectorAll("[data-message-view]").forEach(item => item.setAttribute("aria-pressed", item === button));
  });
  $("#newsSort").addEventListener("click", e => {
    const button = e.target.closest("[data-content-sort]");
    if (!button || button.disabled) return;
    adminNewsFilter = button.dataset.contentSort;
    $("#newsSort").querySelectorAll("[data-content-sort]").forEach(item => item.setAttribute("aria-pressed", item === button));
    renderAdmin();
  });
  $("#newsList").addEventListener("click", e => {
    const button = e.target.closest("[data-news-expand]");
    if (!button) return;
    const id = button.dataset.newsExpand;
    expandedAdminNews.has(id) ? expandedAdminNews.delete(id) : expandedAdminNews.add(id);
    renderAdmin();
  });

  $("#newsForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const files = [...$("#nimg").files];
      if (files.length > 5) return toast("Choose no more than 5 images for one news post.");
      const images = await Promise.all(files.map(file => compress(file, 800, 70000)));
      const now = Date.now();
      const news = { source: $("#source").value, title: $("#ntitle").value.trim(), body: $("#nbody").value.trim(), images, date: now, expireAt: Timestamp.fromMillis(now + DAY) };
      if (new TextEncoder().encode(JSON.stringify(news)).length > 950000) {
        return toast("The news text or selected images are too large. Shorten the details or use smaller images.");
      }
      await addDoc(collection(fs, "news"), news);
      e.target.reset(); toast("Posted. It will stay up for 24 hours.");
    } catch (err) {
      console.error(err);
      toast(err.message === "news-image-too-large"
        ? "One of the selected images could not be compressed enough. Choose a smaller image."
        : "Could not post. Check the images and that you are logged in.");
    }
  });

  $("#importantAnnouncementForm").addEventListener("submit", async e => {
    e.preventDefault();
    const title = $("#importantTitle").value.trim();
    const body = $("#importantBody").value.trim();
    const durationSeconds = Number($("#importantDuration").value);
    const imageFile = $("#importantImage").files[0];
    const removeImage = $("#removeImportantImage").checked;
    if (!title || !body) return toast("Enter a title and announcement.");
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 86400) {
      return toast("Choose a lock duration from 1 to 86400 seconds.");
    }
    const button = $("#saveImportantAnnouncement");
    button.disabled = true;
    try {
      let image = editingImportant && state.importantAnnouncement && state.importantAnnouncement.image || "";
      if (imageFile) image = await compress(imageFile, 1000, 650000);
      else if (removeImage) image = "";
      const now = Date.now();
      const announcement = {
        title,
        body,
        durationSeconds,
        publishedAt: now,
        lockUntil: now + durationSeconds * 1000
      };
      if (image) announcement.image = image;
      if (new TextEncoder().encode(JSON.stringify(announcement)).length > 950000) {
        return toast("The announcement or image is too large. Shorten the text or use a smaller image.");
      }
      await setDoc(doc(fs, "siteContent", "importantAnnouncement"), announcement);
      editingImportant = false;
      e.target.reset();
      toast("Important announcement published. The student-page pop-up timer has started.");
    } catch (err) {
      console.error("Could not publish important announcement:", err);
      toast(err.message === "news-image-too-large"
        ? "The image could not be compressed enough. Choose a smaller image."
        : "Could not publish. Check your connection and that you are logged in.");
    } finally { button.disabled = false; }
  });
  $("#importantAnnouncementPreview").addEventListener("click", e => { if (e.target.closest("[data-important-edit]")) startImportantEdit(); });
  $("#cancelImportantEdit").addEventListener("click", () => { editingImportant = false; renderImportantAdmin(); });
  $("#deleteImportantAnnouncement").addEventListener("click", async () => {
    if (!state.importantAnnouncement || !confirm("Delete the important announcement from the student page?")) return;
    const button = $("#deleteImportantAnnouncement");
    button.disabled = true;
    try {
      await deleteDoc(doc(fs, "siteContent", "importantAnnouncement"));
      toast("Important announcement deleted.");
    } catch (err) {
      console.error("Could not delete important announcement:", err);
      toast("Could not delete the announcement. Check your connection and that you are logged in.");
    } finally { button.disabled = false; }
  });

  $("#imgForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = $("#file").files[0]; if (!f) return toast("Choose an image first.");
    const course = $("#imgCourse").value; if (!COURSE[course]) return toast("Choose a course for this photo.");
    if (!loaded.has("images")) return toast("Wait for posted photos to finish loading before adding another.");
    if (imageCourseLocks.has(course)) return toast("A photo is already being posted to this course. Try again shortly.");
    if (liveImageCountForCourse(course) >= MAX_IMAGES_PER_COURSE)
      return toast(`${COURSE[course].short} already has 6 active photos. Delete one or wait for one to expire.`);
    imageCourseLocks.add(course);
    const button = e.submitter || e.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const src = await compress(f, 900), now = Date.now();
      const image = { src, caption: $("#caption").value.trim(), course, date: now, expireAt: Timestamp.fromMillis(now + DAY) };
      const ref = await addDoc(collection(fs, "images"), image);
      state.images = [...state.images, { ...image, id: ref.id }];
      renderAdmin();
      e.target.reset(); toast("Posted. It will stay up for 24 hours.");
    } catch (err) { console.error(err); toast("Could not post that image."); }
    finally { imageCourseLocks.delete(course); button.disabled = false; }
  });

  async function saveContact(next) {
    if (new TextEncoder().encode(JSON.stringify(next)).length > 950000) throw new Error("contact-too-large");
    await setDoc(doc(fs, "siteContent", "contact"), next);
    state.contact = next; renderContactAdmin();
  }
  const contactErr = err => { console.error(err); toast(err.message === "contact-too-large" ? "Too many or too large QR images. Delete one or use smaller images." : "Could not save contact details. Check the image and that you are logged in."); };

  $("#qrForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = $("#qrFile").files[0], title = $("#qrTitle").value.trim();
    if (!f) return toast("Choose a QR code image first.");
    if (!title) return toast("Enter a title for this QR code.");
    const linkInput = $("#qrLink").value.trim(), link = safeWebLink(linkInput);
    if (linkInput && !link) return toast("Enter a valid http:// or https:// destination URL.");
    const button = $("#saveQr"); button.disabled = true;
    try {
      const { qrCodes, phones } = contactData();
      const src = await compress(f, 1200, 150000);
      await saveContact({ qrCodes: [...qrCodes, { platform: $("#qrPlatform").value, title, src, link }], phones });
      e.target.reset(); toast("QR code added.");
    } catch (err) { contactErr(err); } finally { button.disabled = false; }
  });

  $("#phoneForm").addEventListener("submit", async e => {
    e.preventDefault();
    const title = $("#phoneTitle").value.trim(), number = $("#phoneNumber").value.trim();
    if (!title || !number) return toast("Enter a title and a phone number.");
    if (!validPhone(number)) return toast("Use digits and optional +, spaces, parentheses, periods, or hyphens.");
    const button = $("#savePhone"); button.disabled = true;
    try {
      const { qrCodes, phones } = contactData();
      await saveContact({ qrCodes, phones: [...phones, { title, number }] });
      e.target.reset(); toast("Phone number added.");
    } catch (err) { contactErr(err); } finally { button.disabled = false; }
  });

  $("#contactPreview").addEventListener("click", async e => {
    const b = e.target.closest("[data-cact]"); if (!b) return;
    const i = +b.dataset.i, act = b.dataset.cact, { qrCodes, phones } = contactData();
    try {
      if (act === "delqr") { if (!confirm("Delete this QR code?")) return; qrCodes.splice(i, 1); }
      else if (act === "delphone") { if (!confirm("Delete this phone number?")) return; phones.splice(i, 1); }
      else if (act === "editqr") {
        const t = prompt("QR code title", qrCodes[i].title); if (t === null || !t.trim()) return;
        qrCodes[i].title = t.trim();
      } else if (act === "editlink") {
        const value = prompt("QR code destination URL (leave blank to clear)", qrCodes[i].link || "");
        if (value === null) return;
        const input = value.trim(), link = safeWebLink(input);
        if (input && !link) return toast("Enter a valid http:// or https:// destination URL.");
        qrCodes[i].link = link;
      } else if (act === "editphone") {
        const t = prompt("Title", phones[i].title); if (t === null || !t.trim()) return;
        const n = prompt("Phone number", phones[i].number); if (n === null || !n.trim()) return;
        if (!validPhone(n.trim())) return toast("Use digits and optional +, spaces, parentheses, periods, or hyphens.");
        phones[i] = { title: t.trim(), number: n.trim() };
      } else return;
      await saveContact({ qrCodes, phones }); toast("Saved.");
    } catch (err) { contactErr(err); }
  });

  dash.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const { act, id } = b.dataset;
    try {
      if (act === "reply") { openReply.has(id) ? openReply.delete(id) : openReply.add(id); return renderAdmin(); }
      if (act === "cancelreply") { openReply.delete(id); return renderAdmin(); }
      if (act === "savereply") {
        const text = $("#rep-" + id).value.trim(); if (!text) return toast("Write a reply first.");
        const m = state.messages.find(x => x.id === id);
        const wasPosted = m && m.status === "approved";
        if (!wasPosted && !confirm("Sending a reply also posts this message on the student page for 24 hours. Continue?")) return;
        const patch = { reply: text, repliedAt: Date.now() };
        if (!wasPosted) Object.assign(patch, postFields());
        await updateDoc(doc(fs, "messages", id), patch);
        if (!wasPosted) await syncCommentExpiry(id, patch.expireAt);
        openReply.delete(id); return toast("Reply posted.");
      }
      if (act === "delreply") { if (!confirm("Remove your reply?")) return; return await updateDoc(doc(fs, "messages", id), { reply: "" }); }
      if (act === "approveimg") {
        const submission = state.imageSubmissions.find(image => image.id === id);
        if (!submission) return toast("That photo submission is no longer available.");
        const course = subCourse.get(id) || submission.course || "";
        if (!COURSE[course]) return toast("Choose a course for this photo before approving it.");
        if (!loaded.has("images")) return toast("Wait for posted photos to finish loading before approving another.");
        if (imageCourseLocks.has(course)) return toast("A photo is already being posted to this course. Try again shortly.");
        if (liveImageCountForCourse(course) >= MAX_IMAGES_PER_COURSE)
          return toast(`${COURSE[course].short} already has 6 active photos. Choose another course or wait for one to expire.`);
        imageCourseLocks.add(course);
        try {
          const batch = writeBatch(fs), now = Date.now();
          const imageRef = doc(collection(fs, "images"));
          const image = {
            src: submission.src,
            caption: submission.caption || "",
            course,
            date: now,
            expireAt: Timestamp.fromMillis(now + DAY)
          };
          batch.set(imageRef, image);
          batch.delete(doc(fs, "imageSubmissions", id));
          await batch.commit();
          state.images = [...state.images, { ...image, id: imageRef.id }];
          state.imageSubmissions = state.imageSubmissions.filter(item => item.id !== id);
          subCourse.delete(id);
          renderAdmin();
        } finally { imageCourseLocks.delete(course); }
        return toast("Photo approved and published for 24 hours.");
      }
      if (act === "rejectimg") {
        if (!confirm("Reject and delete this photo submission?")) return;
        await deleteDoc(doc(fs, "imageSubmissions", id));
        return toast("Photo submission rejected.");
      }
      if (act.startsWith("del")) {
        if (!confirm("Delete this? This cannot be undone.")) return;
        const col = act === "delnews" ? "news" : act === "delimg" ? "images" : act === "delsubmission" ? "imageSubmissions" : act === "delcomment" ? "comments" : act === "delbest" ? "dailyBest" : act === "delofficer" ? "officers" : "messages";
        if (act === "delmsg") {
          const comments = await getDocs(query(collection(fs, "comments"), where("messageId", "==", id)));
          await Promise.all(comments.docs.map(comment => deleteDoc(comment.ref)));
        }
        return await deleteDoc(doc(fs, col, id));
      }
      if (act === "approvecomment") {
        // An approved comment disappears together with the message it belongs to.
        const c = state.comments.find(x => x.id === id), msg = c && state.messages.find(m => m.id === c.messageId);
        await updateDoc(doc(fs, "comments", id), { status: "approved", expireAt: Timestamp.fromMillis(msg ? expiry(msg) : Date.now() + DAY) });
        return;
      }
      if (act === "rejectcomment") { await updateDoc(doc(fs, "comments", id), { status: "rejected" }); return; }
      if (act === "approve") {
        const f = postFields();
        await updateDoc(doc(fs, "messages", id), f);
        await syncCommentExpiry(id, f.expireAt);
        return toast("Posted. It will stay up for 24 hours.");
      }
      // Reject / unpost: take it off the 24-hour clock until it is posted again.
      await updateDoc(doc(fs, "messages", id), { status: act === "reject" ? "rejected" : "pending", postedAt: deleteField(), expireAt: deleteField() });
    } catch (err) { console.error(err); toast("That action failed."); }
  });

  // Course pickers inside the admin lists
  dash.addEventListener("change", async e => {
    const pending = e.target.closest("[data-subcourse]");
    if (pending) { subCourse.set(pending.dataset.subcourse, pending.value); return; }
    const posted = e.target.closest("[data-imgcourse]"); if (!posted || !COURSE[posted.value]) return;
    const image = state.images.find(item => item.id === posted.dataset.imgcourse);
    if (!image || posted.value === image.course) return;
    const nextCourse = posted.value;
    if (liveImageCountForCourse(nextCourse) >= MAX_IMAGES_PER_COURSE) {
      posted.value = image.course;
      return toast(`${COURSE[nextCourse].short} already has 6 active photos.`);
    }
    if (imageCourseLocks.has(nextCourse)) {
      posted.value = image.course;
      return toast("A photo is already being posted to this course. Try again shortly.");
    }
    imageCourseLocks.add(nextCourse);
    try {
      await updateDoc(doc(fs, "images", posted.dataset.imgcourse), { course: nextCourse });
      state.images = state.images.map(item => item.id === image.id ? { ...item, course: nextCourse } : item);
      renderAdmin(); toast("Course updated.");
    } catch (err) {
      console.error(err); posted.value = image.course;
      toast("Could not change the course.");
    } finally { imageCourseLocks.delete(nextCourse); }
  });

  /* SSC officers */
  const officerForm = $("#officerForm");
  function resetOfficerForm() {
    editingOfficer = null; officerForm.reset(); refreshPositionOptions();
    $("#officerPhoto").required = true; $("#officerPhotoHint").textContent = "";
    $("#officerFormTitle").textContent = "Add an officer"; $("#saveOfficer").textContent = "Save officer";
    $("#cancelOfficerEdit").classList.add("hidden"); $("#officerQrRemoveLabel").classList.add("hidden");
  }
  $("#cancelOfficerEdit").addEventListener("click", resetOfficerForm);
  officerForm.addEventListener("submit", async e => {
    e.preventDefault();
    const val = sel => $(sel).value.trim();
    const existing = editingOfficer && state.officers.find(o => o.id === editingOfficer);
    const photoFile = $("#officerPhoto").files[0], qrFile = $("#officerQr").files[0];
    if (!existing && !photoFile) return toast("Choose a portrait photo.");
    const position = val("#officerPosition"), pos = POSITIONS.find(p => p.name === position);
    if (!pos) return toast("Choose a position.");
    if (state.officers.filter(o => o.position === position && o.id !== editingOfficer).length >= pos.max)
      return toast(pos.max === 1 ? `There is already a ${position}. Edit or delete that officer first.` : `All ${pos.max} ${position} seats are filled.`);
    const email = val("#officerEmail");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("Enter a valid email address or leave it blank.");
    const button = $("#saveOfficer"); button.disabled = true;
    try {
      const photo = photoFile ? await compress(photoFile, 600, 110000) : existing.photo;
      let qr = existing ? existing.qr || "" : "";
      if (qrFile) qr = await compress(qrFile, 700, 90000); else if ($("#removeOfficerQr").checked) qr = "";
      const data = {
        firstName: val("#officerFirst"), middleName: val("#officerMiddle"), lastName: val("#officerLast"),
        position, level: pos.level,
        bio: val("#officerBio"), message: val("#officerMessage"), email, qr, qrPlatform: $("#officerQrPlatform").value, photo,
        createdAt: existing ? existing.createdAt || Date.now() : Date.now()
      };
      if (existing) await setDoc(doc(fs, "officers", existing.id), data); else await addDoc(collection(fs, "officers"), data);
      toast(existing ? "Officer updated." : "Officer added.");
      resetOfficerForm();
    } catch (err) {
      console.error("Could not save officer:", err);
      toast("Could not save. Check the images (use smaller ones) and that you are logged in.");
    } finally { button.disabled = false; }
  });
  $("#officerList").addEventListener("click", e => {
    const b = e.target.closest("[data-oact=edit]"); if (!b) return;
    const o = state.officers.find(x => x.id === b.dataset.id); if (!o) return;
    editingOfficer = o.id; officerForm.reset(); refreshPositionOptions();
    $("#officerFirst").value = o.firstName || ""; $("#officerMiddle").value = o.middleName || ""; $("#officerLast").value = o.lastName || "";
    $("#officerPosition").value = o.position || "";
    $("#officerBio").value = o.bio || ""; $("#officerQrPlatform").value = SOCIALS[o.qrPlatform] ? o.qrPlatform : "facebook"; $("#officerMessage").value = o.message || ""; $("#officerEmail").value = o.email || "";
    $("#officerPhoto").required = false; $("#officerPhotoHint").textContent = "Leave empty to keep the current photo.";
    $("#officerQrRemoveLabel").classList.toggle("hidden", !o.qr);
    $("#officerFormTitle").textContent = "Edit officer"; $("#saveOfficer").textContent = "Save changes";
    $("#cancelOfficerEdit").classList.remove("hidden");
    officerForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// Images are stored inside Firestore (1 MB limit per document), so shrink them first.
function compress(file, max = 900, maxLength = 900000) {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onerror = rej;
    r.onload = () => {
      const img = new Image(); img.onerror = rej;
      img.onload = () => {
        let scale = Math.min(1, max / Math.max(img.width, img.height)), quality = 0.78;
        const c = document.createElement("canvas");
        const encode = () => {
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          const ctx = c.getContext("2d");
          if (!ctx) return rej(new Error("Could not process image"));
          ctx.drawImage(img, 0, 0, c.width, c.height);
          const out = c.toDataURL("image/jpeg", quality);
          if (out.length <= maxLength) return res(out);
          if (quality > 0.34) quality -= 0.12;
          else if (scale > 0.3) { scale *= 0.8; quality = 0.78; }
          else return rej(new Error(maxLength < 900000 ? "news-image-too-large" : "too large"));
          encode();
        };
        encode();
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// Posting a message starts its 24-hour clock.
const postFields = () => { const now = Date.now(); return { status: "approved", postedAt: now, expireAt: Timestamp.fromMillis(now + DAY) }; };
async function syncCommentExpiry(messageId, expireAt) {
  const cs = await getDocs(query(collection(fs, "comments"), where("messageId", "==", messageId)));
  await Promise.all(cs.docs.filter(c => c.data().status === "approved").map(c => updateDoc(c.ref, { expireAt })));
}

function adminNewsBody(n) {
  const p = preview(n.body), open = expandedAdminNews.has(n.id);
  return `<p class="admin-news-body"><span class="short"${open ? " hidden" : ""}>${esc(p.short)}</span>${p.cut ? `<span class="full"${open ? "" : " hidden"}>${esc(n.body)}</span><button class="more" type="button" data-news-expand="${n.id}" aria-expanded="${open}">${open ? "See less" : "See more"}</button>` : ""}</p>`;
}

function renderAdmin() {
  purge();
  const sortByReactions = (items, filter) => {
    if (filter === "liked") return items.sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.date - a.date);
    if (filter === "disliked") return items.sort((a, b) => (b.dislikes || 0) - (a.dislikes || 0) || b.date - a.date);
    return items.sort(byDate);
  };
  const sortedNews = sortByReactions(state.news.filter(isLive), adminNewsFilter);
  const news = adminNewsFilter === "latest" ? sortedNews.slice(0, 3) : sortedNews;
  const now = Date.now();
  const imgs = state.images.filter(i => expiry(i) > now)
    .sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.date - a.date);
  const countForCourse = course => imgs.filter(image => image.course === course).length;
  $("#adminImageTabs").innerHTML = [
    `<button class="cat-chip" type="button" role="tab" data-admin-image-course="all" aria-selected="${adminImageCourse === "all"}"><span>All courses</span><b>${imgs.length}</b></button>`,
    ...COURSES.map(course => `<button class="cat-chip" type="button" role="tab" data-admin-image-course="${course.key}" aria-selected="${adminImageCourse === course.key}"><span>${esc(course.short)}</span><b>${countForCourse(course.key)}</b></button>`)
  ].join("");
  $("#adminImageCategory").textContent = adminImageCourse === "all" ? "Photos from every course" : COURSE[adminImageCourse].name;
  const visibleImgs = adminImageCourse === "all" ? imgs : imgs.filter(image => image.course === adminImageCourse);
  $("#newsList").innerHTML = news.length ? news.map(n => `
    <div class="row"><div style="flex:1;min-width:0"><div class="meta"><span class="${tagClass(n.source)}">${esc(n.source)}</span>${fmt(n.date)} · ${n.likes || 0} likes · ${n.dislikes || 0} dislikes</div>
    <strong>${esc(n.title)}</strong>${newsImageHTML(n, "thumb")}
    ${adminNewsBody(n)}</div>
    <div class="actions"><button class="btn danger sm" data-act="delnews" data-id="${n.id}">Delete</button></div></div>`).join("") : `<div class="empty">No news posted.</div>`;

  $("#imgList").innerHTML = visibleImgs.length ? visibleImgs.map(i => `
    <div class="row posted-image-card" data-up="${i.date}" data-exp="${expiry(i)}">
      <img class="thumb" src="${esc(i.src)}" alt="">
      <div class="posted-image-info"><strong class="posted-image-caption">${esc(i.caption || "(no caption)")}</strong>${stampHTML(i)}<div class="meta">${i.likes || 0} likes</div></div>
      <div class="posted-image-controls">${courseSelectHTML("data-imgcourse", i.id, i.course, !COURSE[i.course])}
        <div class="actions"><button class="btn danger sm" data-act="delimg" data-id="${i.id}">Delete</button></div>
      </div>
    </div>`).join("") : `<div class="empty">${adminImageCourse === "all" ? "No photos are up right now." : "No photos are up for this course."}</div>`;
  $("#imageSubmissions").innerHTML = state.imageSubmissions.length ? state.imageSubmissions.map(i => `
    <div class="row"><div style="display:flex;gap:12px;align-items:center;min-width:0"><img class="thumb" src="${esc(i.src)}" alt="Submitted photo preview">
    <div style="min-width:0">${esc(i.caption || "(no caption)")}<div class="meta">${fmt(i.date)} · Pending approval</div>
    <div class="meta">Student chose: ${COURSE[i.course] ? esc(COURSE[i.course].name) : "no course"}</div>${courseSelectHTML("data-subcourse", i.id, subCourse.get(i.id) || i.course, !COURSE[subCourse.get(i.id) || i.course])}</div></div>
    <div class="actions"><button class="btn ok sm" data-act="approveimg" data-id="${i.id}">Approve</button><button class="btn danger sm" data-act="rejectimg" data-id="${i.id}">Reject</button></div></div>`).join("") : `<div class="empty">No student photo submissions to review.</div>`;
  const month = monthKey(now), winners = state.dailyBest.filter(d => d.month === month).sort((a, b) => (a.day < b.day ? 1 : -1));
  $("#dailyWinnersNote").textContent = `Each day's most-liked photo is saved before it expires. All of ${monthName(month)}'s winners are highlighted on the student page for 24 hours on the last day of the month (${dayLabel(month + "-" + String(lastDayOf(month)).padStart(2, "0"))}). Keep this admin page open or visit it regularly so photos get saved.`;
  $("#dailyWinners").innerHTML = winners.length ? winners.map(w => `
    <div class="row"><div style="display:flex;gap:12px;align-items:center;min-width:0"><img class="thumb" src="${esc(w.src)}" alt="">
    <div style="min-width:0"><strong>${dayLabel(w.day)}</strong> · ♥ ${w.likes || 0} like${w.likes === 1 ? "" : "s"}<div class="meta">${COURSE[w.course] ? esc(COURSE[w.course].name) : "No course"}${w.caption ? " · " + esc(w.caption) : ""}</div></div></div>
    <div class="actions"><button class="btn danger sm" data-act="delbest" data-id="${w.id}">Remove</button></div></div>`).join("") : `<div class="empty">No daily winners saved yet this month.</div>`;
  stamps();

  const msgs = state.messages.filter(m => m.status !== "approved" || isLive(m));
  if (adminMessageFilter === "liked") msgs.sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.date - a.date);
  else if (adminMessageFilter === "disliked") msgs.sort((a, b) => (b.dislikes || 0) - (a.dislikes || 0) || b.date - a.date);
  else if (adminMessageFilter === "recent") {
    const order = { pending: 0, approved: 1, rejected: 2 };
    msgs.sort((a, b) => order[a.status] - order[b.status] || b.date - a.date);
  } else msgs.sort(byDate);
  const pend = msgs.filter(m => m.status === "pending").length;
  const posted = msgs.filter(m => m.status === "approved");
  const unposted = msgs.filter(m => m.status !== "approved");
  $("#pendBadge").textContent = pend; $("#pendBadge").classList.toggle("hidden", !pend);
  const comments = [...state.comments].sort((a, b) => {
    const order = { pending: 0, approved: 1, rejected: 2 };
    return order[a.status] - order[b.status] || b.date - a.date;
  });
  const pendingComments = comments.filter(c => c.status === "pending").length;
  $("#commentPendBadge").textContent = pendingComments;
  $("#commentPendBadge").classList.toggle("hidden", !pendingComments);
  const commentsToReview = comments.filter(c => c.status !== "approved");
  $("#commentAdminList").innerHTML = commentsToReview.length ? commentsToReview.map(c => {
    const message = state.messages.find(m => m.id === c.messageId);
    return `<div class="row"><div style="flex:1;min-width:0">
      <span class="status ${esc(c.status)}">${esc(c.status.toUpperCase())}</span> <span class="meta">· ${fmt(c.date)}</span>
      <p>${esc(c.text)}</p>
      <div class="meta">On message: ${esc(message ? preview(message.text).short : "Message no longer available.")}</div>
    </div><div class="actions">
      <button class="btn ok sm" data-act="approvecomment" data-id="${c.id}">Approve</button>
      ${c.status !== "rejected" ? `<button class="btn ghost sm" data-act="rejectcomment" data-id="${c.id}">Reject</button>` : ""}
      <button class="btn danger sm" data-act="delcomment" data-id="${c.id}">Delete</button>
    </div></div>`;
  }).join("") : `<div class="empty">No comments need review.</div>`;
  const messageHTML = m => {
    const approvedComments = comments.filter(c => c.messageId === m.id && c.status === "approved");
    const messageActions = `<div class="actions">
      ${m.status !== "approved" ? `<button class="btn ok sm" data-act="approve" data-id="${m.id}">Post it</button>` : `<button class="btn ghost sm" data-act="pending" data-id="${m.id}">Unpost</button>`}
      <button class="btn sm" data-act="reply" data-id="${m.id}">${m.reply ? "Edit reply" : "Reply"}</button>
      ${m.reply ? `<button class="btn ghost sm" data-act="delreply" data-id="${m.id}">Remove reply</button>` : ""}
      ${m.status !== "rejected" ? `<button class="btn ghost sm" data-act="reject" data-id="${m.id}">Reject</button>` : ""}
      <button class="btn danger sm" data-act="delmsg" data-id="${m.id}">Delete</button></div>`;
    return `
    <div class="row"><div style="flex:1;min-width:0"><span class="status ${m.status}">${m.status.toUpperCase()}</span> <span class="meta">· Sent ${fmtTime(m.date)} · ${m.likes || 0} likes · ${m.dislikes || 0} dislikes</span><p>${esc(m.text)}</p>
      ${m.reply ? `<div class="reply"><strong>Your reply</strong><p>${esc(m.reply)}</p></div>` : ""}
      ${openReply.has(m.id) ? `<textarea id="rep-${m.id}" maxlength="500" placeholder="Write your reply">${esc(m.reply || "")}</textarea>
        <div class="actions" style="margin-top:8px"><button class="btn ok sm" data-act="savereply" data-id="${m.id}">Send reply</button><button class="btn ghost sm" data-act="cancelreply" data-id="${m.id}">Cancel</button></div>` : ""}
      ${approvedComments.length ? messageActions : ""}
      ${approvedComments.length ? `<div class="admin-approved-comments"><strong>Approved comments</strong>${approvedComments.map(c => `
        <div class="admin-approved-comment"><div><p>${esc(c.text)}</p><span class="meta">Anonymous · ${fmt(c.date)}</span></div>
          <div class="actions"><button class="btn ghost sm" data-act="rejectcomment" data-id="${c.id}">Unapprove</button><button class="btn danger sm" data-act="delcomment" data-id="${c.id}">Delete</button></div>
        </div>`).join("")}</div>` : ""}
    </div>
    ${approvedComments.length ? "" : messageActions}</div>`;
  };
  $("#postedMsgList").innerHTML = posted.length ? posted.map(messageHTML).join("") : `<div class="empty">No messages have been posted.</div>`;
  $("#unpostedMsgList").innerHTML = unposted.length ? unposted.map(messageHTML).join("") : `<div class="empty">No pending or rejected messages.</div>`;
}

// The form is in "edit" mode only after the admin presses Edit on the current announcement.
let editingImportant = false;
function syncImportantMode() {
  const announcement = state.importantAnnouncement;
  $("#importantFormTitle").textContent = editingImportant ? "Edit announcement" : "IMPORTANT ANNOUNCEMENT";
  $("#saveImportantAnnouncement").textContent = editingImportant ? "Save edits and restart timer" : "Publish announcement";
  $("#cancelImportantEdit").classList.toggle("hidden", !editingImportant);
  $("#deleteImportantAnnouncement").classList.toggle("hidden", !announcement);
}
function fillImportantForm(announcement) {
  $("#importantTitle").value = announcement ? announcement.title || "" : "";
  $("#importantBody").value = announcement ? announcement.body || "" : "";
  $("#importantImage").value = ""; $("#importantImage").dispatchEvent(new Event("change"));
  $("#removeImportantImage").checked = false;
  $("#importantImageRemoveLabel").classList.toggle("hidden", !(announcement && announcement.image));
  $("#importantDuration").value = announcement ? String(lockSeconds(announcement)) : "30";
}
function startImportantEdit() {
  const announcement = state.importantAnnouncement;
  if (!announcement) return;
  editingImportant = true;
  fillImportantForm(announcement);
  syncImportantMode();
  $("#importantAnnouncementForm").scrollIntoView({ behavior: "smooth", block: "center" });
  $("#importantTitle").focus({ preventScroll: true });
}
function renderImportantAdmin() {
  const announcement = state.importantAnnouncement;
  const previewBox = $("#importantAnnouncementPreview");
  if (!announcement) editingImportant = false;
  if (!editingImportant) fillImportantForm(null);   // never overwrite what is being edited
  syncImportantMode();
  if (!announcement) {
    previewBox.className = "empty";
    previewBox.textContent = "No important announcement is published.";
    return;
  }
  const lockUntil = Number(announcement.lockUntil) || 0;
  previewBox.className = "important-preview";
  previewBox.innerHTML = `<span class="status approved">PUBLISHED</span>
    <h3>${esc(announcement.title || "")}</h3>
    <p>${esc(announcement.body || "")}</p>
    ${announcement.image ? `<img src="${esc(announcement.image)}" alt="${esc(announcement.title || "Important announcement")}">` : ""}
    <div class="meta">Lock duration: ${secs(lockSeconds(announcement))} · Lock end: ${fmtTime(lockUntil || Number(announcement.publishedAt) || Date.now())}</div>
    <div class="important-admin-actions"><button class="btn sm" type="button" data-important-edit>Edit announcement</button></div>`;
}

function renderNewsPopupSettings() {
  const seconds = newsPopupLockSeconds();
  $("#newsPopupLockSeconds").value = String(seconds);
}

let editingOfficer = null;
// Positions that are already taken are locked in the dropdown; press Edit on that officer to change them.
function refreshPositionOptions() {
  const sel = $("#officerPosition"); if (!sel) return;
  POSITIONS.forEach(p => {
    const opt = [...sel.options].find(o => o.value === p.name); if (!opt) return;
    const used = state.officers.filter(o => o.position === p.name && o.id !== editingOfficer).length, full = used >= p.max;
    opt.disabled = full;
    opt.textContent = p.max === 1 ? p.name + (full ? " — already assigned (use Edit)" : "") : `${p.name} (${used}/${p.max} filled)${full ? " — full" : ""}`;
  });
}
function renderOfficersAdmin() {
  refreshPositionOptions();
  const list = sortedOfficers();
  $("#officerList").innerHTML = list.length ? list.map(o => `
    <div class="row"><div style="display:flex;gap:12px;align-items:center;min-width:0"><img class="thumb" src="${esc(o.photo || "")}" alt="">
    <div style="min-width:0"><strong>${esc(officerName(o))}</strong><div class="meta">${esc(o.position || "")} ${officerLevel(o) ? "· Row " + officerLevel(o) : ""}${o.email ? " · " + esc(o.email) : ""}${o.qr ? " · QR: " + (socialOf(o) === "other" ? "Social media" : SOCIALS[socialOf(o)]) : ""}</div></div></div>
    <div class="actions"><button class="btn sm" type="button" data-oact="edit" data-id="${o.id}">Edit</button><button class="btn danger sm" data-act="delofficer" data-id="${o.id}">Delete</button></div></div>`).join("") : `<div class="empty">No officers added yet.</div>`;
}

function renderContactAdmin() {
  $("#contactPreview").innerHTML = contactHTML(true) || `<div class="empty">No contact details have been saved.</div>`;
}

// Replaces every plain "Choose file" button with a "+" tile and shows thumbnails of the chosen photos.
function enhanceFileInputs() {
  document.querySelectorAll("input[type=file]").forEach(input => {
    if (input.closest(".dropzone") || input.dataset.plus) return;
    input.dataset.plus = "1";
    const many = input.multiple;
    const field = document.createElement("div"); field.className = "plus-field";
    const previews = document.createElement("div"); previews.className = "plus-previews";
    const tile = document.createElement("label"); tile.className = "plus-tile";
    tile.innerHTML = `<span class="plus-icon" aria-hidden="true">+</span><span class="plus-text"></span>`;
    input.parentNode.insertBefore(field, input);
    field.append(previews, tile); tile.prepend(input);
    let urls = [];
    const sync = () => {
      urls.forEach(u => URL.revokeObjectURL(u)); urls = []; previews.innerHTML = "";
      const files = [...input.files];
      files.forEach(f => { const u = URL.createObjectURL(f); urls.push(u); const im = document.createElement("img"); im.src = u; im.alt = ""; previews.appendChild(im); });
      $(".plus-text", tile).textContent = files.length ? (many ? "Change photos" : "Change") : (many ? "Add photos" : "Add photo");
    };
    input.addEventListener("change", sync);
    if (input.form) input.form.addEventListener("reset", () => setTimeout(sync));
    sync();
  });
}
enhanceFileInputs();
if (page === "student") initStudent();
if (page === "admin") initAdmin();
