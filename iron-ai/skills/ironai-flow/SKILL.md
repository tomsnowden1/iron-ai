---
name: ironai-flow
description: Execute the iron-ai delivery workflow in Codex: run prep checks, output a short pre-code plan with file list and steps, implement minimal safe changes in the React + Vite + Tailwind repo, run required validation commands, commit on a dedicated codex/* branch, and provide local handoff instructions without shipping to main. Use when a user asks for prep -> implement -> test/build -> commit -> handoff execution.
---

# IronAI Flow

Follow this workflow exactly.

## Core rules

- Keep diffs minimal and avoid unrelated refactors.
- Never push or merge to `main`.
- Never ship to production.
- Never overwrite the user's local state.
- If local may be dirty, instruct the user to run `git stash -u` before applying changes.
- Use a dedicated branch named `codex/<slug>-<YYYYMMDD-HHMM>`.

## Phase 1: Prep

Run and report:

- `git status --porcelain`
- `git rev-parse --abbrev-ref HEAD`
- `git worktree list` (if available)

Then run:

- `npm ci`

Before writing code, output a short plan with:

- file list
- step list

## Phase 2: Implement

- Implement step-by-step.
- Keep scope tightly aligned to the request.

## Phase 3: Validate (required)

Run in this order before marking work done:

- `npm ci`
- `npm test` (or `npm run test`)
- `npm run build`
- `npm run lint` (only if `package.json` defines `lint`)

Then show:

- `git diff --stat`
- short summary of changes

## Phase 4: Commit

- Commit changes with a clear message on the `codex/*` branch.
- Do not merge.

## Phase 5: Handoff output

Always include:

- branch name
- Codex click-path: `Hand off to local → Apply (never overwrite)`
- local commands:
  - `git status`
  - `ironai-local` (or `./scripts/ironai-local.sh`)
- a 30-second smoke-test checklist
