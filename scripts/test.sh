#!/usr/bin/env bash
# Run the TypeScript unit tests (vitest) without tripping the terminal's long-process heuristic.
set -euo pipefail
cd "$(dirname "$0")/.."
npx --no vitest run "$@"
