# Workout Spaces

Workout Spaces represent gyms or locations with explicit equipment profiles. They are local-first
and stored in IndexedDB.

## Data Model
Each space stores:
- `id`: auto-increment id
- `name`: user-facing label
- `description`: optional notes/address
- `equipmentIds[]`: equipment list for the space
- `isDefault`: used when no active space is chosen
- `isTemporary`: for travel/short-term setups
- `expiresAt`: optional expiry date (ISO date or null)
- `createdAt`, `updatedAt`

## Defaults & Backward Compatibility
- A default space is created on first run (`Default Gym`) with all equipment.
- Existing workouts/templates without `spaceId` continue to load normally.

## UI Behavior
- Settings > Workout Spaces lets you create, edit, duplicate, delete spaces.
- Equipment is chosen via a searchable checklist.
- If a space has no equipment selected, a warning is shown (non-blocking).
- Temporary spaces can set an expiry date; expired spaces are ignored when resolving active space.

## Active Space
- The active space is stored in settings (`active_space_id`).
- If unset, the default space is used.
- The active space is selectable when starting a workout and when editing templates.

## Template + Workout Integration
- Templates can be tagged with an optional `spaceId`.
- When starting a workout, the current active space is stored on the session.
- If a template is used in a different space, the UI shows a warning if equipment is missing.
