# Exercise Stats

## Derived Helpers
All stats are derived at runtime (no stored aggregates):
- `getExerciseUsageStats` (most used / recently used)
- `getExerciseHistory` (session aggregation)
- `computeSetVolume`
- `estimateOneRepMax`
- `getGymAvailabilityForExercise`

Source: `src/exercises/derived.js`.

## Volume
Per set:
- If weight and reps are numeric → `weight * reps`
- If weight is missing but reps exist (bodyweight) → `reps`

Session volume is the sum of set volumes.

## 1RM (Epley)
Estimated 1RM uses the Epley formula:

`1RM = weight * (1 + reps / 30)`

Only computed when weight and reps are numeric and > 0.

## Usage Stats
- **Most used**: count of finished sessions containing the exercise.
- **Recently used**: latest finished session date.

Only finished sessions are included to keep stats stable.

## Limits
- History is capped to the most recent sessions (currently 18),
  with charts displaying the last 12 points to keep rendering fast.
