# Exercise Picker

## Intent
The picker is built for **fast selection** inside workout and template builders.
Explorer is for browsing and learning; it never auto-adds.

## Entry Points
- Workout builder → Add exercise
- Template editor → Add exercise

## Behavior
- Full-page picker with search + filters (muscle group, equipment, type if available).
- Optional toggle: available at active gym.
- Selecting an exercise adds it immediately and returns to the builder.
- Info icon opens the Exercise Detail page without selecting.

## Defaults
When the picker opens, preferences are applied in this order:
1. Filter by active gym equipment (only if enabled and an active gym exists).
2. Show the “Most Used” section first (only if enabled and history exists).
3. Auto-focus the search input (only if enabled).

Defaults apply only on initial open. Manual changes are never overridden.

## Settings
Preferences live in Settings → Exercise Picker Preferences:
- Auto-focus search on open (default: On)
- Filter by active gym equipment (default: On)
- Show most-used exercises first (default: On)

## Edge Cases
- If no active gym exists, the equipment filter is disabled with a hint.
- If there is no workout history, the “Most Used” section stays hidden.
