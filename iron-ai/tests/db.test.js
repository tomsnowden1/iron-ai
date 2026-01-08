import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  addExerciseToTemplate,
  addExerciseToWorkout,
  addWorkoutSet,
  createEmptyWorkout,
  createTemplate,
  db,
  finishWorkout,
  getAllExercises,
  getWorkoutWithDetails,
  listFinishedWorkouts,
  removeWorkoutSet,
  startWorkoutFromTemplate,
  updateTemplateItem,
} from '../src/db.js'

describe.sequential('workout data flows', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterAll(async () => {
    await db.delete()
    db.close()
  })

  it('creates a new empty workout in both session tables', async () => {
    const workoutId = await createEmptyWorkout()

    const session = await db.table('workoutSessions').get(workoutId)
    const legacy = await db.table('workouts').get(workoutId)

    expect(session?.id).toBe(workoutId)
    expect(legacy?.id).toBe(workoutId)
    expect(session?.finishedAt ?? null).toBeNull()
    expect(legacy?.finishedAt ?? null).toBeNull()
  })

  it('prefills workout items from exercise defaults when template targets are missing', async () => {
    const exercises = await getAllExercises()
    const exercise = exercises[0]
    expect(exercise).toBeTruthy()

    const templateId = await createTemplate({ name: 'Defaults test' })
    const itemId = await addExerciseToTemplate(templateId, exercise.id)
    await updateTemplateItem(itemId, { targetSets: null, targetReps: null })

    const workoutId = await startWorkoutFromTemplate(templateId)
    const workoutBundle = await getWorkoutWithDetails(workoutId)
    const item = workoutBundle?.items?.[0]

    expect(item?.targetSets).toBe(exercise.default_sets)
    expect(item?.targetReps).toBe(exercise.default_reps)
    expect(item?.sets?.length).toBe(exercise.default_sets)
    expect(item?.sets?.[0]?.reps).toBe(String(exercise.default_reps))
  })

  it('adds workout items with default sets and prevents duplicates', async () => {
    const exercises = await getAllExercises()
    const exercise = exercises[0]

    const workoutId = await createEmptyWorkout()
    const workoutItemId = await addExerciseToWorkout(workoutId, exercise.id)

    const sets = await db.table('workoutSets').where({ workoutItemId }).toArray()
    expect(sets.length).toBe(exercise.default_sets)
    expect(sets[0]?.reps).toBe(String(exercise.default_reps))

    await expect(addExerciseToWorkout(workoutId, exercise.id)).rejects.toThrow(
      /already exists/i
    )
  })

  it('renumbers set order after removing a set', async () => {
    const exercises = await getAllExercises()
    const exercise = exercises[0]

    const workoutId = await createEmptyWorkout()
    const workoutItemId = await addExerciseToWorkout(workoutId, exercise.id)
    await addWorkoutSet(workoutItemId)

    const before = await db.table('workoutSets').where({ workoutItemId }).toArray()
    const setToRemove = before.find((set) => set.setNumber === 2)
    expect(setToRemove).toBeTruthy()

    await removeWorkoutSet(workoutItemId, setToRemove.id)

    const after = await db.table('workoutSets').where({ workoutItemId }).toArray()
    const ordered = after.map((set) => set.setNumber).sort((a, b) => a - b)
    expect(ordered).toEqual([1, 2, 3])
  })

  it('marks a workout as finished and shows it in history queries', async () => {
    const workoutId = await createEmptyWorkout()
    await finishWorkout(workoutId)

    const session = await db.table('workoutSessions').get(workoutId)
    const legacy = await db.table('workouts').get(workoutId)
    const finished = await listFinishedWorkouts()

    expect(session?.finishedAt).toBeTruthy()
    expect(legacy?.finishedAt).toBeTruthy()
    expect(finished.some((w) => w.id === workoutId)).toBe(true)
  })
})
