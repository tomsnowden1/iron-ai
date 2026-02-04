import fs from "node:fs/promises";
import path from "node:path";

import { EQUIPMENT_CATALOG, EQUIPMENT_ID_SET } from "../src/equipment/catalog.js";
import { inferExerciseEquipment } from "../src/equipment/inference.js";
import {
  computeStableId,
  normalizeString,
  slugify,
} from "./lib/seed-node-utils.mjs";

const SOURCE_URL =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";

const argv = new Set(process.argv.slice(2));
const includeImages = argv.has("--images");

const nowIso = () => new Date().toISOString();

const EQUIPMENT_ALIAS_MAP = new Map();

const addEquipmentAlias = (alias, id) => {
  const key = normalizeString(alias).toLowerCase();
  if (!key) return;
  EQUIPMENT_ALIAS_MAP.set(key, id);
};

EQUIPMENT_CATALOG.forEach((item) => {
  addEquipmentAlias(item.id, item.id);
  addEquipmentAlias(item.name, item.id);
  (item.aliases ?? []).forEach((alias) => addEquipmentAlias(alias, item.id));
});

const EXTRA_EQUIPMENT_ALIASES = {
  "body only": "bodyweight",
  bodyweight: "bodyweight",
  kettlebell: "dumbbell",
  kettlebells: "dumbbell",
  "hex bar": "trap_bar",
  "trap bar": "trap_bar",
  "ez bar": "ez_bar",
  "pull up bar": "pullup_bar",
  "pull-up bar": "pullup_bar",
  "lat pulldown": "lat_pulldown_machine",
  "leg press": "leg_press_machine",
  "leg extension": "leg_extension_machine",
  "leg curl": "leg_curl_machine",
  "calf raise": "calf_raise_machine",
  "cable machine": "cable_machine",
  cable: "cable_machine",
  "stationary bike": "stationary_bike",
  bike: "stationary_bike",
  "rowing machine": "rower",
  rower: "rower",
};

Object.entries(EXTRA_EQUIPMENT_ALIASES).forEach(([alias, id]) => {
  addEquipmentAlias(alias, id);
});

const normalizeStringList = (value, { splitNewlines = true } = {}) => {
  const list = Array.isArray(value) ? value : value != null ? [value] : [];
  const expanded = list.flatMap((item) => {
    if (splitNewlines && typeof item === "string" && item.includes("\n")) {
      return item.split(/\r?\n+/);
    }
    return item;
  });
  const normalized = expanded
    .map((item) => normalizeString(item))
    .filter((item) => item.length > 0);
  return Array.from(new Set(normalized));
};

const normalizeEquipmentList = (value) => {
  const list = Array.isArray(value) ? value : value != null ? [value] : [];
  const expanded = list.flatMap((item) => {
    if (typeof item === "string" && item.includes(",")) {
      return item.split(",");
    }
    return item;
  });
  return normalizeStringList(expanded, { splitNewlines: false });
};

const filterEquipmentIds = (list) =>
  Array.from(new Set(list.filter((id) => EQUIPMENT_ID_SET.has(id))));

