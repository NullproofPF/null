#!/usr/bin/env bash
# LiteSVM integration tests against the compiled program binary.
set -euo pipefail
cd "$(dirname "$0")/../program"
if [ ! -f target/deploy/null_verifier.so ]; then
  echo "program binary missing; run scripts/program-build.sh first" >&2
  exit 1
fi
cargo test -p null-verifier-tests --release -- --nocapture "$@"
