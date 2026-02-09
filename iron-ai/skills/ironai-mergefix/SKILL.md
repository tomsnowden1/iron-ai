---
name: ironai-mergefix
description: Resolve Git merge and rebase conflicts safely for the IronAI repository. Use when `git status` shows unmerged paths, conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) are present, `git pull --rebase` fails with conflicts, or README/docs workflow sections diverge.
---

# IronAI MergeFix

Resolve conflicts cleanly, preserve intended meaning, keep docs readable, and finish rebase/merge without breaking the app.

## Apply Golden Rules

1. Do not guess. Inspect both sides of every conflict and explain what each side changes.
2. Preserve information in docs (`README.md`, `*.md`) unless clearly obsolete.
3. For docs conflicts, accept both sides by default, then dedupe and reorder for clarity.
4. Never leave conflict markers in final files.
5. After resolving, run minimal verification and ensure Git state is clean.

## Run Conflict Resolution Procedure

### A) Triage and list conflicts

Run:

- `git status`
- `git diff --name-only --diff-filter=U`

Open each conflicted file and locate all conflict blocks.

### B) Resolve each conflict block

For every `<<<<<<<` block:

1. Label what Current change represents (local branch) and what Incoming change represents (rebased/merged branch).
2. Choose a strategy:
   - Docs/README: combine both, edit for clarity, remove duplicates.
   - Code: preserve correct behavior, avoid silent logic changes.
   - Config/lockfiles: keep the side that matches actual dependency state.

### C) Apply docs merge heuristic

Use this by default for docs unless instructed otherwise:

- Merge useful instructions from both sides into one canonical section.
- Keep newer workflow names (for example `prmain`/`shipmain`), keep legacy notes only when still relevant, mark them as Legacy.
- Ensure headings, bullets, and code fences render correctly.
- Remove duplication and contradictions.
- If Shipping sections conflict, merge into:
  1) Overview
  2) One-time setup
  3) Daily dev flow
  4) Shipping flow (PR + automerge)
  5) Troubleshooting (divergent branches, conflicts, `gh auth`)

### D) Finish the Git operation

After resolving all conflicts:

- `git add <files>`
- If rebasing: `git rebase --continue`
- If merging and Git requires it: `git commit`

### E) Verify

Run:

- `npm test` (or `npm run test` if that is the repo standard)
- `npm run build` when changes can affect build/tooling

Then confirm `git status` is clean.

## Report with This Format

- List conflicted files.
- For each file, state what was chosen/merged and why.
- List commands run.
- Report verification results.
- Call out remaining risks or follow-ups.

## Use IronAI-Specific Checklist

- Consolidate README workflow conflicts into one Shipping command set.
- Keep `ship.sh` vs `npm run shipmain` references consistent.
- If docs mention GitHub CLI, include `gh auth status || gh auth login`.
- If docs mention automerge labels, mention repo auto-merge/required-check prerequisites.