const mapEquipmentIds = (value) => {
  const list = normalizeEquipmentList(value);
  const mapped = [];

  list.forEach((item) => {
    const key = item.toLowerCase();
    if (EQUIPMENT_ALIAS_MAP.has(key)) {
      mapped.push(EQUIPMENT_ALIAS_MAP.get(key));
      return;
    }
    if (key.includes("kettlebell")) {
      mapped.push("dumbbell");
      return;
    }
    if (key.includes("barbell")) {
      mapped.push("barbell");
      return;
    }
    if (key.includes("trap bar") || key.includes("hex bar")) {
      mapped.push("trap_bar");
      return;
    }
    if (key.includes("ez bar") || key.includes("curl bar")) {
      mapped.push("ez_bar");
      return;
    }
    if (key.includes("dumbbell")) {
      mapped.push("dumbbell");
      return;
    }
    if (key.includes("bench")) {
      mapped.push("bench");
      return;
    }
    if (key.includes("cable")) {
      mapped.push("cable_machine");
      return;
    }
    if (key.includes("lat pulldown")) {
      mapped.push("lat_pulldown_machine");
      return;
    }
    if (key.includes("leg press")) {
      mapped.push("leg_press_machine");
      return;
    }
    if (key.includes("leg extension")) {
      mapped.push("leg_extension_machine");
      return;
    }
    if (key.includes("leg curl")) {
      mapped.push("leg_curl_machine");
      return;
    }
    if (key.includes("calf raise")) {
      mapped.push("calf_raise_machine");
      return;
    }
    if (key.includes("pull up") || key.includes("pull-up")) {
      mapped.push("pullup_bar");
      return;
    }
    if (key.includes("dip")) {
      mapped.push("dip_station");
      return;
    }
    if (key.includes("treadmill")) {
      mapped.push("treadmill");
      return;
    }
    if (key.includes("bike")) {
      mapped.push("stationary_bike");
      return;
    }
    if (key.includes("row")) {
      mapped.push("rower");
      return;
    }
    if (key.includes("body only") || key.includes("bodyweight")) {
      mapped.push("bodyweight");
    }
  });

  return filterEquipmentIds(mapped);
};

const pick = (record, keys) => {
  for (const key of keys) {
    if (record?.[key] !== undefined && record?.[key] !== null) return record[key];
  }
  return undefined;
};

const extractName = (record) =>
  normalizeString(pick(record, ["name", "exercise_name", "exerciseName", "title"]));

const normalizeRecord = async (record, now) => {
  const name = extractName(record) || "Unnamed Exercise";
  const rawId = pick(record, ["externalId", "external_id", "id", "_id"]);
  const sourceId = normalizeString(rawId) || null;
  const slugBase = slugify(name || sourceId || "exercise");
  const slug = sourceId ? `${sourceId}-${slugBase || "exercise"}` : slugBase || "exercise";

  const primaryRaw = normalizeStringList(
    pick(record, [
      "primaryMuscles",
      "primary_muscles",
      "primary_muscle",
      "primary",
      "muscle_group",
    ])
  );
  const muscleGroupRaw = normalizeString(pick(record, ["muscle_group", "muscleGroup"]));
  const primaryMuscles = primaryRaw.length
    ? primaryRaw
    : muscleGroupRaw
      ? [muscleGroupRaw]
      : ["full body"];
  const muscleGroup = muscleGroupRaw || primaryMuscles[0] || "full body";

  const secondaryMuscles = normalizeStringList(
    pick(record, ["secondaryMuscles", "secondary_muscles", "secondary_muscle", "secondary"])
  );
  const equipmentRaw = pick(record, [
    "equipment",
    "equipmentList",
    "requiredEquipment",
    "required_equipment",
    "equipment_list",
    "equipment_required",
    "equipment_ids",
  ]);
  const instructions = normalizeStringList(
    pick(record, ["instructions", "steps", "execution", "howTo"])
  );
  const gotchas = normalizeStringList(pick(record, ["gotchas", "tips", "cues"]));
  const commonMistakes = normalizeStringList(
    pick(record, ["commonMistakes", "common_mistakes", "mistakes"])
  );
  const progressions = normalizeStringList(
    pick(record, ["progressions", "progression", "advanced_exercises"])
  );
  const regressions = normalizeStringList(
    pick(record, ["regressions", "regression", "beginner_exercises"])
  );
  const aliases = normalizeStringList(pick(record, ["aliases", "alternativeNames", "aka"]));

  const category = normalizeString(
    pick(record, ["category", "type", "movement", "bodyPart"])
  );
  const pattern = normalizeString(
    pick(record, ["pattern", "mechanic", "mechanics", "force"])
  );
  const status = normalizeString(record?.status) || "extended";
  const youtubeSearchQuery =
    normalizeString(record?.youtubeSearchQuery) ||
    (name ? `${name} exercise form cues` : "");
  const youtubeVideoId =
    typeof record?.youtubeVideoId === "string" && record.youtubeVideoId.trim()
      ? record.youtubeVideoId.trim()
      : null;
  const mediaVideoUrl = normalizeString(
    record?.media?.videoUrl ?? record?.videoUrl ?? record?.video_url
  );
  const media = mediaVideoUrl ? { videoUrl: mediaVideoUrl } : undefined;

  const mappedEquipment = mapEquipmentIds(equipmentRaw);
  const inferredEquipment = inferExerciseEquipment({ name });
  const requiredEquipmentIds = filterEquipmentIds([
    ...mappedEquipment,
    ...(inferredEquipment.requiredEquipmentIds ?? []),
  ]);
  const optionalEquipmentIds = filterEquipmentIds(
    inferredEquipment.optionalEquipmentIds ?? []
  );
  const equipment = requiredEquipmentIds.length ? requiredEquipmentIds : ["bodyweight"];

  const stableId = computeStableId({
    source: "free-exercise-db",
    sourceId,
    externalId: sourceId,
    name,
    equipment,
    primaryMuscles,
    pattern: pattern || undefined,
    category: category || undefined,
  });

  return {
    stableId,
    slug,
    name,
    muscle_group: muscleGroup,
    default_sets: 3,
    default_reps: null,
    primaryMuscles,
    secondaryMuscles,
    instructions,
    gotchas,
    commonMistakes: commonMistakes.length ? commonMistakes : gotchas,
    progressions,
    regressions,
    aliases,
    equipment,
    requiredEquipmentIds,
    optionalEquipmentIds,
    category,
    pattern,
    status,
    youtubeSearchQuery,
    youtubeVideoId,
    media,
    source: "free-exercise-db",
    sourceId,
    sourceKey: sourceId,
    externalId: sourceId,
    is_custom: false,
    createdAt: now,
    updatedAt: now,
  };
};

