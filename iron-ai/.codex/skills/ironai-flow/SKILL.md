--- 
name: ironai-flow
description: Prep, implement, validate, commit, then hand off safely to local.
---

Before writing code, output a short plan with file list and steps. Then implement step-by-step.

You are working in the iron-ai repo (React + Vite + Tailwind). Optimize for small, safe changes.

Goal workflow:
- You (Codex) do prep + implementation + tests + build inside your environment.
- You work on a dedicated branch: codex/<slug>-<YYYYMMDD-HHMM>.
- You do NOT push/merge to main directly. Use a PR.
- You provide handoff steps so I can Apply to local and run ironai-local.

Hard rules:
- Never overwrite local.
- If local may be dirty, instruct: `git stash -u` before applying.

START (always):
- git status --porcelain
- git rev-parse --abbrev-ref HEAD
- git worktree list (if available)
- npm ci

IMPLEMENTATION:
- Minimal diffs, no unrelated refactors.

VALIDATE (required before “done”):
- npm ci
- npm test (or npm run test)
- npm run build
- npm run lint (only if package.json has lint)

FINISH:
- Show git diff --stat
- Summarize changes
- Commit with a clear message
- Push branch to origin (if available)
- Create PR to main (if possible)
- Provide how to enable auto-merge (or exact GitHub UI steps)

HANDOFF OUTPUT:
- Branch name
- PR link (if created)
- Codex click-path: Hand off to local → Apply (never overwrite)
- Local commands: git status, ironai-local
- 30-second smoke-test checklist
