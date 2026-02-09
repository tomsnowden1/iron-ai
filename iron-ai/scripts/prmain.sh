#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="main"
AUTOMERGE_LABEL="automerge"

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

if ! command -v gh >/dev/null 2>&1; then
  fail "GitHub CLI (gh) is required. Install from https://cli.github.com/."
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "Not inside a git repository."
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "$BASE_BRANCH" ]]; then
  fail "You are on ${BASE_BRANCH}. Switch to a feature branch before opening a PR."
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "Working tree has uncommitted changes. Commit or stash, then run again."
fi

if ! gh auth status >/dev/null 2>&1; then
  fail "gh is not authenticated. Run: gh auth login"
fi

existing_pr_url="$(gh pr list --state open --head "$branch" --base "$BASE_BRANCH" --json url --jq '.[0].url' 2>/dev/null || true)"

if [[ -z "$existing_pr_url" ]]; then
  create_output=""
  if ! create_output="$(gh pr create --base "$BASE_BRANCH" --head "$branch" --fill 2>&1)"; then
    if [[ "$create_output" == *"A pull request already exists"* ]]; then
      log "PR already exists for ${branch}; continuing."
    else
      printf '%s\n' "$create_output" >&2
      fail "Failed to create PR."
    fi
  else
    log "$create_output"
  fi
fi

pr_url="$(gh pr list --state open --head "$branch" --base "$BASE_BRANCH" --json url --jq '.[0].url' 2>/dev/null || true)"
if [[ -z "$pr_url" ]]; then
  fail "Could not resolve an open PR for branch ${branch}."
fi

if gh label create "$AUTOMERGE_LABEL" --color 0E8A16 --description "Enable auto-merge when CI passes" >/dev/null 2>&1; then
  log "Created missing '${AUTOMERGE_LABEL}' label."
fi

if ! gh pr edit "$pr_url" --add-label "$AUTOMERGE_LABEL" >/dev/null 2>&1; then
  warn "Could not add '${AUTOMERGE_LABEL}' label to ${pr_url}."
fi

merge_output=""
if ! merge_output="$(gh pr merge "$pr_url" --auto --squash --delete-branch 2>&1)"; then
  warn "Could not enable auto-merge for ${pr_url}."
  if [[ "$merge_output" == *"Protected branch rules not configured"* ]] || \
     [[ "$merge_output" == *"enablePullRequestAutoMerge"* ]] || \
     [[ "$merge_output" == *"Auto-merge is not enabled"* ]] || \
     [[ "$merge_output" == *"Auto-merge not enabled"* ]]; then
    log "To enable auto-merge in GitHub UI:"
    log "- Settings -> General -> Pull Requests -> Allow auto-merge"
    log "- Settings -> Branches -> Branch protection rules (main) -> required status checks"
  else
    printf '%s\n' "$merge_output" >&2
  fi
else
  log "$merge_output"
fi

log "PR ready: ${pr_url}"
