# Exercise Library (Explorer)

## Intent
Explorer is for browsing, learning, and analyzing exercises.
It never auto-adds; selection opens Exercise Detail.

## Data Model (Core Fields)
Exercises support:
- `id`, `name`
- `primaryMuscles[]`, `secondaryMuscles[]`
- `requiredEquipmentIds[]`, `optionalEquipmentIds[]`
- `instructions[]`, `commonMistakes[]`
- `progressions[]`, `regressions[]`
- `aliases[]`
- `media.videoUrl?`

Legacy fields like `muscle_group` and `video_url` remain supported.

## Filters
- Muscle group (primary)
- Required equipment
- Exercise type (compound/isolation) when available
- Availability at active gym (toggle)

## Sorts
- A-Z
- Most used
- Recently used

## List Rows
Each row shows:
- Name
- Primary muscle group
- Equipment pills
- Active gym availability indicator (if active gym exists)

## Implementation
- Component: `src/features/exercises/ExercisesExplorer.jsx`
- Shared list row: `src/features/exercises/ExerciseList.jsx`
- Derived usage stats: `src/exercises/derived.js`
