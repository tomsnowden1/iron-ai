#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="main"

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "Not inside a git repository."
fi

log "Fetching origin/${BASE_BRANCH}..."
git fetch origin "$BASE_BRANCH" >/dev/null 2>&1 || fail "Could not fetch origin/${BASE_BRANCH}."

tag_name="backup/${BASE_BRANCH}-$(date +%Y%m%d-%H%M)"

if git rev-parse "$tag_name" >/dev/null 2>&1; then
  fail "Tag ${tag_name} already exists locally. Wait a minute and try again."
fi

log "Creating annotated tag ${tag_name} on origin/${BASE_BRANCH}..."
git tag -a "$tag_name" "origin/${BASE_BRANCH}" -m "Backup checkpoint for ${BASE_BRANCH}"

log "Pushing ${tag_name}..."
git push origin "$tag_name" >/dev/null 2>&1 || fail "Could not push tag ${tag_name} to origin."

log "Backup checkpoint created: ${tag_name}"
