const slugify = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const toArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
};

const toString = (value) => {
  const text = String(value ?? "").trim();
  return text || "";
};

export function normalizeFreeExerciseRecord(record, now = Date.now()) {
  const rawName =
    record?.name ??
    record?.exercise_name ??
    record?.exerciseName ??
    record?.title;
  const name = toString(rawName) || "Unnamed Exercise";
  const rawId = record?.id ?? record?.exerciseId ?? record?._id ?? "";
  const baseSlug = slugify(name);
  const slug = rawId
    ? `${rawId}-${baseSlug || "exercise"}`
    : baseSlug || slugify(String(rawId)) || "exercise";

  const aliases = toArray(record?.aliases ?? record?.alternativeNames);
  const primaryMuscles = toArray(record?.primaryMuscles ?? record?.primary_muscles);
  const secondaryMuscles = toArray(
    record?.secondaryMuscles ?? record?.secondary_muscles
  );
  const equipment = toArray(record?.equipment ?? record?.equipmentList);
  const category = toString(record?.category ?? record?.type ?? record?.movement);
  const pattern = toString(record?.pattern ?? record?.mechanic ?? record?.force);
  const instructions = toArray(
    record?.instructions ?? record?.steps ?? record?.execution ?? record?.howTo
  );
  const gotchas = toArray(record?.gotchas ?? record?.tips ?? record?.cues);
  const progressions = toArray(
    record?.progressions ?? record?.progression ?? record?.advanced_exercises
  );
  const regressions = toArray(
    record?.regressions ?? record?.regression ?? record?.beginner_exercises
  );

  const youtubeSearchQuery =
    toString(record?.youtubeSearchQuery) || `${name} exercise form cues`;
  const youtubeVideoId =
    typeof record?.youtubeVideoId === "string" && record.youtubeVideoId.trim()
      ? record.youtubeVideoId.trim()
      : null;

  return {
    slug,
    name,
    status: "extended",
    aliases,
    primaryMuscles,
    secondaryMuscles,
    equipment,
    category,
    pattern,
    instructions,
    gotchas,
    commonMistakes: gotchas,
    progressions,
    regressions,
    youtubeSearchQuery,
    youtubeVideoId,
    source: "free-exercise-db",
    is_custom: false,
    createdAt: now,
    updatedAt: now,
  };
}
