#!/bin/bash
set -euo pipefail

# Install dependencies so tests/linters work in Claude Code on the web.
# Web-only: skip on local machines (they manage their own setup).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# npm install (not ci) so the cached container layer is reused across sessions.
# Idempotent and non-interactive.
npm install --no-audit --no-fund
