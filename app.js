/* SSC School Site – Firebase version (Firestore + Authentication) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, updateDoc, doc, query, where, orderBy, onSnapshot, Timestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const fs = getFirestore(app);
const auth = getAuth(app);

const DAY = 864e5;        // photos stay up for 24 hours
const LOCK_SECONDS = 30;  // new news stays locked this long
const NEW_DAYS = 7;       // only news newer than this triggers the lock

const page = document.body.dataset.page;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = t => new Date(t).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
const fmtTime = t => new Date(t).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const shortDate = t => new Date(t).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
const ago = ms => { const m = Math.floor(ms / 60000); return m < 1 ? "Just now" : m < 60 ? m + "m" : Math.floor(m / 60) + "h"; };
const tagClass = s => (s === "SSC" ? "tag ssc" : "tag");
const expiry = i => (i.expireAt && i.expireAt.toMillis ? i.expireAt.toMillis() : i.date + DAY);
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
  const col = kind === "m" ? "messages" : "images", key = kind + ":" + id, cur = votes()[key], patch = {};
  const f = t => (t === "like" ? "likes" : "dislikes");
  if (cur === type) { patch[f(type)] = increment(-1); setVote(key, null); }
  else { patch[f(type)] = increment(1); if (cur && kind === "m") patch[f(cur)] = increment(-1); setVote(key, type); }
  try { await updateDoc(doc(fs, col, id), patch); }
  catch (err) { console.error(err); setVote(key, cur || null); toast("Could not save that. Try again."); }
}
function preview(t) {   // first 1-2 sentences, max ~140 characters
  const full = String(t).trim();
  let p = (full.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [full]).slice(0, 2).join("").trim();
  if (p.length > 140) p = p.slice(0, 140).replace(/\s+\S*$/, "");
  const cut = p.length < full.length;
  return { short: cut ? p + "…" : p, cut };
}
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
}

const state = { news: [], images: [], messages: [] };
function watch(name, q, render) {
  return onSnapshot(q, snap => {
    state[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, err => { console.error(err); toast("Could not load data. Check your connection."); });
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
function purge() {   // admin browser deletes photos older than 24h
  if (!auth.currentUser) return;
  const n = Date.now();
  state.images.filter(i => expiry(i) <= n && !purged.has(i.id)).forEach(i => {
    purged.add(i.id); deleteDoc(doc(fs, "images", i.id)).catch(() => purged.delete(i.id));
  });
}
setInterval(() => { purge(); if (stamps()) (page === "student" ? renderGallery : renderAdmin)(); }, 30000);

/* ---------- STUDENT PAGE ---------- */
function renderGallery() {
  const g = $("#gallery"), keep = g.scrollLeft, v = votes();
  const n = Date.now(), list = state.images.filter(i => expiry(i) > n);
  g.innerHTML = list.length ? list.map(i => `
    <figure data-id="${i.id}" data-up="${i.date}" data-exp="${expiry(i)}"><img src="${i.src}" alt="${esc(i.caption || "School photo")}" loading="lazy">
    <figcaption>${stampHTML(i)}</figcaption>${rxBtn("i", i.id, "heart", i.likes, v["i:" + i.id] === "like")}</figure>`).join("") : `<div class="empty">No photos right now. New photos appear here for 24 hours.</div>`;
  g.scrollLeft = keep;
  stamps(); updateArrows();
  const lb = $(".lightbox .rx");   // keep an open full-size photo in sync
  if (lb) { const im = state.images.find(x => x.id === lb.dataset.id); if (im) { const on = v["i:" + im.id] === "like"; $("span", lb).textContent = im.likes || 0; lb.classList.toggle("on", on); lb.setAttribute("aria-pressed", on); } }
}
function updateArrows() {
  const g = $("#gallery"); if (!g) return;
  const more = g.scrollWidth > g.clientWidth + 4;
  $(".arrow.prev").hidden = !more || g.scrollLeft < 4;
  $(".arrow.next").hidden = !more || g.scrollLeft + g.clientWidth >= g.scrollWidth - 4;
}

