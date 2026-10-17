#!/usr/bin/env bash
# Build the Solana program (SBF). Requires the Agave CLI (cargo-build-sbf) on PATH.
set -euo pipefail
cd "$(dirname "$0")/../program"
export PATH="$PATH:$HOME/.local/share/solana/install/active_release/bin"
cargo build-sbf --manifest-path programs/null-verifier/Cargo.toml -- --features no-log-ix-name
ls -la target/deploy/null_verifier.so
