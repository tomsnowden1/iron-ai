# Smoke Tests

Use this checklist after changes to verify core flows. Run with `npm run dev` and a fresh browser session.

## Startup
- [ ] App loads without a white screen or console crash.
- [ ] Navigation tab bar is visible (Workout, Coach, History, Templates, More).

## Workout
- [ ] Workout tab loads and shows sets.
- [ ] Add a set (tap + or use Cmd/Ctrl + Enter).
- [ ] Edit kg/reps values and mark a set done.
- [ ] Rest timer can start/stop without errors.

## Exercise Library
- [ ] More → Exercise Library loads.
- [ ] Exercise picker opens from Workout.
- [ ] Search works and selecting an exercise returns to Workout.
- [ ] If seed fails, empty state renders without crashing.

## Templates
- [ ] Templates list loads.
- [ ] Create a template, add an exercise, and save.
- [ ] Start workout from a template.

## History
- [ ] History tab loads and shows past sessions.

## Seed / Data
- [ ] Exercise seed runs (or skips) without blocking app load.
- [ ] No unhandled Dexie errors in the console.
