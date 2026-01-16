import fs from "fs/promises";
import path from "path";

import { validateSeedPayload } from "../src/seed/seedValidation.js";

const SEED_VERSION = "2026-01-14-free-exercise-db-v3";
const SEED_VERSION_NUMBER = 3;
const SEED_MIN_COUNT = 300;

const argv = new Set(process.argv.slice(2));
const useInapp = argv.has("--inapp");

function fail(message) {
  console.error(`Seed validation failed: ${message}`);
  process.exit(1);
}

const loadJson = async (filePath) => {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    fail(`Missing seed file at ${filePath}: ${error.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`Invalid JSON: ${error.message}`);
  }
};

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isNonEmptyArray = (value) =>
  Array.isArray(value) && value.some((item) => isNonEmptyString(item));
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const runInappValidation = async () => {
  const filePath = path.resolve(
    process.cwd(),
    "public",
    "seed",
    "exercises.inapp.300.json"
  );
  const data = await loadJson(filePath);
  if (!Array.isArray(data)) {
    fail("Seed payload must be an array.");
  }

  const checks = [
    { key: "name", label: "name", test: isNonEmptyString },
    { key: "slug", label: "slug", test: isNonEmptyString },
    { key: "primaryMuscles", label: "primaryMuscles", test: isNonEmptyArray },
    { key: "instructions", label: "instructions", test: isNonEmptyArray },
    { key: "equipment", label: "equipment", test: isNonEmptyArray },
    {
      key: "requiredEquipmentIds",
      label: "requiredEquipmentIds",
      test: isNonEmptyArray,
    },
    { key: "source", label: "source", test: isNonEmptyString },
    { key: "is_custom", label: "is_custom", test: (value) => typeof value === "boolean" },
    { key: "createdAt", label: "createdAt", test: isFiniteNumber },
    { key: "updatedAt", label: "updatedAt", test: isFiniteNumber },
  ];

  const missingCounts = Object.fromEntries(checks.map((check) => [check.label, 0]));

  data.forEach((record) => {
    checks.forEach((check) => {
      if (!check.test(record?.[check.key])) {
        missingCounts[check.label] += 1;
      }
    });
  });

  console.log(`Seed validation (inapp.300): ${data.length} records`);
  Object.entries(missingCounts).forEach(([label, count]) => {
    console.log(`- missing ${label}: ${count}`);
  });

  const totalMissing = Object.values(missingCounts).reduce((sum, count) => sum + count, 0);
  if (totalMissing > 0) {
    process.exit(1);
  }

  console.log("Seed validation passed: all required fields present.");
};

const runFullValidation = async () => {
  const filePath = path.resolve(process.cwd(), "public", "seed", "exercises.json");
  const reportPath = path.resolve(
    process.cwd(),
    "src",
    "seed",
    "reports",
    "latestExerciseImportReport.json"
  );

  const data = await loadJson(filePath);
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
    const summary =
      report.total < SEED_MIN_COUNT
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
};

if (useInapp) {
  await runInappValidation();
} else {
  await runFullValidation();
}
