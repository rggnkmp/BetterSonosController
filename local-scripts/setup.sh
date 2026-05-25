#!/usr/bin/env bash
# Wrapper — use install.sh in the project root instead.
set -euo pipefail
exec "$(cd "$(dirname "$0")/.." && pwd)/install.sh" "$@"
