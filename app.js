/* SSC School Site – Firebase version (Firestore + Authentication) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, updateDoc, doc, query, where, orderBy, onSnapshot, Timestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential, updateEmail, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const fs = getFirestore(app);
const auth = getAuth(app);

const DAY = 864e5;        // photos stay up for 24 hours
const LOCK_SECONDS = 15;  // new news stays locked this long
const NEW_DAYS = 7;       // only news newer than this triggers the lock
const MESSAGE_LIMIT = 1500;

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
const newsImageHTML = (n, className = "", loading = "lazy") => {
  const images = newsImages(n);
  return images.length ? `<div class="news-image-grid">${images.map((src, index) => `<img${className ? ` class="${className}"` : ""} src="${src}" alt="${esc(n.title || "News image")} (${index + 1} of ${images.length})" loading="${loading}">`).join("")}</div>` : "";
};
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
  const unread = state.news.filter(n => !read.has(n.id) && n.date > cutoff);
  if (unread.length) openGate(unread);
}
function openGate(announcements) {
  gateOpen = true; document.body.style.overflow = "hidden";
  const duration = LOCK_SECONDS * announcements.length;
  const g = document.createElement("div"); g.className = "gate";
  g.innerHTML = `<div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gt" tabindex="-1">
    <div class="gate-head"><h2 id="gt">New announcements</h2><span class="meta">${announcements.length} announcement${announcements.length === 1 ? "" : "s"} · ${duration} second${duration === 1 ? "" : "s"} reading time</span></div>
    <div class="gate-body">${announcements.map(n => `<article class="gate-news">
      <div class="meta"><span class="${tagClass(n.source)}">${esc(n.source)}</span>${fmt(n.date)}</div>
      <h3>${esc(n.title)}</h3>${newsImageHTML(n, "", "eager")}<p>${esc(n.body)}</p>
    </article>`).join("")}</div>
    <div class="gate-foot"><div class="bar"><i></i></div><button class="btn" disabled></button></div></div>`;
  document.body.appendChild(g);
  const body = $(".gate-body", g), btn = $("button", g), bar = $(".bar i", g);
  let left = duration, reachedBottom = false, timer;
  const atEnd = () => body.scrollTop + body.clientHeight >= body.scrollHeight - 6;
  const update = () => {
    const ok = left <= 0 && reachedBottom;
    btn.disabled = !ok;
    btn.textContent = ok ? "Done" : reachedBottom ? `Keep reading… ${left}s` : "Scroll to the bottom to start the timer";
    bar.style.width = (reachedBottom ? (duration - left) / duration * 100 : 0) + "%";
  };
  const startTimer = () => {
    if (reachedBottom) return;
    reachedBottom = true;
    timer = setInterval(() => {
      if (!document.hidden && left > 0) { left--; update(); }
    }, 1000);
    update();
  };
  body.addEventListener("scroll", () => {
    if (atEnd()) startTimer();
    update();
  });
  body.addEventListener("wheel", e => {
    if (e.deltaY > 0 && atEnd()) startTimer();
  });
  btn.onclick = () => {
    clearInterval(timer);
    announcements.forEach(n => markRead(n.id));
    g.remove(); document.body.style.overflow = ""; gateOpen = false; checkGate();
  };
  update(); $(".gate-card", g).focus();
}

function initStudent() {
  const expandedNews = new Set();
  let bulletinView = "recent";
  const renderNews = () => {
    const v = votes();
    const announcements = bulletinView === "recent" ? state.news.slice(0, 3) : state.news;
    $("#news").innerHTML = announcements.length ? announcements.map(n => `
      <article class="news-item" data-id="${n.id}">
        <div class="meta"><span class="${tagClass(n.source)}">${esc(n.source)}</span>${fmt(n.date)}</div>
        <h3>${esc(n.title)}</h3>${newsImageHTML(n)}<p>${previewHTML(n.body, "news:" + n.id, expandedNews)}</p>
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
    renderNews();
  });
  watch("news", query(collection(fs, "news"), orderBy("date", "desc")), () => {
    renderNews();
    checkGate();
  });
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

  const expanded = new Set();
  let messageFilter = "recent";
  const drawWall = () => {
    const v = votes();
    let posted = [...state.messages].sort(byDate);
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
      return `<div class="note" data-id="${m.id}"><p>${previewHTML(m.text, messageKey, expanded)}</p><div class="meta">Anonymous · ${fmt(m.date)}</div>
        ${m.reply ? `<div class="reply"><strong>Admin replied</strong><p>${previewHTML(m.reply, replyKey, expanded)}</p></div>` : ""}
        <div class="react">${rxBtn("m", m.id, "like", m.likes, v["m:" + m.id] === "like")}${rxBtn("m", m.id, "dislike", m.dislikes, v["m:" + m.id] === "dislike")}</div>
      </div>`;
    }).join("") : `<div class="empty">${messageFilter === "liked" ? "No liked messages yet." : messageFilter === "disliked" ? "No disliked messages yet." : "No approved messages yet. Be the first to send one."}</div>`;
  };
  watch("messages", query(collection(fs, "messages"), where("status", "==", "approved")), drawWall);
  $("#wall").addEventListener("click", e => {
    const rx = e.target.closest(".rx"); if (rx) { react("m", rx.dataset.id, rx.dataset.rx); return; }
    const b = e.target.closest("[data-more]"); if (!b) return;
    expanded.has(b.dataset.more) ? expanded.delete(b.dataset.more) : expanded.add(b.dataset.more);
    drawWall();
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
  ta.addEventListener("input", () => cnt.textContent = `${ta.value.length} / ${MESSAGE_LIMIT}`);
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
      ta.value = ""; cnt.textContent = `0 / ${MESSAGE_LIMIT}`;
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
let adminMessageFilter = "recent";
let adminNewsFilter = "latest";
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
      const images = await Promise.all(files.map(file => compress(file, 1000, 120000)));
      const news = { source: $("#source").value, title: $("#ntitle").value.trim(), body: $("#nbody").value.trim(), images, date: Date.now() };
      if (new TextEncoder().encode(JSON.stringify(news)).length > 950000) {
        return toast("The news text or selected images are too large. Shorten the details or use smaller images.");
      }
      await addDoc(collection(fs, "news"), news);
      e.target.reset(); toast("Posted.");
    } catch (err) {
      console.error(err);
      toast(err.message === "news-image-too-large"
        ? "One of the selected images could not be compressed enough. Choose a smaller image."
        : "Could not post. Check the images and that you are logged in.");
    }
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

function adminNewsBody(n) {
  const p = preview(n.body), open = expandedAdminNews.has(n.id);
  return `<p class="admin-news-body"><span class="short"${open ? " hidden" : ""}>${esc(p.short)}</span>${p.cut ? `<span class="full"${open ? "" : " hidden"}>${esc(n.body)}</span><button class="more" type="button" data-news-expand="${n.id}" aria-expanded="${open}">${open ? "See less" : "See more"}</button>` : ""}</p>`;
}

function renderAdmin() {
  const sortByReactions = (items, filter) => {
    if (filter === "liked") return items.sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.date - a.date);
    if (filter === "disliked") return items.sort((a, b) => (b.dislikes || 0) - (a.dislikes || 0) || b.date - a.date);
    return items.sort(byDate);
  };
  const sortedNews = sortByReactions([...state.news], adminNewsFilter);
  const news = adminNewsFilter === "latest" ? sortedNews.slice(0, 3) : sortedNews;
  const now = Date.now();
  const imgs = state.images.filter(i => expiry(i) > now)
    .sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.date - a.date);
  $("#newsList").innerHTML = news.length ? news.map(n => `
    <div class="row"><div style="flex:1;min-width:0"><div class="meta"><span class="${tagClass(n.source)}">${esc(n.source)}</span>${fmt(n.date)} · ${n.likes || 0} likes · ${n.dislikes || 0} dislikes</div>
    <strong>${esc(n.title)}</strong>${newsImageHTML(n, "thumb")}
    ${adminNewsBody(n)}</div>
    <div class="actions"><button class="btn danger sm" data-act="delnews" data-id="${n.id}">Delete</button></div></div>`).join("") : `<div class="empty">No news posted.</div>`;

  $("#imgList").innerHTML = imgs.length ? imgs.map(i => `
    <div class="row" data-up="${i.date}" data-exp="${expiry(i)}"><div style="display:flex;gap:12px;align-items:center"><img class="thumb" src="${i.src}" alt="">
    <div>${esc(i.caption || "(no caption)")}${stampHTML(i)}<div class="meta">${i.likes || 0} likes</div></div></div>
    <div class="actions"><button class="btn danger sm" data-act="delimg" data-id="${i.id}">Delete now</button></div></div>`).join("") : `<div class="empty">No photos are up right now.</div>`;
  stamps();

  const msgs = [...state.messages];
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
  const messageHTML = m => `
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
      <button class="btn danger sm" data-act="delmsg" data-id="${m.id}">Delete</button></div></div>`;
  $("#postedMsgList").innerHTML = posted.length ? posted.map(messageHTML).join("") : `<div class="empty">No messages have been posted.</div>`;
  $("#unpostedMsgList").innerHTML = unposted.length ? unposted.map(messageHTML).join("") : `<div class="empty">No pending or rejected messages.</div>`;
}

if (page === "student") initStudent();
if (page === "admin") initAdmin();
