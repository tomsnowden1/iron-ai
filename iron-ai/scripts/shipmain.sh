#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="main"

log() {
  printf '%s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "Not inside a git repository."
fi

if ! git show-ref --verify --quiet "refs/heads/${BASE_BRANCH}"; then
  fail "Local ${BASE_BRANCH} branch not found."
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "Working tree has staged or unstaged changes."
  log "Commit or stash first, then run shipmain again."
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"

log "Switching to ${BASE_BRANCH}..."
git checkout "$BASE_BRANCH" >/dev/null 2>&1 || fail "Could not switch to ${BASE_BRANCH}."

log "Fetching latest origin/${BASE_BRANCH}..."
git fetch origin "$BASE_BRANCH" >/dev/null 2>&1 || fail "Could not fetch origin/${BASE_BRANCH}."

log "Rebasing local ${BASE_BRANCH} on origin/${BASE_BRANCH} (with autostash)..."
if ! git pull --rebase --autostash origin "$BASE_BRANCH"; then
  warn "Rebase did not complete cleanly."
  if git rebase --abort >/dev/null 2>&1; then
    warn "Rebase aborted to keep your branch safe."
  fi
  log "Resolve conflicts manually, then run shipmain again."
  exit 1
fi

log "Pushing ${BASE_BRANCH} to origin..."
git push origin "$BASE_BRANCH" >/dev/null 2>&1 || fail "Could not push ${BASE_BRANCH} to origin."

log "Done. ${BASE_BRANCH} is synced with origin/${BASE_BRANCH}."
if [[ "$current_branch" != "$BASE_BRANCH" ]]; then
  log "You started on ${current_branch}. Run: git checkout ${current_branch} (if you want to go back)."
fi
