#!/usr/bin/env bash
set -euo pipefail

echo "== ironai-local: local sanity + dev =="
echo

echo "1) Git status:"
git status -sb
echo

# If package-lock.json changed compared to HEAD, run npm ci
if git diff --name-only HEAD | grep -q "^package-lock\.json$"; then
  echo "2) package-lock.json changed -> running npm ci..."
  npm ci
else
  echo "2) package-lock.json unchanged -> skipping npm ci."
fi
echo

echo "3) Starting dev server (Ctrl+C to stop)..."
npm run dev




