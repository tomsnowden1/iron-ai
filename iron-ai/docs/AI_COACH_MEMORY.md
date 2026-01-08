# AI Coach Memory

## Purpose
Coach Memory stores user preferences and goals locally. It is optional and off by default.

## Storage
- Settings table fields:
  - `coach_memory_enabled` (boolean)
  - `coach_memory` (JSON object)

## Schema (small, structured JSON)
```json
{
  "goals": [{ "type": "string", "value": "string", "notes": "string" }],
  "preferences": {
    "daysPerWeek": 4,
    "equipment": ["string"],
    "injuriesToAvoid": ["string"],
    "favoriteExercises": ["string"]
  },
  "communicationStyle": "gentle | tough | neutral",
  "notes": "string"
}
```

## UI Controls
- Enable/disable toggle in Settings.
- View memory (read-only JSON preview).
- Edit memory (JSON editor).
- Clear memory (resets to defaults).

## Usage in the Coach
When enabled, a summarized version of memory is included in the context snapshot.
Raw chat logs are never stored in memory.
The `update_user_goal` tool writes into this memory store after user confirmation.
