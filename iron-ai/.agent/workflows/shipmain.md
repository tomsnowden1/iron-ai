---
description: Sync main branch locally and push to remote
---

# shipmain - Sync Main Branch

This workflow syncs the main branch locally and pushes it to remote. Run after a PR is merged or to ensure main is aligned with remote.

## Steps

// turbo-all

1. Switch to main branch:
```bash
git switch main
```

2. Fetch latest changes from origin:
```bash
git fetch origin
```

3. Pull and rebase with autostash (prevents divergent branches error):
```bash
git pull --rebase --autostash origin main
```

4. Push to origin main:
```bash
git push origin main
```

**Result**: Local main branch is synced with remote and pushed.
