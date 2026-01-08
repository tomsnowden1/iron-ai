# Gyms Pages

Gyms live under Settings -> Library -> Gyms.

## Data Model
Gyms reuse the `workoutSpaces` table (see `src/db.js`).
- `id`: auto-incremented key
- `name`: required label (fallbacks to "New Space" if blank)
- `description`: optional notes
- `equipmentIds[]`: selected equipment ids (bodyweight is always included)
- `isDefault`: used when no active gym is set
- `isTemporary`: short-term gym flag
- `expiresAt`: optional ISO date string
- `createdAt`, `updatedAt`

## Equipment Selection
- Uses the shared equipment catalog (`src/equipment/catalog.js`).
- The gym form renders a searchable checklist grouped by category.
- Bodyweight is always included and cannot be removed.
- If no equipment is selected, the UI shows a warning but still allows saving.

## Template Compatibility Logic
- Compatibility is computed via `getTemplateCompatibility` in `src/equipment/engine.js`.
- For each template item, missing equipment is derived from
  `getMissingEquipmentForExercise`.
- If every exercise is available, the template is **Fully compatible**.
- If missing equipment exists but each missing exercise has at least one
  substitution, the template **Needs substitutions**.
- If any missing exercise has no available substitution, the template is **Not compatible**.
- The UI displays a short missing-equipment summary per template.

## Coach Launch Behavior
- Launching Coach from a gym detail page sets the active gym.
- The launch context is passed with:
  - `source: "gym_detail"`
  - `gymId`
  - `gymName`
- Coach orchestration receives the launch context in its snapshot and is instructed
  to acknowledge the gym (for example: "I'll design workouts for <gym name>.").