/* locked "new news" pop-up */
let gateOpen = false;
const readSet = () => { try { return new Set(JSON.parse(localStorage.getItem("ssc_read") || "[]")); } catch (e) { return new Set(); } };
const markRead = id => { const s = readSet(); s.add(id); try { localStorage.setItem("ssc_read", JSON.stringify([...s])); } catch (e) {} };
function checkGate() {
  if (gateOpen) return;
  const read = readSet(), cutoff = Date.now() - NEW_DAYS * DAY;
  const n = state.news.find(x => !read.has(x.id) && x.date > cutoff);
  if (n) openGate(n);
}
function openGate(n) {
  gateOpen = true; document.body.style.overflow = "hidden";
  const g = document.createElement("div"); g.className = "gate";
  g.innerHTML = `<div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gt" tabindex="-1">
    <div class="gate-head"><span class="${tagClass(n.source)}">${esc(n.source)}</span><span class="meta">New announcement · ${fmt(n.date)}</span></div>
    <div class="gate-body"><h2 id="gt">${esc(n.title)}</h2>${n.image ? `<img src="${n.image}" alt="">` : ""}<p>${esc(n.body)}</p></div>
    <div class="gate-foot"><div class="bar"><i></i></div><button class="btn" disabled></button></div></div>`;
  document.body.appendChild(g);
  const body = $(".gate-body", g), btn = $("button", g), bar = $(".bar i", g);
  let left = LOCK_SECONDS, scrolled = false;
  const atEnd = () => body.scrollTop + body.clientHeight >= body.scrollHeight - 6;
  const update = () => {
    if (!scrolled && atEnd()) scrolled = true;
    const ok = left <= 0 && scrolled;
    btn.disabled = !ok;
    btn.textContent = ok ? "I've read it" : left > 0 ? `Keep reading… ${left}s` : "Scroll to the end to continue";
    bar.style.width = ((LOCK_SECONDS - left) / LOCK_SECONDS * 100) + "%";
  };
  body.addEventListener("scroll", update);
  const im = $("img", body); if (im) im.addEventListener("load", () => { scrolled = false; update(); });
  const t = setInterval(() => { if (!document.hidden && left > 0) { left--; update(); } }, 1000);
  btn.onclick = () => { clearInterval(t); markRead(n.id); g.remove(); document.body.style.overflow = ""; gateOpen = false; checkGate(); };
  update(); $(".gate-card", g).focus();
}

