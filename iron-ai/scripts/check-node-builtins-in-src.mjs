import fs from "node:fs/promises";
import path from "node:path";

const SRC_ROOT = path.resolve(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const BLOCKED_BUILTINS = new Set(["fs", "path", "crypto"]);

const importPattern =
  /(?:import|export)\s+[\s\S]*?\sfrom\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(fullPath);
      return fullPath;
    })
  );
  return files.flat();
}

function isBlockedSpecifier(specifier) {
  if (!specifier) return false;
  const clean = specifier.trim();
  if (!clean) return false;
  const withoutNodePrefix = clean.startsWith("node:") ? clean.slice(5) : clean;
  const root = withoutNodePrefix.split("/")[0];
  return BLOCKED_BUILTINS.has(root);
}

async function run() {
  const allFiles = await listFiles(SRC_ROOT);
  const sourceFiles = allFiles.filter((filePath) =>
    SOURCE_EXTENSIONS.has(path.extname(filePath))
  );

  const violations = [];

  for (const filePath of sourceFiles) {
    const content = await fs.readFile(filePath, "utf-8");
    importPattern.lastIndex = 0;

    let match = importPattern.exec(content);
    while (match) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? "";
      if (isBlockedSpecifier(specifier)) {
        violations.push({
          file: path.relative(process.cwd(), filePath),
          specifier,
        });
      }
      match = importPattern.exec(content);
    }
  }

  if (violations.length > 0) {
    console.error("Blocked Node builtin import(s) found in src/:\n");
    violations.forEach((violation) => {
      console.error(`- ${violation.file} -> ${violation.specifier}`);
    });
    process.exitCode = 1;
    return;
  }

  console.log("[check-node-builtins] src/ is browser-safe (no blocked Node builtins).");
}

run().catch((error) => {
  console.error(`[check-node-builtins] failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
