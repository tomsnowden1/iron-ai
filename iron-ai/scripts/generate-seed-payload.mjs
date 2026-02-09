import fs from "fs/promises";
import path from "path";

const inputPath = path.resolve(process.cwd(), "public", "seed", "exercises.json");
const outputPath = path.resolve(
  process.cwd(),
  "src",
  "data",
  "exercisesSeedPayload.js"
);

const raw = await fs.readFile(inputPath, "utf-8");
const data = JSON.parse(raw);

const payload = `// Auto-generated from public/seed/exercises.json
// Do not edit directly; run npm run generate:seed-payload
export default ${JSON.stringify(data)};
`;

await fs.writeFile(outputPath, payload, "utf-8");
console.log(`Generated bundled seed payload at ${outputPath}`);
