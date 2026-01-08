# Gyms in Library

## Location
Gyms are accessible from the Library hub.

## List Page
- View all workout spaces
- See active, temporary, and expired status
- Jump into a gym or create a new one
- Set a gym as active

## Detail Page
- Equipment inventory grouped by category
- Active gym indicator + set active action
- Load into Coach (launches Coach with gym context)
- Templates compatibility summary:
  - Compatible
  - Needs substitutions
  - Not compatible (with missing equipment reasons)

## Data Model
Gyms reuse the `workoutSpaces` table (see `src/db.js`).

## Implementation
- Component: `src/features/gyms/GymsView.jsx`
- Compatibility engine: `src/equipment/engine.js`
