# IronAI - Local-First  Gym Logger
## Tech Stack
- React (Vite)
- Tailwind CSS (Mobile First)
- Dexie.js (IndexedDB for local storage)
- Lucide React (Icons)

## Database Schema (Dexie)
1. **exercises**: id (auto), name, default_sets, default_reps, muscle_group, video_url, is_custom
2. **logs**: id (auto), date, duration, volume, workout_notes, detailed_sets (JSON array)
3. **settings**: id (auto), api_key, coach_persona
4. **templates**: id (auto), name, exercise_list (JSON array)

## Features
- User enters OpenAI/Gemini Key in Settings.
- App runs 100% offline (local-first).
