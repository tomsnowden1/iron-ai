#!/usr/bin/env node
/**
 * Fetch yuhonas/free-exercise-db combined dataset + (optional) images,
 * then output transformed seed JSON files:
 * - public/seed/exercises.full.transformed.json  (800+)
 * - public/seed/exercises.inapp.300.json         (300 for app)
 *
 * Usage:
 *   node scripts/free-exercise-db.seed.mjs
 *   node scripts/free-exercise-db.seed.mjs --images
 *
 * Env:
 *   INAPP_LIMIT=300        (default 300)
 *   IMAGES_CONCURRENCY=10  (default 10)
 *   MAX_IMAGES=0           (0 = no limit)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATASET_URL =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
const IMAGE_BASE =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

const args = new Set(process.argv.slice(2));
const withImages = args.has("--images");

const INAPP_LIMIT = Number(process.env.INAPP_LIMIT || 300);
const IMAGES_CONCURRENCY = Math.max(1, Number(process.env.IMAGES_CONCURRENCY || 10));
const MAX_IMAGES = Math.max(0, Number(process.env.MAX_IMAGES || 0));

const OUT_SEED_DIR = path.resolve("public/seed");
const OUT_IMG_DIR = path.resolve("public/exercise-images");

const OUT_RAW = path.join(OUT_SEED_DIR, "free-exercise-db.raw.json");
const OUT_FULL = path.join(OUT_SEED_DIR, "exercises.full.transformed.json");
const OUT_INAPP = path.join(OUT_SEED_DIR, `exercises.inapp.${INAPP_LIMIT}.json`);

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function fetchText(url, attempt = 1) {
  const res = await fetch(url);
  if (!res.ok) {
    // quick retry for transient failures
    if (attempt < 3) return fetchText(url, attempt + 1);
    throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.text();
}

function writeAtomic(filePath, contents) {
  const tmp = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

function stableIdFromRaw(raw) {
  // Prefer dataset id; else derive a stable id.
  const base = raw?.id || raw?.name || JSON.stringify(raw);
  return String(base).trim().replace(/\s+/g, "_");
}

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 12);
}

/**
 * Transform into a richer “IronAI-like” object.
 * IMPORTANT: This is a best-guess shape.
 * In the next Codex chunk we will align EXACTLY to your app’s Exercise model/Dexie schema.
 */
