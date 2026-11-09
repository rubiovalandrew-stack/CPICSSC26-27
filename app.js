/* CPIC School Site – Firebase version (Firestore + Authentication) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, updateDoc, doc, query, where, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const fs = getFirestore(app);
const auth = getAuth(app);

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = t => new Date(t).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
const tagClass = s => (s === "SSC" ? "tag ssc" : "tag");
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
const byDate = (a, b) => b.date - a.date;

/* ---------- STUDENT PAGE ---------- */
function initStudent() {
  watch("news", query(collection(fs, "news"), orderBy("date", "desc")), () => {
    $("#news").innerHTML = state.news.length ? state.news.map(n => `
      <article class="news-item">
        <div class="meta"><span class="${tagClass(n.source)}">${esc(n.source)}</span>${fmt(n.date)}</div>
        <h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`).join("") : `<div class="empty">No news yet. Check back soon.</div>`;
  });
  watch("images", query(collection(fs, "images"), orderBy("date", "desc")), () => {
    $("#gallery").innerHTML = state.images.length ? state.images.map(i => `
      <figure><img src="${i.src}" alt="${esc(i.caption || "School photo")}" loading="lazy">
      <figcaption>${esc(i.caption || "")}</figcaption></figure>`).join("") : `<div class="empty">No photos posted yet.</div>`;
  });
  watch("messages", query(collection(fs, "messages"), where("status", "==", "approved")), () => {
    const posted = [...state.messages].sort(byDate);
    $("#wall").innerHTML = posted.length ? posted.map(m => `
      <div class="note"><p>${esc(m.text)}</p><div class="meta">Anonymous · ${fmt(m.date)}</div></div>`).join("") : `<div class="empty">No approved messages yet. Be the first to send one.</div>`;
  });

  $("#gallery").addEventListener("click", e => {
    if (e.target.tagName !== "IMG") return;
    const lb = document.createElement("div"); lb.className = "lightbox";
    lb.innerHTML = `<img src="${e.target.src}" alt="">`;
    lb.onclick = () => lb.remove(); document.body.appendChild(lb);
  });

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
function initAdmin() {
  const loginBox = $("#loginBox"), dash = $("#dash");

  onAuthStateChanged(auth, user => {
    unsubs.forEach(u => u()); unsubs = [];
    loginBox.classList.toggle("hidden", !!user);
    dash.classList.toggle("hidden", !user);
    if (!user) return;
    unsubs.push(
      watch("news", query(collection(fs, "news"), orderBy("date", "desc")), renderAdmin),
      watch("images", query(collection(fs, "images"), orderBy("date", "desc")), renderAdmin),
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
      await addDoc(collection(fs, "news"), { source: $("#source").value, title: $("#ntitle").value.trim(), body: $("#nbody").value.trim(), date: Date.now() });
      e.target.reset(); toast("Posted.");
    } catch (err) { console.error(err); toast("Could not post. Are you logged in as the admin?"); }
  });

  $("#imgForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = $("#file").files[0]; if (!f) return toast("Choose an image first.");
    try {
      const src = await compress(f);
      await addDoc(collection(fs, "images"), { src, caption: $("#caption").value.trim(), date: Date.now() });
      e.target.reset(); toast("Posted.");
    } catch (err) { console.error(err); toast("Could not post that image."); }
  });

  dash.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const { act, id } = b.dataset;
    const col = act === "delnews" ? "news" : act === "delimg" ? "images" : "messages";
    try {
      if (act.startsWith("del")) {
        if (!confirm("Delete this? This cannot be undone.")) return;
        await deleteDoc(doc(fs, col, id));
      } else {
        const status = act === "approve" ? "approved" : act === "reject" ? "rejected" : "pending";
        await updateDoc(doc(fs, "messages", id), { status });
      }
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
  const news = [...state.news].sort(byDate), imgs = [...state.images].sort(byDate);
  $("#newsList").innerHTML = news.length ? news.map(n => `
    <div class="row"><div><div class="meta"><span class="${tagClass(n.source)}">${esc(n.source)}</span>${fmt(n.date)}</div>
    <strong>${esc(n.title)}</strong><p>${esc(n.body)}</p></div>
    <div class="actions"><button class="btn danger sm" data-act="delnews" data-id="${n.id}">Delete</button></div></div>`).join("") : `<div class="empty">No news posted.</div>`;

  $("#imgList").innerHTML = imgs.length ? imgs.map(i => `
    <div class="row"><div style="display:flex;gap:12px;align-items:center"><img src="${i.src}" alt=""><span>${esc(i.caption || "(no caption)")}</span></div>
    <div class="actions"><button class="btn danger sm" data-act="delimg" data-id="${i.id}">Delete</button></div></div>`).join("") : `<div class="empty">No images posted.</div>`;

  const order = { pending: 0, approved: 1, rejected: 2 };
  const msgs = [...state.messages].sort((a, b) => order[a.status] - order[b.status] || b.date - a.date);
  const pend = msgs.filter(m => m.status === "pending").length;
  $("#pendBadge").textContent = pend; $("#pendBadge").classList.toggle("hidden", !pend);
  $("#msgList").innerHTML = msgs.length ? msgs.map(m => `
    <div class="row"><div><span class="status ${m.status}">${m.status.toUpperCase()}</span> <span class="meta">· ${fmt(m.date)}</span><p>${esc(m.text)}</p></div>
    <div class="actions">
      ${m.status !== "approved" ? `<button class="btn ok sm" data-act="approve" data-id="${m.id}">Post it</button>` : `<button class="btn ghost sm" data-act="pending" data-id="${m.id}">Unpost</button>`}
      ${m.status !== "rejected" ? `<button class="btn ghost sm" data-act="reject" data-id="${m.id}">Reject</button>` : ""}
      <button class="btn danger sm" data-act="delmsg" data-id="${m.id}">Delete</button></div></div>`).join("") : `<div class="empty">No student messages yet.</div>`;
}

const page = document.body.dataset.page;
if (page === "student") initStudent();
if (page === "admin") initAdmin();
