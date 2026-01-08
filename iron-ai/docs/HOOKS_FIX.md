# Hooks Fixes

## What was happening
Lint flagged state updates inside effects and unstable dependencies that can cause confusing re-renders.
None of these were direct "Rules of Hooks" violations (hooks were still called unconditionally),
but they were higher-risk patterns for predictable state sync.

## Fixes applied

1) Workout view state resets
- Previous: `useEffect` reset UI state when `workoutId` changed.
- Now: `WorkoutView` is keyed by `workoutId`, so the component remounts and resets local state
  in a predictable way without setState-in-effect.

2) Template editor draft sync
- Previous: `useEffect` copied `templateBundle.template` into local state.
- Now: a keyed `TemplateEditorForm` initializes local state from the template on mount,
  keeping the same UX without effect-driven state updates.

3) Settings form draft sync
- Previous: `useEffect` copied Dexie `settings` into local state.
- Now: a keyed `SettingsForm` initializes from settings, and remounts when settings change.

4) Stable memo dependencies
- Added memoized `items` arrays to avoid creating new references each render, which
  keeps `useMemo` dependencies stable and reduces unnecessary recomputation.

## Notes
- Hooks are still declared at the top of each component.
- Effects remain only for external side effects (e.g., keyboard listeners, IndexedDB reads).