function transformExercise(raw) {
  const idBase = stableIdFromRaw(raw);
  const id = idBase.length > 0 ? idBase : `ex_${sha1(JSON.stringify(raw))}`;

  const images = Array.isArray(raw.images) ? raw.images.filter(Boolean) : [];
  const imageUrls = images.map((imgPath) => `/exercise-images/${imgPath}`);

  // Normalize equipment: dataset uses a string; many apps want array.
  const equipmentArr = raw.equipment ? [String(raw.equipment)] : [];

  // Instructions: keep array; many apps also want gotchas (leave empty for now).
  const instructions = Array.isArray(raw.instructions) ? raw.instructions.filter(Boolean) : [];

  // Some apps want “muscles” as arrays; keep both primary/secondary.
  const primaryMuscles = Array.isArray(raw.primaryMuscles) ? raw.primaryMuscles.filter(Boolean) : [];
  const secondaryMuscles = Array.isArray(raw.secondaryMuscles) ? raw.secondaryMuscles.filter(Boolean) : [];

  return {
    // Common fields most apps expect
    id,
    name: raw.name || id.replace(/_/g, " "),
    source: "free-exercise-db",
    isCustom: false,

    // Taxonomy
    category: raw.category ?? null,
    force: raw.force ?? null,
    level: raw.level ?? null,
    mechanic: raw.mechanic ?? null,

    // Equipment/muscles
    equipment: equipmentArr,
    primaryMuscles,
    secondaryMuscles,

    // How-to
    instructions,
    gotchas: [],          // app can fill later
    cues: [],             // optional for coaching later
    aliases: [],          // optional for search later

    // Media
    images,               // original relative paths for traceability
    imageUrls,            // local browser-usable paths
    videoUrl: null,       // optional later

    // Extra fields many apps have
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function downloadFile(url, outPath) {
  // Resume-friendly: skip if exists
  if (fs.existsSync(outPath)) return { status: "skipped" };

  const res = await fetch(url);
  if (!res.ok) {
    return { status: "failed", reason: `${res.status} ${res.statusText}` };
  }
  const buf = Buffer.from(await res.arrayBuffer());

  mkdirp(path.dirname(outPath));
  fs.writeFileSync(outPath, buf);
  return { status: "downloaded" };
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let idx = 0;

  async function runner() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, runner);
  await Promise.all(runners);
  return results;
}

async function main() {
  mkdirp(OUT_SEED_DIR);
  mkdirp(OUT_IMG_DIR);

  console.log(`Fetching dataset: ${DATASET_URL}`);
  const txt = await fetchText(DATASET_URL);
  const rawArr = JSON.parse(txt);

  if (!Array.isArray(rawArr)) {
    throw new Error("Dataset JSON is not an array");
  }

  const isJunkExerciseName = (name) => /^Exercise\s+\d+$/.test(String(name || "").trim());
  const filteredRaw = rawArr.filter((ex) => !isJunkExerciseName(ex?.name));

  writeAtomic(OUT_RAW, JSON.stringify(filteredRaw, null, 2));

  const removedCount = rawArr.length - filteredRaw.length;
  console.log(`Raw count: ${rawArr.length} (removed junk: ${removedCount})`);
  console.log(`First 3: ${filteredRaw.slice(0, 3).map((x) => x?.name).join(" | ")}`);
  console.log(
    `Last 3: ${filteredRaw.slice(-3).map((x) => x?.name).join(" | ")}`
  );

  const transformedFull = filteredRaw.map(transformExercise);
  writeAtomic(OUT_FULL, JSON.stringify(transformedFull, null, 2));

  const inApp = transformedFull.slice(0, INAPP_LIMIT);
  writeAtomic(OUT_INAPP, JSON.stringify(inApp, null, 2));

  console.log(`Wrote: ${path.relative(process.cwd(), OUT_FULL)} (${transformedFull.length})`);
  console.log(`Wrote: ${path.relative(process.cwd(), OUT_INAPP)} (${inApp.length})`);

  if (!withImages) {
    console.log("Done (no images). Run with --images to download photos.");
    return;
  }

  // Flatten all image paths from FULL dataset
  let imagePaths = transformedFull.flatMap((ex) => (Array.isArray(ex.images) ? ex.images : []));
  imagePaths = imagePaths.filter(Boolean);

  if (MAX_IMAGES > 0) imagePaths = imagePaths.slice(0, MAX_IMAGES);

  // De-dupe
  const uniq = Array.from(new Set(imagePaths));

  console.log(`Images referenced: ${imagePaths.length} (unique: ${uniq.length})`);
  console.log(`Downloading to: ${path.relative(process.cwd(), OUT_IMG_DIR)}`);
  console.log(`Concurrency: ${IMAGES_CONCURRENCY}`);

  let downloaded = 0, skipped = 0, failed = 0;
  const failures = [];

  await runPool(uniq, IMAGES_CONCURRENCY, async (imgPath, i) => {
    const url = `${IMAGE_BASE}${imgPath}`;
    const outPath = path.join(OUT_IMG_DIR, imgPath);

    const r = await downloadFile(url, outPath);
    if (r.status === "downloaded") downloaded++;
    else if (r.status === "skipped") skipped++;
    else {
      failed++;
      if (failures.length < 10) failures.push({ imgPath, url, reason: r.reason });
    }

    if ((i + 1) % 100 === 0 || i === uniq.length - 1) {
      console.log(`Progress: ${i + 1}/${uniq.length} | dl=${downloaded} skip=${skipped} fail=${failed}`);
    }
  });

  console.log(`Images done. dl=${downloaded} skip=${skipped} fail=${failed}`);
  if (failures.length) {
    console.log("First failures:");
    for (const f of failures) console.log(`- ${f.imgPath} (${f.reason})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