function initStudent() {
  watch("news", query(collection(fs, "news"), orderBy("date", "desc")), () => {
    $("#news").innerHTML = state.news.length ? state.news.map(n => `
      <article class="news-item">
        <div class="meta"><span class="${tagClass(n.source)}">${esc(n.source)}</span>${fmt(n.date)}</div>
        <h3>${esc(n.title)}</h3>${n.image ? `<img src="${n.image}" alt="">` : ""}<p>${esc(n.body)}</p></article>`).join("") : `<div class="empty">Nothing posted yet. Check back soon.</div>`;
    checkGate();
  });
  watch("images", query(collection(fs, "images"), orderBy("date", "desc")), renderGallery);

  const two = t => { const v = preview(t); return `<span class="short">${esc(v.short)}</span><span class="full">${esc(t)}</span>`; };
  const expanded = new Set();
  const drawWall = () => {
    const v = votes(), posted = [...state.messages].sort(byDate);
    $("#wall").innerHTML = posted.length ? posted.map(m => {
      const cut = preview(m.text).cut || (m.reply && preview(m.reply).cut), open = expanded.has(m.id);
      return `<div class="note${open ? " open" : ""}" data-id="${m.id}"><p>${two(m.text)}</p><div class="meta">Anonymous · ${fmt(m.date)}</div>
        ${m.reply ? `<div class="reply"><strong>Admin replied</strong><p>${two(m.reply)}</p></div>` : ""}
        <div class="react">${rxBtn("m", m.id, "like", m.likes, v["m:" + m.id] === "like")}${rxBtn("m", m.id, "dislike", m.dislikes, v["m:" + m.id] === "dislike")}</div>
        ${cut ? `<button class="more" type="button" aria-expanded="${open}">${open ? "Show less" : "Show more"}</button>` : ""}</div>`;
    }).join("") : `<div class="empty">No approved messages yet. Be the first to send one.</div>`;
  };
  watch("messages", query(collection(fs, "messages"), where("status", "==", "approved")), drawWall);
  $("#wall").addEventListener("click", e => {
    const rx = e.target.closest(".rx"); if (rx) { react("m", rx.dataset.id, rx.dataset.rx); return; }
    const b = e.target.closest(".more"); if (!b) return;
    const note = b.closest(".note"), open = note.classList.toggle("open");
    open ? expanded.add(note.dataset.id) : expanded.delete(note.dataset.id);
    b.textContent = open ? "Show less" : "Show more"; b.setAttribute("aria-expanded", open);
  });

  const g = $("#gallery");
  g.addEventListener("click", e => {
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
  $(".arrow.prev").onclick = () => g.scrollBy({ left: -g.clientWidth, behavior: "smooth" });
  $(".arrow.next").onclick = () => g.scrollBy({ left: g.clientWidth, behavior: "smooth" });
  g.addEventListener("scroll", updateArrows); window.addEventListener("resize", updateArrows);

  const ta = $("#msg"), cnt = $("#count");
  ta.addEventListener("input", () => cnt.textContent = `${ta.value.length} / 500`);
  $("#msgForm").addEventListener("submit", async e => {
    e.preventDefault();
    const text = ta.value.trim();
    if (text.length < 5) return toast("Please write a little more.");
    try {
      await addDoc(collection(fs, "messages"), { text, status: "pending", date: Date.now() });
      ta.value = ""; cnt.textContent = "0 / 500";
      toast("Sent! The admin will review it before it is posted.");
    } catch (err) { console.error(err); toast("Could not send. Please try again."); }
  });
}

/* ---------- ADMIN PAGE ---------- */
let unsubs = [];
const openReply = new Set();
function initAdmin() {
  const loginBox = $("#loginBox"), dash = $("#dash");

  onAuthStateChanged(auth, user => {
    unsubs.forEach(u => u()); unsubs = [];
    loginBox.classList.toggle("hidden", !!user);
    dash.classList.toggle("hidden", !user);
    if (!user) return;
    unsubs.push(
      watch("news", query(collection(fs, "news"), orderBy("date", "desc")), renderAdmin),
      watch("images", query(collection(fs, "images"), orderBy("date", "desc")), () => { purge(); renderAdmin(); }),
      watch("messages", collection(fs, "messages"), renderAdmin)
    );
  });

  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, $("#user").value.trim(), $("#pass").value);
      $("#loginErr").textContent = ""; $("#pass").value = "";
    } catch (err) { $("#loginErr").textContent = "Wrong email or password. Try again."; }
  });
  $("#logout").addEventListener("click", e => { e.preventDefault(); signOut(auth); });

  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll(".tabpane").forEach(p => p.classList.toggle("hidden", p.id !== b.dataset.tab));
  }));

  $("#newsForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const f = $("#nimg").files[0];
      const image = f ? await compress(f, 800) : "";
      await addDoc(collection(fs, "news"), { source: $("#source").value, title: $("#ntitle").value.trim(), body: $("#nbody").value.trim(), image, date: Date.now() });
      e.target.reset(); toast("Posted.");
    } catch (err) { console.error(err); toast("Could not post. Check the image and that you are logged in."); }
  });

  $("#imgForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = $("#file").files[0]; if (!f) return toast("Choose an image first.");
    try {
      const src = await compress(f, 900), now = Date.now();
      await addDoc(collection(fs, "images"), { src, caption: $("#caption").value.trim(), date: now, expireAt: Timestamp.fromMillis(now + DAY) });
      e.target.reset(); toast("Posted. It will stay up for 24 hours.");
    } catch (err) { console.error(err); toast("Could not post that image."); }
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
        if (m && m.status !== "approved" && !confirm("Sending a reply also posts this message on the student page. Continue?")) return;
        await updateDoc(doc(fs, "messages", id), { reply: text, repliedAt: Date.now(), status: "approved" });
        openReply.delete(id); return toast("Reply posted.");
      }
      if (act === "delreply") { if (!confirm("Remove your reply?")) return; return await updateDoc(doc(fs, "messages", id), { reply: "" }); }
      if (act.startsWith("del")) {
        if (!confirm("Delete this? This cannot be undone.")) return;
        const col = act === "delnews" ? "news" : act === "delimg" ? "images" : "messages";
        return await deleteDoc(doc(fs, col, id));
      }
      const status = act === "approve" ? "approved" : act === "reject" ? "rejected" : "pending";
      await updateDoc(doc(fs, "messages", id), { status });
    } catch (err) { console.error(err); toast("That action failed."); }
  });
}

