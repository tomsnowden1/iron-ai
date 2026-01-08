# Exercise Picker

## Default Behavior
- When the picker opens, preferences are applied in this order:
  1. Filter by active gym equipment (only if enabled and an active gym exists).
  2. Show the "Most Used" section first (only if enabled and history exists).
  3. Auto-focus the search input (only if enabled).
- Defaults apply only on initial open. Manual search or filter changes are never overridden.

## Settings
Preferences live in Settings under "Exercise Picker Preferences":
- Auto-focus search on open (default: On)
- Filter by active gym equipment (default: On)
- Show most-used exercises first (default: On)

## Edge Cases
- If no active gym exists, the equipment filter is disabled and a hint suggests setting one.
- If there is no workout history, the "Most Used" section stays hidden.
