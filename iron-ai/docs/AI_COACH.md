# AI Coach

The AI Coach screen is a lightweight, tool-enabled chat interface for general coaching
questions. It does not yet include advanced training logic or personalized programs.

## API Key Handling
- You provide your own OpenAI API key in Settings.
- The key is stored locally in IndexedDB (settings table) and never logged.
- The app calls OpenAI directly from the browser; no backend is involved.

## Model
- Default model: `gpt-4o-mini` (see `src/services/openai.js`).

## Platform docs
- Architecture overview: `docs/AI_COACH_PLATFORM.md`
- Tool list and schemas: `docs/AI_COACH_TOOLS.md`
- Coach Memory: `docs/AI_COACH_MEMORY.md`
- Security notes: `docs/AI_COACH_SECURITY.md`
- Equipment integration: `docs/AI_COACH_EQUIPMENT.md`

## Known Limitations
- Chat history is in-memory only and not persisted.
- Client-side API keys are visible to anyone with device access.
- No advanced coaching logic is implemented yet.
