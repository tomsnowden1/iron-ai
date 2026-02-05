---
name: ironai-ship
description: Validate, push branch, open PR, enable auto-merge, then hand off safely.
---

Goal: Take the current branch changes and get them ready to merge into main via PR + auto-merge, plus make local verification easy.

Rules:
- Never overwrite local.
- Do not push directly to main.
- Prefer PR + auto-merge.
- Ensure tests/build are green before shipping.

Steps:
1) Confirm state:
   - git status --porcelain
   - git rev-parse --abbrev-ref HEAD
   - git log --oneline -n 10
2) Run validation:
   - npm ci
   - npm test (or npm run test)
   - npm run build
   - npm run lint (only if present)
3) Commit (if needed).
4) Push branch to origin.
5) Create PR to main (if possible).
6) Enable auto-merge (if possible), otherwise provide exact UI steps.
7) Provide handoff:
   - Codex: Hand off to local → Apply (never overwrite)
   - Local: git status, ironai-local
8) Provide a 30-second smoke test checklist.
