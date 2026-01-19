#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/ship.sh "Commit message"
  scripts/ship.sh <branch> "Commit message"
  scripts/ship.sh --branch <branch> --message "Commit message"
  scripts/ship.sh --auto-branch "Commit message"

Notes:
  - Refuses to run on main unless a branch is provided or --auto-branch is set.
  - Runs: build -> commit -> push -> PR -> auto-merge (best effort).
USAGE
}

say() {
  printf '%s\n' "$*"
}

require_git_repo() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    say "Not inside a git repo."
    exit 1
  fi
}

current_branch() {
  git branch --show-current
}

has_git_alias() {
  local name="$1"
  git config --get "alias.${name}" >/dev/null 2>&1
}

has_git_cmd() {
  local name="$1"
  command -v "git-${name}" >/dev/null 2>&1
}

print_doctor() {
  say "Doctor"
  say "- branch: $(current_branch)"
  say "- status:"
  git status -sb
}

branch_arg=""
msg_arg=""
auto_branch=false
positional=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--branch)
      branch_arg="${2:-}"
      shift 2
      ;;
    -m|--message)
      msg_arg="${2:-}"
      shift 2
      ;;
    --auto-branch)
      auto_branch=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      positional+=("$1")
      shift
      ;;
  esac
done

while [[ $# -gt 0 ]]; do
  positional+=("$1")
  shift
done

if [[ ${#positional[@]} -gt 0 ]]; then
  if [[ ${#positional[@]} -eq 2 && -z "$branch_arg" && -z "$msg_arg" ]]; then
    branch_arg="${positional[0]}"
    msg_arg="${positional[1]}"
  elif [[ ${#positional[@]} -eq 1 && -z "$msg_arg" ]]; then
    msg_arg="${positional[0]}"
  else
    say "Unexpected arguments."
    usage
    exit 1
  fi
fi

require_git_repo

branch="$(current_branch)"
if [[ "$branch" == "main" ]]; then
  if [[ -n "$branch_arg" ]]; then
    say "Creating branch $branch_arg"
    git checkout -b "$branch_arg"
    branch="$(current_branch)"
  elif [[ "$auto_branch" == "true" ]]; then
    branch_arg="fix/ship-$(date +%Y%m%d%H%M)"
    say "Creating branch $branch_arg"
    git checkout -b "$branch_arg"
    branch="$(current_branch)"
  else
    say "Refusing to run on main. Provide a branch or use --auto-branch."
    exit 1
  fi
elif [[ -n "$branch_arg" && "$branch_arg" != "$branch" ]]; then
  if git show-ref --verify --quiet "refs/heads/$branch_arg"; then
    say "Checking out existing branch $branch_arg"
    git checkout "$branch_arg"
  else
    say "Creating branch $branch_arg"
    git checkout -b "$branch_arg"
  fi
  branch="$(current_branch)"
fi

print_doctor

if [[ -z "$(git status --porcelain)" ]]; then
  say "nothing to ship"
  exit 0
fi

commit_msg="${msg_arg:-chore: ship}"

say "Running build..."
npm run build

say "Committing changes..."
git add -A
if [[ -z "$(git status --porcelain)" ]]; then
  say "nothing to ship"
  exit 0
fi

git commit -m "$commit_msg"

say "Pushing branch $branch to origin..."
git push -u origin "$branch"

say "Opening PR to main..."
if command -v gh >/dev/null 2>&1; then
  pr_number=""
  if pr_number=$(gh pr create --base main --head "$branch" --title "$commit_msg" --body "Automated ship via scripts/ship.sh" --json number --jq .number 2>/dev/null); then
    :
  else
    pr_number=$(gh pr view --json number --jq .number)
  fi

  pr_url=$(gh pr view --json url --jq .url)
  say "PR: $pr_url"

  if gh label list --limit 200 | grep -qE '^automerge\b'; then
    gh pr edit "$pr_number" --add-label automerge
  else
    say "automerge label not found; skipping label"
  fi

  if gh pr merge "$pr_number" --auto --merge; then
    say "Auto-merge enabled"
  else
    say "Auto-merge not enabled; check repo settings and permissions"
  fi
elif has_git_alias prmain || has_git_cmd prmain; then
  say "Using git prmain helper"
  git prmain
elif has_git_alias shipmain || has_git_cmd shipmain; then
  say "Using git shipmain helper"
  git shipmain
else
  say "No GitHub CLI or helper command found. Open a PR to main manually."
fi
