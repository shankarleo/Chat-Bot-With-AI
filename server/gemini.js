// Talks to Gemini. The API key is read from the environment, never sent to the browser.
const { GoogleGenAI } = require("@google/genai");

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
let ai; // created lazily so the server can start and report a clear error
const client = () => (ai ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

const STYLES = {
  concise: "Keep answers short and to the point.",
  balanced: "Give clear answers with moderate detail.",
  detailed: "Give thorough, step-by-step answers with examples."
};

// Configurable system instruction (name + style come from user settings).
function buildSystemInstruction(name, style) {
  return `You are ${name}, a helpful personal assistant. Be accurate and clear, and say so when you are unsure.
${STYLES[style] || STYLES.balanced}
You can explain topics, summarize text, rewrite emails, brainstorm, plan tasks, make study plans, and help with code.
You have NO access to the user's emails, calendar, files or accounts. Never claim otherwise.
Use Markdown (lists, **bold**, fenced code blocks) when it helps.`;
}

// Async generator: yields text chunks as Gemini produces them.
async function* streamReply(messages, { name, style }) {
  // Gemini uses the role "model" instead of "assistant".
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const stream = await client().models.generateContentStream({
    model: MODEL,
    contents,
    config: { systemInstruction: buildSystemInstruction(name, style) }
  });
  for await (const chunk of stream) if (chunk.text) yield chunk.text;
}

// Turn SDK errors into friendly messages (never leaks the key).
function toFriendlyError(err) {
  const status = err?.status || err?.code;
  const msg = String(err?.message || "");
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg))
    return { status: 429, error: "Free-tier quota reached. Wait a minute and retry, or try again tomorrow." };
  if (status === 400 && /API key/i.test(msg)) return { status: 401, error: "Invalid Gemini API key. Check GEMINI_API_KEY in .env." };
  if (status === 401 || status === 403) return { status: 401, error: "Gemini rejected the API key or access is denied." };
  if (status === 404 || /not found|not supported/i.test(msg))
    return { status: 400, error: `Model "${MODEL}" is unavailable. Set GEMINI_MODEL in .env to a supported model.` };
  if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT/i.test(msg)) return { status: 503, error: "Network error reaching Gemini. Check your connection." };
  return { status: 500, error: "Something went wrong while contacting Gemini." };
}

module.exports = { streamReply, toFriendlyError };
