# Exercise Detail

## Sections
1. Overview
   - Name
   - Primary/secondary muscles
   - Required/optional equipment
   - Gym availability summary
   - Video placeholder/link

2. How to Perform
   - `instructions[]` rendered as numbered steps
   - Falls back to generic cues when missing

3. Common Mistakes
   - `commonMistakes[]` bullet list
   - Falls back to generic guidance when missing

4. Progressions & Regressions
   - “Easier” and “Harder” lists linking to other exercises
   - If not defined, easier alternatives fall back to equipment-based substitutions

5. History & Stats
   - Last performed date
   - Times performed
   - Best set
   - Estimated 1RM (Epley)
   - Lightweight charts for volume, max load/reps, and 1RM

6. Where Can I Do This?
   - Gyms where the exercise is available
   - Active gym highlighted
   - Missing equipment reasons + substitution hints if unavailable

## Actions
- Ask Coach about this exercise (opens Coach with exercise context)
- Add to workout (opens Picker prefiltered or adds directly in flow)

## Implementation
- Component: `src/features/exercises/ExerciseDetailView.jsx`
- Derived stats + availability helpers: `src/exercises/derived.js`