const writeJsonAtomic = async (filePath, data) => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.tmp-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  );
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  await fs.rename(tmpPath, filePath);
};

const logSeedSummary = (raw, transformed, inapp) => {
  const rawNames = raw.map(extractName).filter(Boolean);
  const firstThree = rawNames.slice(0, 3);
  const lastThree = rawNames.slice(-3);
  console.log(`[seed:freeex] raw count: ${raw.length}`);
  console.log(`[seed:freeex] transformed count: ${transformed.length}`);
  console.log(`[seed:freeex] in-app count: ${inapp.length}`);
  console.log(
    `[seed:freeex] raw names (first 3): ${firstThree.join(" | ") || "n/a"}`
  );
  console.log(
    `[seed:freeex] raw names (last 3): ${lastThree.join(" | ") || "n/a"}`
  );
};

const run = async () => {
  console.log(
    `[seed:freeex] ${nowIso()} cwd=${process.cwd()} node=${process.version}`
  );
  if (includeImages) {
    console.log("[seed:freeex] --images provided (no image download in this script).");
  }

  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to download dataset (${response.status} ${response.statusText})`);
  }
  const raw = await response.json();
  if (!Array.isArray(raw)) {
    throw new Error("Downloaded dataset is not an array.");
  }

  const timestamp = Date.now();
  const transformed = await Promise.all(
    raw.map((record) => normalizeRecord(record, timestamp))
  );
  const inapp = transformed.slice(0, 300);

  const seedDir = path.resolve(process.cwd(), "public", "seed");
  await writeJsonAtomic(path.join(seedDir, "free-exercise-db.raw.json"), raw);
  await writeJsonAtomic(
    path.join(seedDir, "exercises.full.transformed.json"),
    transformed
  );
  await writeJsonAtomic(path.join(seedDir, "exercises.inapp.300.json"), inapp);
  await writeJsonAtomic(path.join(seedDir, "exercises.json"), transformed);

  logSeedSummary(raw, transformed, inapp);
};

try {
  await run();
} catch (error) {
  console.error("[seed:freeex] failed:", error?.stack || error?.message || error);
  process.exitCode = 1;
}
