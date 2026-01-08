# Rest Timer

## Behavior
- The rest timer appears as a floating chip during an active workout.
- Use the chip to open the rest timer sheet with start/pause/reset controls.
- Completing a set ("Done" button or Cmd/Ctrl + Enter in a set row) auto-starts rest when enabled.
- While resting, a subtle hint shows the next set and exercise.

## Defaults and overrides
- Default rest time is 60 seconds and can be adjusted from the rest timer sheet.
- Each workout exercise can override the default rest time.
- Each set can optionally override the exercise rest time.
- The timer uses this priority: set override → exercise default → global default.

## Persistence
- Global preferences are stored in Dexie `settings` (record id 1):
  - `rest_enabled` (boolean)
  - `rest_default_seconds` (number)
- Per-exercise defaults are stored on `workoutItems.restSeconds`.
- Per-set overrides are stored on `workoutSets.restSeconds`.
