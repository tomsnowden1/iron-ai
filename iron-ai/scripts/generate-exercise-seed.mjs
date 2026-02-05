import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const INPUT_PATH = path.resolve(process.cwd(), "public", "seed", "exercises.json");
const OUTPUT_PATH = path.resolve(
  process.cwd(),
  "public",
  "seed",
  "exercises.inapp.300.json"
);
const MAX_IN_APP = 300;

function hashPayload(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function run() {
  const raw = await fs.readFile(INPUT_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected public/seed/exercises.json to contain an array.");
  }

  const inApp = parsed.slice(0, MAX_IN_APP);
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(inApp, null, 2)}\n`, "utf-8");

  console.log(
    `[seed] wrote ${inApp.length} exercises to public/seed/exercises.inapp.300.json (sha256=${hashPayload(
      inApp
    )})`
  );
}

run().catch((error) => {
  console.error(`[seed] generate-exercise-seed failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
