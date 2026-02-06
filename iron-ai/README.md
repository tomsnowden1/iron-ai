# IronAI - Local-First Gym Logger

## Tech stack
- React (Vite)
- Tailwind CSS (mobile first)
- Dexie.js (IndexedDB local storage)
- Lucide React (icons)

## Coach key modes
- `server` (default): Coach uses `/api/coach`, and the server reads `OPENAI_API_KEY`.
- `user`: Settings re-enables local BYOK input/testing for future use.

Set mode with `VITE_COACH_KEY_MODE=server|user`.

## Local setup
1. Copy `.env.example` to `.env.local`.
2. Set:
   - `OPENAI_API_KEY=...` (server-only key, never `VITE_` prefixed)
   - `VITE_COACH_KEY_MODE=server`
3. Install and run:
   - `npm ci`
   - `npm run dev`

In `server` mode, Settings shows `Testing mode: using server key` and Coach works without entering a key.

## Vercel setup
Configure these environment variables in Vercel project settings:
- `OPENAI_API_KEY` (required)
- `VITE_COACH_KEY_MODE` (`server` by default)
- `ALLOW_COACH_PROD` (`false` by default; set `true` only if you explicitly want Coach enabled in production)

## Production safety guard
`/api/coach` returns `403` in production unless `ALLOW_COACH_PROD=true`.

## Security notes
- OpenAI secret key is server-side only (`OPENAI_API_KEY`).
- Do not use `VITE_*` for secrets.
- `.env*` files are gitignored; `.env.example` contains placeholders only.
