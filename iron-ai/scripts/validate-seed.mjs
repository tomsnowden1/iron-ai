import fs from "fs/promises";
import path from "path";

import { validateSeedPayload } from "../src/seed/seedValidation.js";
const SEED_VERSION = "2026-01-14-free-exercise-db-v3";
const SEED_VERSION_NUMBER = 3;

const SEED_MIN_COUNT = 300;

const filePath = path.resolve(process.cwd(), "public", "seed", "exercises.json");
const reportPath = path.resolve(
  process.cwd(),
  "src",
  "seed",
  "reports",
  "latestExerciseImportReport.json"
);

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
const report = {
  status: result.ok ? "validated" : "error",
  generatedAt: new Date().toISOString(),
  reportPath: "src/seed/reports/latestExerciseImportReport.json",
  seedVersion: SEED_VERSION,
  seedVersionNumber: SEED_VERSION_NUMBER,
  counts: {
    total: result.report.total,
    inserted: 0,
    updated: 0,
    skipped: 0,
    invalid: result.report.invalidCount,
    warnings: result.report.warningCount,
    errors: result.ok ? 0 : 1,
  },
  samples: {
    inserted: [],
    updated: [],
    skipped: [],
    invalid: result.report.invalidSamples
      .map((sample) => sample.name ?? `index:${sample.index}`)
      .slice(0, 5),
    warnings: result.report.warningSamples
      .map((sample) => sample.name ?? `index:${sample.index}`)
      .slice(0, 5),
    errors: result.ok ? [] : ["seed validation failed"],
  },
  warnings: {
    missingOptional: result.report.warningSamples,
    fetch: [],
  },
  errors: result.ok ? [] : ["seed validation failed"],
};

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (!result.ok) {
  const report = result.report;
  const summary = report.total < SEED_MIN_COUNT
    ? `Expected >= ${SEED_MIN_COUNT} records (found ${report.total}).`
    : `Found ${report.invalidCount} invalid records.`;
  console.error("Seed validation report:", report);
  fail(summary);
}

if (result.report.warningCount > 0) {
  console.warn(
    `Seed validation warnings: ${result.report.warningCount} records missing optional metadata.`
  );
}

console.log(`Seed validation passed: ${result.report.total} exercises found.`);
