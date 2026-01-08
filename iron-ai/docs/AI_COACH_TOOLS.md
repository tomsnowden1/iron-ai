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
- `get_personal_records({ exerciseIdOrName })`
- `get_training_summary({ rangeDays })`

## Write Tools (confirmation required)
- `create_template({ name, exercises:[{ exerciseId, sets, reps, warmupSets? }] })`
- `add_planned_workout({ date, templateId?, exercises? })`
- `update_user_goal({ goalType, value, notes? })`

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

## Validation
- Inputs are validated lightly against JSON schemas before execution.
- Invalid inputs return tool errors to the assistant and the user.
