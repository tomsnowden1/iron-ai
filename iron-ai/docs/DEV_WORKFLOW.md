# Dev Workflow

Install dependencies
- `npm install`

Run the app
- `npm run dev`

Lint the codebase
- `npm run lint`

Format the codebase
- `npm run format`

Run all checks (lint + format check)
- `npm run check`

Build
- `npm run build`
- The build now runs a guard (`check:src-node-builtins`) to block Node builtins (`fs`, `path`, `crypto`) in `src/`.

Seed generation
- Regenerate in-app seed slice from `public/seed/exercises.json`:
  - `npm run generate:exercise-seed`

Pre-commit hook setup
- `npm run prepare`

Notes
- The pre-commit hook runs `npm run lint` and `npm run format`.
- Shipping helpers:
  - `npm run shipmain` (sync `main`, push branch, open/update PR, best-effort automerge setup)
  - `npm run prmain` (open/update PR from current branch to `main`, add `automerge` label)

Diagnostics
- Enable via URL: append `?debug=1` to the app URL (ex: `http://localhost:5173/?debug=1`).
- Or set localStorage: `localStorage.setItem("ironai.diagnosticsEnabled", "true")`.
- Open the Diagnostics panel from **More → Diagnostics** (only visible when debug is enabled).

Shipping (one-run)
- One-time: `chmod +x scripts/ship.sh`
- Run from a feature branch (or pass one to auto-create):
  - `scripts/ship.sh fix/ship-my-change "chore: ship my change"`
  - `scripts/ship.sh --auto-branch "chore: ship my change"`
- Requires `gh` for PR + auto-merge. If `gh` is missing, the script will fall back to `git prmain`/`git shipmain` when available or print manual steps.
