const TOKEN_EXPANSIONS = {
  db: ["dumbbell"],
  bb: ["barbell"],
  kb: ["kettlebell"],
  bw: ["bodyweight"],
  rdl: ["romanian", "deadlift"],
  ohp: ["overhead", "press"],
  pushup: ["push", "up"],
  pushups: ["push", "up"],
};

function singularizeToken(token) {
  const safe = String(token ?? "").trim().toLowerCase();
  if (!safe || safe.length <= 3) return safe;
  if (safe.endsWith("ies") && safe.length > 4) {
    return `${safe.slice(0, -3)}y`;
  }
  if (
    safe.endsWith("ses") ||
    safe.endsWith("xes") ||
    safe.endsWith("zes") ||
    safe.endsWith("ches") ||
    safe.endsWith("shes")
  ) {
    return safe.slice(0, -2);
  }
  if (safe.endsWith("s") && !safe.endsWith("ss")) {
    return safe.slice(0, -1);
  }
  return safe;
}

function normalizeToken(token) {
  const trimmed = String(token ?? "").trim().toLowerCase();
  if (!trimmed) return [];
  const expanded = TOKEN_EXPANSIONS[trimmed] ?? [trimmed];
  const normalized = expanded
    .map((entry) => singularizeToken(entry))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeTokens(value) {
  const safe = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!safe) return [];
  return safe
    .split(/\s+/)
    .flatMap((token) => normalizeToken(token))
    .filter(Boolean);
}

export function normalizeExerciseString(value) {
  return normalizeTokens(value).join(" ");
}

function getAliasList(exercise) {
  return Array.isArray(exercise?.aliases) ? exercise.aliases.filter(Boolean) : [];
}

function toSearchEntry(exercise) {
  const names = [exercise?.name, ...getAliasList(exercise)]
    .map((label) => String(label ?? "").trim())
    .filter(Boolean);
  return {
    exerciseId: exercise?.id ?? null,
    name: String(exercise?.name ?? "").trim() || "Unknown Exercise",
    names,
  };
}

function toTokenSet(value) {
  return new Set(normalizeTokens(value));
}

function scoreNameAgainstQuery(queryNormalized, queryTokenSet, candidateLabel) {
  const normalizedLabel = normalizeExerciseString(candidateLabel);
  if (!normalizedLabel) return 0;
  if (normalizedLabel === queryNormalized) return 1;

  const labelTokens = toTokenSet(normalizedLabel);
  let overlap = 0;
  queryTokenSet.forEach((token) => {
    if (labelTokens.has(token)) overlap += 1;
  });

  const coverage = queryTokenSet.size > 0 ? overlap / queryTokenSet.size : 0;
  const startsWith = normalizedLabel.startsWith(queryNormalized) ? 0.08 : 0;
  const includes = normalizedLabel.includes(queryNormalized) ? 0.05 : 0;
  return Math.min(0.99, coverage + startsWith + includes);
}

function compareScores(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  return String(a.name ?? "").localeCompare(String(b.name ?? ""));
}

function toNeedsReview(requestedName, ranked, maxSuggestions = 3) {
  return {
    status: "needsReview",
    requestedName: String(requestedName ?? "").trim(),
    suggestions: ranked.slice(0, maxSuggestions).map((entry) => ({
      exerciseId: entry.exerciseId,
      name: entry.name,
      score: Number(entry.score.toFixed(3)),
    })),
  };
}

export function buildSearchIndex(exercises) {
  const list = Array.isArray(exercises) ? exercises : [];
  const byId = new Map();
  const normalizedNameIndex = new Map();

  list.forEach((exercise) => {
    if (!exercise || exercise.id == null) return;
    const entry = toSearchEntry(exercise);
    byId.set(exercise.id, exercise);
    entry.names.forEach((label) => {
      const normalized = normalizeExerciseString(label);
      if (!normalized) return;
      const ids = normalizedNameIndex.get(normalized) ?? [];
      if (!ids.includes(exercise.id)) ids.push(exercise.id);
      normalizedNameIndex.set(normalized, ids);
    });
  });

  return { byId, normalizedNameIndex };
}

export function resolveExerciseId(
  query,
  {
    candidates,
    allExercises,
    threshold = 0.74,
    tieMargin = 0.08,
    maxSuggestions = 3,
  } = {}
) {
  const requestedName = String(query ?? "").trim();
  const pool = Array.isArray(candidates) && candidates.length
    ? candidates
    : Array.isArray(allExercises)
      ? allExercises
      : [];
  if (!requestedName || !pool.length) {
    return toNeedsReview(requestedName, [], maxSuggestions);
  }

  const queryId = Number.parseInt(requestedName, 10);
  if (Number.isFinite(queryId) && pool.some((exercise) => exercise?.id === queryId)) {
    const matched = pool.find((exercise) => exercise?.id === queryId);
    return {
      status: "resolved",
      exerciseId: queryId,
      name: matched?.name ?? "Unknown Exercise",
      score: 1,
      matchedBy: "id_exact",
    };
  }

  const queryNormalized = normalizeExerciseString(requestedName);
  const queryTokenSet = toTokenSet(queryNormalized);
  const index = buildSearchIndex(pool);
  const exactIds = index.normalizedNameIndex.get(queryNormalized) ?? [];
  if (exactIds.length === 1) {
    const matched = index.byId.get(exactIds[0]);
    return {
      status: "resolved",
      exerciseId: exactIds[0],
      name: matched?.name ?? "Unknown Exercise",
      score: 1,
      matchedBy: "name_exact",
    };
  }
  if (exactIds.length > 1) {
    const ranked = exactIds
      .map((exerciseId) => ({
        exerciseId,
        name: index.byId.get(exerciseId)?.name ?? "Unknown Exercise",
        score: 1,
      }))
      .sort(compareScores);
    return toNeedsReview(requestedName, ranked, maxSuggestions);
  }

  const ranked = pool
    .map((exercise) => {
      const entry = toSearchEntry(exercise);
      const score = entry.names.reduce((best, label) => {
        return Math.max(best, scoreNameAgainstQuery(queryNormalized, queryTokenSet, label));
      }, 0);
      return {
        exerciseId: exercise?.id ?? null,
        name: entry.name,
        score,
      };
    })
    .filter((entry) => entry.exerciseId != null)
    .sort(compareScores);

  if (!ranked.length || ranked[0].score < threshold) {
    return toNeedsReview(
      requestedName,
      ranked.filter((entry) => entry.score >= 0.35),
      maxSuggestions
    );
  }

  const top = ranked[0];
  const second = ranked[1];
  if (second && top.score - second.score <= tieMargin) {
    return toNeedsReview(
      requestedName,
      ranked.filter((entry) => entry.score >= Math.max(0.4, top.score - 0.12)),
      maxSuggestions
    );
  }

  return {
    status: "resolved",
    exerciseId: top.exerciseId,
    name: top.name,
    score: Number(top.score.toFixed(3)),
    matchedBy: "fuzzy",
  };
}
