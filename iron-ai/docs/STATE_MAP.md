# State Map

Top 3 state hotspots
1) Workout flow (active workout + workout items + finish summary)
2) Template editing flow (template + exercises + add/remove)
3) Settings form (DB settings + local draft state)

App-level state
- `tab` (workout/history/templates/settings/summary): controls which view renders.
- `workoutId`: active workout id; restored from localStorage or most recent active workout.
- `activeTemplateId`: template detail selection.
- `lastSummary`: finish summary payload for the summary view.

Workout flow
- `workoutId` null -> Workout empty state.
- `createEmptyWorkout` or `startWorkoutFromTemplate` -> sets `workoutId` and opens Workout view.
- `workoutBundle` (via Dexie) drives `workout`, `items`, and `sets` rendering.
- Replace modal state (`replaceOpen`, `replaceItemId`, `replaceCurrentExerciseId`, `replaceNewExerciseId`) is local to the workout view.
- Finish flow: validate items + sets -> `finishWorkout` -> clear `workoutId` -> set `lastSummary` -> switch to Summary tab.
- LocalStorage sync keeps `workoutId` for reload recovery.

Templates flow
- Templates list: `loading`, `refreshing`, `error`, and `templates` manage list state.
- Template editor: `templateBundle` (Dexie) is the source of truth for exercises.
- Local draft state (`name`, `newExerciseId`) is reset on template change and saved via explicit actions.
- Start workout from template either delegates to parent handler or starts directly.

Settings flow
- `settings` comes from Dexie.
- Local draft state (`apiKey`, `persona`) is isolated to the form and saved explicitly.
- The form is remounted when the underlying settings snapshot changes.

History flow
- `workouts` from Dexie lists finished workouts.
- `openId` toggles a single detail expansion; `openDetails` holds the expanded workout data.

Summary flow
- `lastSummary` renders totals and duration in the summary view.
- Summary tab actions return to Workout or History without modifying data.
