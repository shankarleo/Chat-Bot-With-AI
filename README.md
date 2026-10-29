# AI Personal Assistant (Gemini)

Vanilla HTML/CSS/JS frontend + Node/Express backend. The Gemini API key lives only on the server.

## Prerequisites
- Node.js 18+ (https://nodejs.org) — check with `node -v`

## Get a free Gemini API key
1. Open https://aistudio.google.com/apikey and sign in.
2. Click **Create API key** and copy it.

## Run
```bash
cd ai-personal-assistant
npm install
cp .env.example .env      # Windows: copy .env.example .env
# edit .env and paste your key after GEMINI_API_KEY=
npm start
```
Open http://localhost:3000

## Test the endpoint (it streams plain text)
```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say hello in 5 words"}]}'
```
Errors return JSON: `{"ok":false,"error":"..."}`.

## Troubleshooting
| Problem | Fix |
|---|---|
| "Missing GEMINI_API_KEY" | Create `.env` from `.env.example` and add your key; restart. |
| "Invalid Gemini API key" | Re-copy the key; no quotes or spaces. |
| "Free-tier quota reached" (429) | Wait a minute or until tomorrow; free tier has per-minute and per-day limits. |
| "Model unavailable" | Set `GEMINI_MODEL` in `.env` to a model listed at https://ai.google.dev/gemini-api/docs/models |
| Port in use | Change `PORT` (and `ALLOWED_ORIGIN`) in `.env`. |
| "Cannot reach the server" | Make sure `npm start` is running. |

## Publish to GitHub safely
```bash
git init
git status          # confirm .env is NOT listed (it is in .gitignore)
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/ai-personal-assistant.git
git push -u origin main
```
If you ever commit a key by mistake, **revoke it** in AI Studio and create a new one — deleting the file is not enough.

## Deploying publicly
Set env vars in your host's dashboard (never in code), set `ALLOWED_ORIGIN` to your real URL, serve over HTTPS, and keep the rate limit (consider adding login or a shared limiter such as Redis, since public use spends your quota).
