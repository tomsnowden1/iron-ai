---
name: ironai-merge-lite
description: Fast IronAI start-of-session GitHub runway check and main-branch sync. Use when asked to do a daily/session startup sanity check, keep local main synced with origin/main, classify open PR merge health (automerge labels, failing checks, merge conflicts), and decide whether to proceed or stop and run the full ironai-flow cleanup.
---

# IronAI Flow Lite

Run a strict 5-10 minute startup workflow. Keep changes minimal and safe.

## Safety Rules

- Never push directly to `main`; use PR workflow.
- Never commit secrets.
- Never commit `.DS_Store` or anything in `backups/`.
- Do not start conflict resolution unless explicitly instructed.

## Required Workflow

### 0) Local cleanliness check

1. Run:

```bash
git status --porcelain
```

2. If uncommitted changes exist, summarize them briefly and choose the safest default:
   - If accidental/unclear: stash with a clear message.
   - If clearly intentional and small: commit on the current branch with a clear message.
3. Explain what was chosen and why.
4. Continue only when the working tree is clean.

### 1) Sync main

Run:

```bash
git switch main
git fetch origin
git pull --rebase --autostash origin main
git status -sb
git log -1 --oneline
```

Confirm whether `main` is up to date and report the latest commit line.

### 2) PR runway check (GitHub CLI)

1. List open PRs with `gh` and classify each as:
   - automerge-labeled
   - checks failing
   - merge conflicts / not mergeable
2. Output one line per PR:

```text
#<num> <title> — <mergeable/blocked/conflicts/checks failing> — labels: [...]
```

### 3) Verdict (strict)

- If `0` open PRs OR all open PRs are mergeable with green checks/auto-merging:
  - Print: `✅ RUNWAY CLEAR`
  - Continue to task only if a task is provided.
- If any PR is blocked by conflicts/check failures OR there are 2+ PRs piling up:
  - Print: `⚠️ RUNWAY NOT CLEAR — RUN ironai-flow (mega)`
  - List blocked PRs and reason (conflict vs checks failing).
  - Stop. Do not continue to task work.

### 4) If task is provided after runway check

Proceed only after `✅ RUNWAY CLEAR`.

1. Create a new branch from updated `main`.
2. Keep change small and safe.
3. Run verification before finishing:

```bash
npm run build
npm test
```

If `npm test` is unavailable, run `npm run test`.

4. For shipping, hand off to ironai-ship workflow (PR + auto-merge).

## End-of-run Output (always)

Provide exactly these sections:

1. `Repo status`: clean/dirty + what you did
2. `Main sync`: up to date / pulled commits + last commit line
3. `Open PRs`: count + list
4. `Verdict`: `✅ RUNWAY CLEAR` / `⚠️ RUN ironai-flow (mega)`
5. `If proceeded`: Traceability checklist

## Traceability Checklist (only if code changes were made)

- Reqs understood: 1-3 bullets
- Files changed: paths + why
- Acceptance criteria: bullets with `✅` when met
- Tests/build: commands + results
- Risks: remaining risks + mitigation
- Rollback: how to revert (PR/commit)
