# Workout Notes

Workout notes are stored directly on the workout session record so they persist with History.

## Storage
- `workoutSessions.sessionNote` (string, optional)
- `workoutSessions.exerciseNotes` (object map of `exerciseId` to string, optional)
- `workouts` (legacy mirror) stores the same fields for backward compatibility

## Behavior
- Notes are plain text and saved on blur from the Workout screen.
- Notes are shown in the Workout Summary and History detail views when present.
- Sessions created before notes existed continue to load with empty notes.
