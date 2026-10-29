// ---------- State (saved in localStorage) ----------
const KEY_CHATS = "assistant.chats", KEY_PREFS = "assistant.prefs";
const load = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
let chats = load(KEY_CHATS, []);
let prefs = { theme: "dark", style: "balanced", name: "Assistant", ...load(KEY_PREFS, {}) };
let activeId = chats[0]?.id || null;
let controller = null; // AbortController for the Stop button
let busy = false;

const $ = (id) => document.getElementById(id);
const els = ["sidebar","scrim","chatList","messages","welcome","greeting","input","sendBtn","stopBtn","counter","title","settings","themeSel","styleSel","nameInp"].reduce((o, id) => (o[id] = $(id), o), {});
const save = () => { localStorage.setItem(KEY_CHATS, JSON.stringify(chats)); localStorage.setItem(KEY_PREFS, JSON.stringify(prefs)); };
const activeChat = () => chats.find((c) => c.id === activeId);

// ---------- Safe Markdown rendering ----------
// We escape ALL HTML first, then add a few formatting tags ourselves. Model output can never run as HTML/JS.
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function renderMarkdown(text) {
  const parts = escapeHtml(text).split(/```/); // odd indexes are code blocks
  return parts.map((part, i) => {
    if (i % 2) return `<pre><code>${part.replace(/^\w*\n/, "")}</code></pre>`;
    return part.split(/\n{2,}/).map((para) => {
      let p = para.replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
      const lines = p.split("\n");
      if (lines.every((l) => /^\s*[-*] /.test(l))) return "<ul>" + lines.map((l) => `<li>${l.replace(/^\s*[-*] /, "")}</li>`).join("") + "</ul>";
      if (lines.every((l) => /^\s*\d+[.)] /.test(l))) return "<ol>" + lines.map((l) => `<li>${l.replace(/^\s*\d+[.)] /, "")}</li>`).join("") + "</ol>";
      return p.trim() ? `<p>${lines.join("<br>")}</p>` : "";
    }).join("");
  }).join("");
}

// ---------- Rendering ----------
function renderSidebar() {
  els.chatList.innerHTML = "";
  chats.forEach((c) => {
    const row = document.createElement("div");
    row.className = "chat-item" + (c.id === activeId ? " active" : "");
    const label = document.createElement("span"); label.textContent = c.title; // textContent = safe
    const del = document.createElement("button"); del.textContent = "✕"; del.title = "Delete chat";
    del.onclick = (e) => { e.stopPropagation(); chats = chats.filter((x) => x.id !== c.id); if (activeId === c.id) activeId = chats[0]?.id || null; save(); renderAll(); };
    row.onclick = () => { if (!busy) { activeId = c.id; renderAll(); closeSidebar(); } };
    row.append(label, del); els.chatList.append(row);
  });
}

function addMessageEl(role, content) {
  const wrap = document.createElement("div"); wrap.className = `msg ${role}`;
  const bubble = document.createElement("div"); bubble.className = "bubble";
  if (role === "user") bubble.textContent = content; else bubble.innerHTML = renderMarkdown(content);
  wrap.append(bubble);
  els.messages.append(wrap);
  return { wrap, bubble };
}

function addCopyButton(wrap, getText) {
  const actions = document.createElement("div"); actions.className = "actions";
  const copy = document.createElement("button"); copy.className = "small"; copy.textContent = "Copy";
  copy.onclick = async () => { await navigator.clipboard.writeText(getText()); copy.textContent = "Copied ✓"; setTimeout(() => (copy.textContent = "Copy"), 1500); };
  actions.append(copy); wrap.append(actions);
}

function renderMessages() {
  els.messages.querySelectorAll(".msg").forEach((n) => n.remove());
  const chat = activeChat();
  els.welcome.style.display = chat?.messages.length ? "none" : "";
  els.title.textContent = chat?.title || `${prefs.name}`;
  els.greeting.textContent = `Hello! I'm ${prefs.name}.`;
  chat?.messages.forEach((m) => { const { wrap } = addMessageEl(m.role, m.content); if (m.role === "assistant") addCopyButton(wrap, () => m.content); });
  els.messages.scrollTop = els.messages.scrollHeight;
}
const renderAll = () => { renderSidebar(); renderMessages(); };

// Only auto-scroll if the user is already near the bottom (so manual scrolling isn't hijacked).
const nearBottom = () => els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 120;
const scrollIfPinned = (pinned) => { if (pinned) els.messages.scrollTop = els.messages.scrollHeight; };

