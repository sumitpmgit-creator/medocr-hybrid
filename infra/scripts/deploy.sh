#!/usr/bin/env bash
# Deploy Firestore rules/indexes, Remote Config, and Hosting.
# Requires: firebase login (or Application Default Credentials), a real project
# id in .firebaserc (not medocr-hybrid-placeholder), and Node/pnpm on PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ ! -f firebase.json ]]; then
  echo "error: firebase.json not found in $ROOT" >&2
  exit 1
fi

PROJECT="$(node -e "console.log(require('./.firebaserc').projects.default)")"
if [[ -z "$PROJECT" || "$PROJECT" == "medocr-hybrid-placeholder" ]]; then
  echo "error: replace medocr-hybrid-placeholder in .firebaserc with your real Firebase project id." >&2
  exit 1
fi

TARGETS="${1:-firestore,remoteconfig,hosting}"

if [[ "$TARGETS" == *hosting* ]]; then
  echo "Building web app (apps/web/dist)…"
  pnpm --dir apps/web build
fi

echo "Deploying --only $TARGETS to project $PROJECT…"
firebase deploy --project "$PROJECT" --only "$TARGETS"
