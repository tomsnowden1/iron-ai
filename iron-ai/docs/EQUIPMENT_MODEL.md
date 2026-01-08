# Equipment Model

The app uses a fixed equipment catalog to reason about exercise availability per workout space.

## Equipment Categories
Equipment entries include:
- `id` (stable string identifier)
- `name`
- `category`: `free_weights`, `machine`, `bodyweight`, `cardio`, `accessory`
- `aliases[]` for search and AI matching
- `isPortable`

## Exercise ↔ Equipment
Each exercise can store:
- `requiredEquipmentIds[]`
- `optionalEquipmentIds[]`

If a record is missing equipment fields, the app infers them from the exercise name
using lightweight rules (e.g., “Barbell” → `barbell`, “Cable” → `cable_machine`).
Unknown exercises default to `bodyweight`.

## Availability Rules
An exercise is considered available in a space when all required equipment ids are present
in the space’s `equipmentIds[]` list.

Bodyweight is always included in a space and is treated as universally available.

## Substitution Logic
Substitutions follow a deterministic fallback chain based on primary equipment:
- Primary equipment → secondary equipment → bodyweight

Examples:
- Barbell squat → dumbbell squat variant → bodyweight leg movement
- Bench press → dumbbell press → push-up

Substitutions are restricted to exercises that:
- share the same muscle group when possible
- are available in the active space
