#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="main"
AUTOMERGE_LABEL="automerge"
SHIP_PREFIX="ship"

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

help_missing_label() {
  printf '%s\n' "error: Missing required label '${AUTOMERGE_LABEL}'." >&2
  printf '%s\n' "Fix once, then re-run prmain:" >&2
  printf '%s\n' "  gh label create ${AUTOMERGE_LABEL} --color 0E8A16 --description \"Enable auto-merge when CI passes\"" >&2
  exit 1
}

help_actions_disabled() {
  printf '%s\n' "error: GitHub Actions are disabled for this repo." >&2
  printf '%s\n' "Fix in GitHub: Settings -> Actions -> General -> Allow actions, then re-run prmain." >&2
  exit 1
}

help_workflow_disabled() {
  printf '%s\n' "error: Workflow '.github/workflows/enable-automerge.yml' is disabled." >&2
  printf '%s\n' "Fix in GitHub: Actions -> Enable workflow, then re-run prmain." >&2
  exit 1
}

help_automerge_disabled() {
  printf '%s\n' "error: Auto-merge could not be enabled for this PR." >&2
  printf '%s\n' "Fix in GitHub, then re-run prmain:" >&2
  printf '%s\n' "  1) Settings -> General -> Pull Requests -> Allow auto-merge" >&2
  printf '%s\n' "  2) Branch protection for '${BASE_BRANCH}' should require CI checks" >&2
  exit 1
}

if ! command -v gh >/dev/null 2>&1; then
  fail "GitHub CLI (gh) is required. Install from https://cli.github.com/."
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "Not inside a git repository."
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "Working tree has uncommitted changes. Commit or stash, then run again."
fi

if ! gh auth status >/dev/null 2>&1; then
  fail "gh is not authenticated. Run: gh auth login"
fi

log "Syncing with origin/${BASE_BRANCH}..."
git fetch origin "$BASE_BRANCH" >/dev/null 2>&1 || fail "Could not fetch origin/${BASE_BRANCH}."

ahead_of_main="$(git rev-list --count "origin/${BASE_BRANCH}..HEAD")"
if [[ "$ahead_of_main" -eq 0 ]]; then
  fail "No commits to ship. Current HEAD is not ahead of origin/${BASE_BRANCH}."
fi

repo="$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || true)"
if [[ -z "$repo" ]]; then
  fail "Could not resolve GitHub repository from gh."
fi

actions_enabled="$(gh api "repos/${repo}/actions/permissions" --jq '.enabled' 2>/dev/null || true)"
if [[ "$actions_enabled" == "false" ]]; then
  help_actions_disabled
fi

workflow_state="$(gh api "repos/${repo}/actions/workflows/enable-automerge.yml" --jq '.state' 2>/dev/null || true)"
if [[ "$workflow_state" == "disabled_manually" ]] || [[ "$workflow_state" == "disabled_inactivity" ]]; then
  help_workflow_disabled
fi

label_exists="$(gh label list --limit 200 --json name --jq "map(select(.name == \"${AUTOMERGE_LABEL}\")) | length" 2>/dev/null || true)"
if [[ "$label_exists" != "1" ]]; then
  help_missing_label
fi

timestamp="$(date +%Y%m%d-%H%M)"
base_ship_branch="${SHIP_PREFIX}/${timestamp}"
ship_branch="${base_ship_branch}"
suffix=1
while git show-ref --verify --quiet "refs/heads/${ship_branch}" || git ls-remote --exit-code --heads origin "${ship_branch}" >/dev/null 2>&1; do
  ship_branch="${base_ship_branch}-${suffix}"
  suffix=$((suffix + 1))
done

log "Creating shipping branch ${ship_branch} from ${branch}..."
git branch "${ship_branch}" HEAD

log "Pushing ${ship_branch}..."
git push -u origin "${ship_branch}" >/dev/null 2>&1 || fail "Could not push ${ship_branch} to origin."

pr_title="Ship ${timestamp}"
pr_body="Automated shipping PR from ${branch}."

log "Creating PR into ${BASE_BRANCH}..."
pr_url="$(gh pr create --base "$BASE_BRANCH" --head "$ship_branch" --title "$pr_title" --body "$pr_body" 2>/dev/null || true)"
if [[ -z "$pr_url" ]]; then
  fail "Could not create PR from ${ship_branch} to ${BASE_BRANCH}."
fi

log "Adding label '${AUTOMERGE_LABEL}'..."
if ! gh pr edit "$pr_url" --add-label "$AUTOMERGE_LABEL" >/dev/null 2>&1; then
  fail "Could not add label '${AUTOMERGE_LABEL}' to PR ${pr_url}."
fi

log "Enabling auto-merge (squash + delete branch)..."
merge_output=""
if ! merge_output="$(gh pr merge "$pr_url" --auto --squash --delete-branch 2>&1)"; then
  if [[ "$merge_output" == *"Auto-merge is not enabled"* ]] || \
     [[ "$merge_output" == *"Auto-merge not enabled"* ]] || \
     [[ "$merge_output" == *"enablePullRequestAutoMerge"* ]] || \
     [[ "$merge_output" == *"Protected branch rules not configured"* ]]; then
    help_automerge_disabled
  fi
  printf '%s\n' "$merge_output" >&2
  fail "Could not enable auto-merge for ${pr_url}."
fi

if [[ "$merge_output" != "" ]]; then
  log "$merge_output"
fi

log "PR ready: ${pr_url}"
log "Current branch remains: ${branch}"
