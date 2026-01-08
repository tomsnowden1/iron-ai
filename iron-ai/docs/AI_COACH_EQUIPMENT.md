# AI Coach Equipment Integration

The AI Coach uses workout spaces and equipment profiles to keep recommendations feasible.

## Context Snapshot
When the “Workout spaces” scope is enabled, the snapshot includes:
- Active space summary (name, temporary status, expiry)
- Available equipment list (from the active space)
- Missing equipment summary for exercises in recent sessions/templates

## Tools
Read tools (scope-gated):
- `get_workout_spaces()`
- `get_active_space()`
- `get_equipment_for_space({ spaceId? })`
- `get_exercise_substitutions({ exerciseId, spaceId? })`

Write tools (confirmation required):
- `create_workout_space(...)`
- `update_workout_space(...)`
- `set_active_space({ spaceId })`

## Coach Rules
- Never recommend exercises that require unavailable equipment.
- Always include: “Designed for: <space name>” in plans.
- If equipment is missing, explain the constraint and offer substitutions.

## Safety & Consent
Equipment and space data are only shared when the user enables the scope in the Context panel.
Write actions always require explicit user confirmation.
