# Data Model

## Schema versions
- **v3**: introduced workout tracking tables (`workouts`, `workoutItems`, `workoutSets`).
- **v4**: adds `workoutSessions` as the canonical sessions table while keeping `workouts` as a legacy mirror.
- **v5**: adds `plannedWorkouts` for lightweight scheduling.
- **v6**: adds `equipment` and `workoutSpaces` plus optional space tagging on templates/sessions.

## Migration approach (v4)
- Create the new `workoutSessions` table.
- Copy existing rows from `workouts` into `workoutSessions` if they are missing.
- Keep `workouts` in the schema to avoid dropping legacy data.
- New writes are mirrored into both `workoutSessions` and `workouts` for backward compatibility.

## Tables

### exercises
- **Purpose**: exercise catalog seeded on first run.
- **Primary key**: `id` (auto-increment)
- **Indexes**: `name`, `default_sets`, `default_reps`, `muscle_group`, `video_url`, `is_custom`
- **Notes**: equipment fields `requiredEquipmentIds[]`, `optionalEquipmentIds[]` inferred on seed/upgrade.

### settings
- **Purpose**: local app settings.
- **Primary key**: `id`
- **Indexes**: `api_key`, `coach_persona`

### logs
- **Purpose**: legacy logging table (not currently used in UI).
- **Primary key**: `id` (auto-increment)
- **Indexes**: `date`

### templates
- **Purpose**: user-created workout templates.
- **Primary key**: `id` (auto-increment)
- **Indexes**: `name`, `createdAt`, `updatedAt`
- **Notes**: optional `spaceId` to tag a preferred workout space.

### templateItems
- **Purpose**: exercises inside templates.
- **Primary key**: `id` (auto-increment)
- **Indexes**: `templateId`, `exerciseId`, `sortOrder`, `targetSets`, `targetReps`, `notes`, `createdAt`, `updatedAt`, `[templateId+exerciseId]`

### workoutSessions (v4, canonical)
- **Purpose**: workout session header rows.
- **Primary key**: `id` (auto-increment)
- **Indexes**: `startedAt`, `finishedAt`, `templateId`
- **Notes**: optional `spaceId` stored at workout start.

### workouts (legacy mirror)
- **Purpose**: legacy session table retained for backward compatibility.
- **Primary key**: `id` (auto-increment)
- **Indexes**: `startedAt`, `finishedAt`, `templateId`
- **Notes**: mirrors `spaceId` for backward compatibility.

### workoutItems
- **Purpose**: exercises inside a workout session.
- **Primary key**: `id` (auto-increment)
- **Indexes**: `workoutId`, `exerciseId`, `sortOrder`, `targetSets`, `targetReps`, `notes`, `[workoutId+exerciseId]`
- **Notes**: `workoutId` references `workoutSessions.id` (and legacy `workouts.id`).

### workoutSets
- **Purpose**: sets performed per workout item.
- **Primary key**: `id` (auto-increment)
- **Indexes**: `workoutItemId`, `setNumber`

### plannedWorkouts
- **Purpose**: lightweight planned workouts created by the user or coach tools.
- **Primary key**: `id` (auto-increment)
- **Indexes**: `date`, `createdAt`, `updatedAt`, `source`, `templateId`
- **Notes**: optional `exercises` snapshot for template-less plans.

### equipment (v6)
- **Purpose**: catalog of equipment types used for availability checks.
- **Primary key**: `id` (string)
- **Indexes**: `name`, `category`, `isPortable`

### workoutSpaces (v6)
- **Purpose**: user-defined gyms/locations with explicit equipment profiles.
- **Primary key**: `id` (auto-increment)
- **Indexes**: `name`, `isDefault`, `isTemporary`, `expiresAt`, `updatedAt`
- **Notes**: `equipmentIds[]` list, `isTemporary` optional expiry for travel spaces.

## Helper queries
- `getWorkoutSessionById(id)` returns a session by id with legacy fallback.
- `listRecentWorkoutSessions(limit)` returns the most recent sessions (by `startedAt`).
