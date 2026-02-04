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

Shipping
- `npm run shipmain` from a clean feature branch.
  - Syncs local `main` using `git fetch origin` + `git pull --rebase --autostash origin main`.
  - Stops with conflict instructions if `main` cannot be rebased cleanly.
  - Pushes the current branch, then runs `npm run prmain` best effort.
- `npm run prmain`
  - Creates or reuses a PR into `main`.
  - Best-effort creates/applies the `automerge` label.
  - Attempts `gh pr merge --auto`; if repo settings block it, prints GitHub UI steps and exits successfully.
