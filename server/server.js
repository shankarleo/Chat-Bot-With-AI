require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { streamReply, toFriendlyError } = require("./gemini");

// --- Environment validation ---
if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "your_api_key_here") {
  console.error("Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.");
  process.exit(1);
}
const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.ALLOWED_ORIGIN || `http://localhost:${PORT}`;
const MAX_MESSAGES = 30, MAX_CHARS = 4000;

const app = express();
app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: "200kb" })); // request-size limit

// --- Basic in-memory rate limit: 20 requests/minute per IP ---
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now(), list = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  if (list.length >= 20) return res.status(429).json({ ok: false, error: "Too many requests. Please slow down." });
  list.push(now); hits.set(req.ip, list); next();
}
setInterval(() => hits.clear(), 10 * 60000).unref();

// --- Input validation ---
function validate(body) {
  const { messages, name, style } = body || {};
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return "Invalid message list.";
  for (const m of messages)
    if (!["user", "assistant"].includes(m?.role) || typeof m.content !== "string" || !m.content.trim() || m.content.length > MAX_CHARS)
      return `Each message needs a role and text up to ${MAX_CHARS} characters.`;
  if (messages[messages.length - 1].role !== "user") return "The last message must be from the user.";
  if (name !== undefined && (typeof name !== "string" || name.length > 40)) return "Invalid assistant name.";
  if (style !== undefined && !["concise", "balanced", "detailed"].includes(style)) return "Invalid style.";
  return null;
}

// --- POST /api/chat: streams plain text. Errors before streaming return JSON {ok:false,error}. ---
app.post("/api/chat", rateLimit, async (req, res) => {
  const problem = validate(req.body);
  if (problem) return res.status(400).json({ ok: false, error: problem });
  const { messages, name = "Assistant", style = "balanced" } = req.body;

  const controller = { closed: false };
  res.on("close", () => (controller.closed = true)); // user pressed Stop
  try {
    const it = streamReply(messages, { name: name.trim() || "Assistant", style })[Symbol.asyncIterator]();
    let first = await it.next(); // errors (quota, bad key...) surface here, before headers are sent
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    while (!first.done && !controller.closed) {
      res.write(first.value);
      first = await it.next();
    }
    res.end();
  } catch (err) {
    const { status, error } = toFriendlyError(err); // we deliberately do not log message content
    console.error("Gemini error:", err?.status || err?.code || "unknown");
    if (res.headersSent) return res.end();
    res.status(status).json({ ok: false, error });
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.listen(PORT, () => console.log(`Assistant running at http://localhost:${PORT}`));