// ---------- Sending / streaming ----------
function setBusy(state) {
  busy = state;
  els.sendBtn.hidden = state; els.stopBtn.hidden = !state; els.input.disabled = state;
  if (!state) els.input.focus();
}

async function generate() {
  const chat = activeChat();
  setBusy(true);
  els.welcome.style.display = "none";
  const { wrap, bubble } = addMessageEl("assistant", "");
  bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  els.messages.scrollTop = els.messages.scrollHeight;

  controller = new AbortController();
  let text = "";
  try {
    // Send only the last 20 messages as context to keep requests small.
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ messages: chat.messages.slice(-20), name: prefs.name, style: prefs.style })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed.");
    const reader = res.body.getReader(), decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const pinned = nearBottom();
      text += decoder.decode(value, { stream: true });
      bubble.innerHTML = renderMarkdown(text);
      scrollIfPinned(pinned);
    }
    if (!text.trim()) throw new Error("The model returned an empty response.");
    finish(chat, wrap, text);
  } catch (err) {
    if (err.name === "AbortError") { // user pressed Stop: keep what we have
      if (text.trim()) finish(chat, wrap, text); else wrap.remove();
    } else {
      wrap.classList.add("error");
      bubble.textContent = err.message === "Failed to fetch" ? "Cannot reach the server. Is it running?" : err.message;
      const retry = document.createElement("button"); retry.className = "small"; retry.textContent = "Retry";
      retry.onclick = () => { wrap.remove(); generate(); };
      wrap.append(retry);
    }
  } finally { controller = null; setBusy(false); }
}

function finish(chat, wrap, text) {
  chat.messages.push({ role: "assistant", content: text });
  chat.updated = Date.now(); save(); addCopyButton(wrap, () => text);
}

function sendMessage(text) {
  text = text.trim();
  if (busy) return;
  if (!text) { flashHint("Please type a message first."); return; }
  if (!activeChat()) newChat();
  const chat = activeChat();
  if (!chat.messages.length) chat.title = text.slice(0, 40);
  chat.messages.push({ role: "user", content: text });
  save(); renderSidebar(); els.title.textContent = chat.title;
  addMessageEl("user", text);
  els.input.value = ""; autosize();
  generate();
}

function newChat() {
  if (busy) return;
  const chat = { id: crypto.randomUUID(), title: "New chat", messages: [], updated: Date.now() };
  chats.unshift(chat); activeId = chat.id; save(); renderAll(); closeSidebar(); els.input.focus();
}

// ---------- Input handling ----------
function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
  const n = els.input.value.length;
  els.counter.textContent = `${n} / 4000`; els.counter.className = n > 3800 ? "warn" : "";
}
function flashHint(msg) { const h = $("hintText"); h.textContent = msg; h.className = "warn"; setTimeout(() => { h.textContent = "Enter to send · Shift+Enter for new line"; h.className = ""; }, 2000); }

els.input.addEventListener("input", autosize);
els.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(els.input.value); } });
els.sendBtn.onclick = () => sendMessage(els.input.value);
els.stopBtn.onclick = () => controller?.abort();
$("newChatBtn").onclick = newChat;
document.querySelectorAll(".card").forEach((c) => (c.onclick = () => sendMessage(c.dataset.prompt)));

// ---------- Sidebar (mobile + desktop) ----------
const isMobile = () => matchMedia("(max-width:760px)").matches;
function closeSidebar() { els.sidebar.classList.remove("open"); els.scrim.classList.remove("show"); }
$("menuBtn").onclick = () => {
  if (isMobile()) { els.sidebar.classList.toggle("open"); els.scrim.classList.toggle("show"); }
  else els.sidebar.classList.toggle("collapsed");
};
els.scrim.onclick = closeSidebar;

// ---------- Settings ----------
function applyPrefs() { document.documentElement.dataset.theme = prefs.theme; }
$("settingsBtn").onclick = () => { els.themeSel.value = prefs.theme; els.styleSel.value = prefs.style; els.nameInp.value = prefs.name; els.settings.showModal(); closeSidebar(); };
els.themeSel.onchange = () => { prefs.theme = els.themeSel.value; applyPrefs(); save(); };
els.styleSel.onchange = () => { prefs.style = els.styleSel.value; save(); };
els.nameInp.oninput = () => { prefs.name = els.nameInp.value.trim() || "Assistant"; save(); renderMessages(); };
$("clearBtn").onclick = () => {
  if (confirm("Delete ALL chat history? This cannot be undone.")) { chats = []; activeId = null; save(); renderAll(); els.settings.close(); }
};

// ---------- Start ----------
applyPrefs(); renderAll(); autosize();
