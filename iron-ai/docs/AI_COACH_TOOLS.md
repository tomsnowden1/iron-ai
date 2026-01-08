# AI Coach Tools

## Tool Registry
Tools are defined in `src/coach/tools.js` with input/output schemas and handlers.
Write tools are flagged with `isWriteTool: true` and require user confirmation.
Read tools are only exposed when their data scope is enabled in the Context panel.

## Read Tools
- `get_recent_sessions({ limit })`
- `get_session_detail({ sessionId })`
- `get_templates({ limit })`
- `get_template_detail({ templateId })`
- `search_exercises({ query, limit, muscleGroup })`
- `get_exercise_history({ exerciseIdOrName, limit })`
- `get_exercise_substitutions({ exerciseId, spaceId? })`
- `get_personal_records({ exerciseIdOrName })`
- `get_training_summary({ rangeDays })`
- `get_workout_spaces()`
- `get_active_space()`
- `get_equipment_for_space({ spaceId? })`

## Write Tools (confirmation required)
- `create_template({ name, spaceId?, exercises:[{ exerciseId, sets, reps, warmupSets? }] })`
- `add_planned_workout({ date, templateId?, exercises? })`
- `update_user_goal({ goalType, value, notes? })`
- `create_workout_space({ name, description?, equipmentIds?, isDefault?, isTemporary?, expiresAt? })`
- `update_workout_space({ spaceId, name?, description?, equipmentIds?, isDefault?, isTemporary?, expiresAt? })`
- `set_active_space({ spaceId })`

## Example Inputs
```json
{ "limit": 5 }
```

```json
{ "exerciseIdOrName": "Bench Press", "limit": 5 }
```

```json
{
  "name": "Push Day",
  "exercises": [
    { "exerciseId": 1, "sets": 4, "reps": 8 },
    { "exerciseId": 2, "sets": 3, "reps": 10 }
  ]
}
```

```json
{ "name": "Hotel Gym", "equipmentIds": ["dumbbell", "treadmill"], "isTemporary": true }
```

## Validation
- Inputs are validated lightly against JSON schemas before execution.
- Invalid inputs return tool errors to the assistant and the user.
