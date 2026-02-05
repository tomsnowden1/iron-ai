---
description: Create PR to main with automerge enabled
---

# prmain - Create PR + Automerge

This workflow creates a PR to main and enables automerge with the "automerge" label.

## Steps

// turbo-all

1. Check git status for uncommitted changes:
```bash
git status --porcelain
```

2. If there are uncommitted changes, commit them first.

3. Create a timestamped ship branch:
```bash
TS=$(date +%Y%m%d-%H%M)
BR="ship/${TS}"
git switch -c "$BR"
```

4. Push the branch to origin:
```bash
git push -u origin "$BR"
```

5. Create PR to main:
```bash
PR_URL=$(gh pr create --fill --base main --head "$BR")
echo "$PR_URL"
```

6. Add the automerge label:
```bash
gh pr edit "$PR_URL" --add-label automerge
```

7. Enable auto-merge with squash and delete branch after merge:
```bash
gh pr merge "$PR_URL" --auto --squash --delete-branch
```

**Result**: PR is created, labeled, and auto-merges when CI passes (or immediately if no required checks).
