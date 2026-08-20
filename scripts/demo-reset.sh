#!/usr/bin/env bash
# Reset the demo working directory so every take starts from the same state.
# Run this before each take of scripts/demo.sh.

set -eu

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${WORK:-/tmp/blast-demo}"

rm -rf "$WORK"
mkdir -p "$WORK"
cd "$REPO"
blast collect --fixture fixtures/slack-notice.json --output "$WORK/last-good.json" >/dev/null
blast scan fixtures/repository --collection "$WORK/last-good.json" --output "$WORK/scan.json" >/dev/null
echo "Reset: $WORK staged with last-good.json and scan.json."
