import fs from "fs";
import path from "path";

const filePath = path.resolve(
  process.cwd(),
  "public",
  "seed",
  "exercises.json"
);

function fail(message) {
  console.error(`Seed validation failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  fail(`Missing seed file at ${filePath}`);
}

let raw;
try {
  raw = fs.readFileSync(filePath, "utf-8");
} catch (error) {
  fail(`Unable to read seed file: ${error.message}`);
}

let data;
try {
  data = JSON.parse(raw);
} catch (error) {
  fail(`Invalid JSON: ${error.message}`);
}

if (!Array.isArray(data)) {
  fail("Seed file must contain a JSON array.");
}

if (data.length < 300) {
  fail(`Seed file must contain at least 300 exercises (found ${data.length}).`);
}

console.log(`Seed validation passed: ${data.length} exercises found.`);
