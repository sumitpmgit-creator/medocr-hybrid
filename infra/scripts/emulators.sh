#!/usr/bin/env bash
# Start the Auth, Firestore, and Hosting emulators.
# Hosting serves apps/web/dist — build the web app first if you want a UI.
# The web app does not yet call connectAuthEmulator / connectFirestoreEmulator;
# that wiring lives in apps/web and is outside this folder's write scope.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ ! -d apps/web/dist ]]; then
  echo "note: apps/web/dist is missing; hosting emulator will have nothing to serve."
  echo "      Run: pnpm --dir apps/web build"
fi

exec firebase emulators:start --only auth,firestore,hosting
