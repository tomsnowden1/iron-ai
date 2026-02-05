#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

function read(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    fail(`cannot read ${filePath}: ${err.message}`);
    return null;
  }
}

const skillDir = process.argv[2];
if (!skillDir) {
  console.error('Usage: node scripts/quick-validate-skill-lite.mjs <path-to-skill>');
  process.exit(1);
}

const resolvedSkillDir = path.resolve(skillDir);
const skillMdPath = path.join(resolvedSkillDir, 'SKILL.md');
const openaiYamlPath = path.join(resolvedSkillDir, 'agents', 'openai.yaml');

if (!fs.existsSync(resolvedSkillDir)) fail(`skill directory not found: ${resolvedSkillDir}`);
if (!fs.existsSync(skillMdPath)) fail(`missing SKILL.md: ${skillMdPath}`);
if (!fs.existsSync(openaiYamlPath)) fail(`missing agents/openai.yaml: ${openaiYamlPath}`);
if (process.exitCode) process.exit(process.exitCode);

const skillMd = read(skillMdPath);
const openaiYaml = read(openaiYamlPath);
if (!skillMd || !openaiYaml) process.exit(process.exitCode || 1);

const fmMatch = skillMd.match(/^---\n([\s\S]*?)\n---\n/);
if (!fmMatch) fail('SKILL.md missing YAML frontmatter block');

const fm = fmMatch ? fmMatch[1] : '';
const nameMatch = fm.match(/^name:\s*(.+)\s*$/m);
const descriptionMatch = fm.match(/^description:\s*(.+)\s*$/m);
if (!nameMatch) fail('frontmatter missing "name"');
if (!descriptionMatch) fail('frontmatter missing "description"');

const skillName = nameMatch?.[1]?.trim()?.replace(/^"|"$/g, '') ?? '';
if (!/^[a-z0-9-]{1,64}$/.test(skillName)) {
  fail('name must match ^[a-z0-9-]{1,64}$');
}

if (descriptionMatch && descriptionMatch[1].trim().length < 20) {
  fail('description is too short; include purpose and trigger context');
}

if (!/^interface:\s*$/m.test(openaiYaml)) fail('openai.yaml missing top-level "interface"');
if (!/^\s+display_name:\s*.+$/m.test(openaiYaml)) fail('openai.yaml missing interface.display_name');
if (!/^\s+short_description:\s*.+$/m.test(openaiYaml)) fail('openai.yaml missing interface.short_description');

if (!process.exitCode) {
  ok(`validated skill: ${resolvedSkillDir}`);
}

process.exit(process.exitCode || 0);
