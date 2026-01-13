import fs from "fs/promises";
import path from "path";

import { validateSeedPayload } from "../src/seed/seedValidation.js";

const SEED_MIN_COUNT = 300;

const filePath = path.resolve(process.cwd(), "public", "seed", "exercises.json");

function fail(message) {
  console.error(`Seed validation failed: ${message}`);
  process.exit(1);
}

let raw;
try {
  raw = await fs.readFile(filePath, "utf-8");
} catch (error) {
  fail(`Missing seed file at ${filePath}: ${error.message}`);
}

let data;
try {
  data = JSON.parse(raw);
} catch (error) {
  fail(`Invalid JSON: ${error.message}`);
}

const result = validateSeedPayload(data, { minCount: SEED_MIN_COUNT });
if (!result.ok) {
  const report = result.report;
  const summary = report.total < SEED_MIN_COUNT
    ? `Expected >= ${SEED_MIN_COUNT} records (found ${report.total}).`
    : `Found ${report.invalidCount} invalid records.`;
  console.error("Seed validation report:", report);
  fail(summary);
}

console.log(`Seed validation passed: ${result.report.total} exercises found.`);