// Images are stored inside Firestore (1 MB limit per document), so shrink them first.
function compress(file, max = 900) {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onerror = rej;
    r.onload = () => {
      const img = new Image(); img.onerror = rej;
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = img.width * k; c.height = img.height * k;
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL("image/jpeg", 0.7);
        out.length < 900000 ? res(out) : rej(new Error("too large"));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

function renderAdmin() {
  const news = [...state.news].sort(byDate), now = Date.now();
  const imgs = state.images.filter(i => expiry(i) > now).sort(byDate);
  $("#newsList").innerHTML = news.length ? news.map(n => `
    <div class="row"><div style="flex:1;min-width:0"><div class="meta"><span class="${tagClass(n.source)}">${esc(n.source)}</span>${fmt(n.date)}</div>
    <strong>${esc(n.title)}</strong>${n.image ? `<div><img class="thumb" src="${n.image}" alt=""></div>` : ""}<p>${esc(n.body)}</p></div>
    <div class="actions"><button class="btn danger sm" data-act="delnews" data-id="${n.id}">Delete</button></div></div>`).join("") : `<div class="empty">No news posted.</div>`;

  $("#imgList").innerHTML = imgs.length ? imgs.map(i => `
    <div class="row" data-up="${i.date}" data-exp="${expiry(i)}"><div style="display:flex;gap:12px;align-items:center"><img class="thumb" src="${i.src}" alt="">
    <div>${esc(i.caption || "(no caption)")}${stampHTML(i)}<div class="meta">${i.likes || 0} likes</div></div></div>
    <div class="actions"><button class="btn danger sm" data-act="delimg" data-id="${i.id}">Delete now</button></div></div>`).join("") : `<div class="empty">No photos are up right now.</div>`;
  stamps();

  const order = { pending: 0, approved: 1, rejected: 2 };
  const msgs = [...state.messages].sort((a, b) => order[a.status] - order[b.status] || b.date - a.date);
  const pend = msgs.filter(m => m.status === "pending").length;
  $("#pendBadge").textContent = pend; $("#pendBadge").classList.toggle("hidden", !pend);
  $("#msgList").innerHTML = msgs.length ? msgs.map(m => `
    <div class="row"><div style="flex:1;min-width:0"><span class="status ${m.status}">${m.status.toUpperCase()}</span> <span class="meta">· ${fmt(m.date)} · ${m.likes || 0} likes · ${m.dislikes || 0} dislikes</span><p>${esc(m.text)}</p>
      ${m.reply ? `<div class="reply"><strong>Your reply</strong><p>${esc(m.reply)}</p></div>` : ""}
      ${openReply.has(m.id) ? `<textarea id="rep-${m.id}" maxlength="500" placeholder="Write your reply">${esc(m.reply || "")}</textarea>
        <div class="actions" style="margin-top:8px"><button class="btn ok sm" data-act="savereply" data-id="${m.id}">Send reply</button><button class="btn ghost sm" data-act="cancelreply" data-id="${m.id}">Cancel</button></div>` : ""}
    </div>
    <div class="actions">
      ${m.status !== "approved" ? `<button class="btn ok sm" data-act="approve" data-id="${m.id}">Post it</button>` : `<button class="btn ghost sm" data-act="pending" data-id="${m.id}">Unpost</button>`}
      <button class="btn sm" data-act="reply" data-id="${m.id}">${m.reply ? "Edit reply" : "Reply"}</button>
      ${m.reply ? `<button class="btn ghost sm" data-act="delreply" data-id="${m.id}">Remove reply</button>` : ""}
      ${m.status !== "rejected" ? `<button class="btn ghost sm" data-act="reject" data-id="${m.id}">Reject</button>` : ""}
      <button class="btn danger sm" data-act="delmsg" data-id="${m.id}">Delete</button></div></div>`).join("") : `<div class="empty">No student messages yet.</div>`;
}

if (page === "student") initStudent();
if (page === "admin") initAdmin();
