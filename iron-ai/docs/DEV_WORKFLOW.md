# Dev Workflow

Install dependencies
- `npm ci`

Run the app
- `npm run dev`

Lint the codebase
- `npm run lint`

Run tests
- `npm test`

Build
- `npm run build`
- The build runs a guard (`check:src-node-builtins`) to block Node builtins (`fs`, `path`, `crypto`) in `src/`.

## Git safety defaults (recommended one-time setup)
Why:
- Keeps history linear (`pull.rebase=true`)
- Prevents local work from being lost during rebase (`rebase.autoStash=true`)
- Optionally blocks accidental merge commits from pull (`pull.ff=only`)

Commands:
- `git config --global pull.rebase true`
- `git config --global rebase.autoStash true`
- `git config --global pull.ff only` (optional)

## Default shipping flow (safe path to Vercel production)
Use this every day:
1. Commit on your working branch.
2. Run `npm run prmain`.
3. Wait for CI checks to pass.
4. GitHub auto-merges to `main`.
5. Vercel deploys production from updated `main`.

What `npm run prmain` does:
- Creates a shipping branch like `ship/YYYYMMDD-HHMM` from current `HEAD`
- Pushes that branch
- Creates a PR to `main`
- Adds label `automerge`
- Enables auto-merge with squash + delete branch

If setup is missing, `prmain` stops and explains how to fix it.

Required repo setup for `prmain`:
- Label `automerge` exists
  - `gh label create automerge --color 0E8A16 --description "Enable auto-merge when CI passes"`
- Repo has auto-merge enabled in GitHub settings
- GitHub Actions are enabled
- Workflow `.github/workflows/enable-automerge.yml` is enabled

## Sync main (utility only)
`npm run shipmain` is only for syncing `main`; it does not ship feature code.

What it does:
- Switches to `main`
- Runs `git fetch`
- Runs `git pull --rebase --autostash origin main`
- Runs `git push origin main`

Use this when you want a clean, up-to-date local `main` before starting new work.

## Backup checkpoint (optional cheap insurance)
Run before bigger changes or risky refactors:
- `npm run backupmain`

What it does:
- Creates annotated tag `backup/main-YYYYMMDD-HHMM`
- Pushes tag to `origin`

Important:
- Do not create or commit local `backups/` folders for this workflow.

## Rollback options
If a bad change reaches production:
1. Revert the merge commit on `main` (GitHub UI or `git revert <merge_sha>` in a PR), then merge the revert.
2. Roll back in Vercel to the previous healthy deployment.

## Diagnostics
- Enable via URL: append `?debug=1` to the app URL (example: `http://localhost:5173/?debug=1`).
- Or set localStorage: `localStorage.setItem("ironai.diagnosticsEnabled", "true")`.
- Open the Diagnostics panel from **More → Diagnostics** (visible only when debug is enabled).

## Seed generation
- Regenerate in-app seed slice from `public/seed/exercises.json`:
  - `npm run generate:exercise-seed`

## Pre-commit hook setup
- `npm run prepare`
- The pre-commit hook runs `npm run lint` and `npm run format`.
