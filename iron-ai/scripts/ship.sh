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
  warn "Working tree has staged/unstaged changes."
  log "Next steps:"
  log "  git status --short"
  log "  git add -A && git commit -m \"<message>\""
  log "  # or stash everything (including untracked): git stash push -u"
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"

sync_main() {
  local original_branch="$1"

  log "Syncing ${BASE_BRANCH} with origin/${BASE_BRANCH}..."
  git fetch origin

  if [[ "$original_branch" != "$BASE_BRANCH" ]]; then
    git checkout "$BASE_BRANCH" >/dev/null 2>&1
  fi

  if ! git pull --rebase --autostash origin "$BASE_BRANCH"; then
    warn "Failed to rebase ${BASE_BRANCH} on origin/${BASE_BRANCH}."
    if git rebase --abort >/dev/null 2>&1; then
      warn "Rebase aborted to keep repository stable."
    fi
    if [[ "$original_branch" != "$BASE_BRANCH" ]]; then
      git checkout "$original_branch" >/dev/null 2>&1 || true
    fi
    warn "Resolve manually, then rerun shipping:"
    log "  git checkout ${BASE_BRANCH}"
    log "  git pull --rebase --autostash origin ${BASE_BRANCH}"
    log "  # resolve conflicts, then: git rebase --continue"
    if [[ "$original_branch" != "$BASE_BRANCH" ]]; then
      log "  git checkout ${original_branch}"
    fi
    exit 1
  fi

  if [[ "$original_branch" != "$BASE_BRANCH" ]]; then
    git checkout "$original_branch" >/dev/null 2>&1
  fi
}

sync_main "$current_branch"

if [[ "$current_branch" == "$BASE_BRANCH" ]]; then
  ahead_of_origin="$(git rev-list --count "origin/${BASE_BRANCH}..${BASE_BRANCH}")"
  if [[ "$ahead_of_origin" -eq 0 ]]; then
    log "Nothing to ship: ${BASE_BRANCH} is clean and synced with origin/${BASE_BRANCH}."
    exit 0
  fi
  fail "You are on ${BASE_BRANCH} with local commits. Create/switch to a feature branch and re-run."
fi

ahead_of_main="$(git rev-list --count "origin/${BASE_BRANCH}..${current_branch}")"
if [[ "$ahead_of_main" -eq 0 ]]; then
  log "Nothing to ship: ${current_branch} has no commits ahead of origin/${BASE_BRANCH}."
  exit 0
fi

log "Pushing ${current_branch}..."
git push -u origin "$current_branch"

log "Opening/refreshing PR to ${BASE_BRANCH}..."
if ! "$(dirname "$0")/prmain.sh"; then
  warn "PR automation did not complete. Branch is pushed."
  warn "Run npm run prmain after fixing GitHub CLI auth/settings."
fi
