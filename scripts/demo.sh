#!/usr/bin/env bash
# Recording driver for the Blast Radius demo.
#
# It types each beat's real command, waits for a keypress, runs it, and waits
# again before the next beat. Nothing here is a shortcut around the CLI: every
# command shown is the command executed, so the recording shows the real tool.
#
#   ./scripts/demo.sh            record the full demo
#   SKIP_LIVE=1 ./scripts/demo.sh   rehearse without spending Bright Data credits
#   TYPE_DELAY=0 ./scripts/demo.sh  no typing animation
#
# Any key advances. Ctrl-C stops.

set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="${DEMO_DIR:-$HOME/demo}"
TYPE_DELAY="${TYPE_DELAY:-0.035}"
SKIP_LIVE="${SKIP_LIVE:-0}"
AUTO="${AUTO:-0}"

key() { [ "$AUTO" = "1" ] && return 0; read -r -s -n1 </dev/tty; }

type_out() {
  local text=$1 i
  for ((i = 0; i < ${#text}; i++)); do
    printf '%s' "${text:i:1}"
    [ "$TYPE_DELAY" = "0" ] || sleep "$TYPE_DELAY"
  done
  printf '\n'
}

beat() {
  printf '$ '
  type_out "$1"
  key
  eval "$1"
  printf '\n'
  key
}

note() {
  printf '\n\033[2m--- %s ---\033[0m\n\n' "$1"
  key
}

clear
key

cd "$REPO" || exit 1
beat 'npm outdated'

clear
cd "$DEMO_DIR" || exit 1
beat 'blast check openai-node --report-dir /tmp/blast-demo/reports'

clear
cd "$REPO" || exit 1
beat 'blast check fixtures/repository-multi-vendor'

if [ "$SKIP_LIVE" != "1" ]; then
  clear
  beat 'blast collect --live --vendor Slack --output /tmp/blast-demo/live-notice.json'
fi

clear
beat 'wslview /tmp/blast-demo/reports/impact-openai-assistants.html'

clear
beat 'blast collect --fixture fixtures/collector-health/required-field-collapse.json --output /tmp/blast-demo/diagnostic.json'
beat 'blast heal detect --diagnostic /tmp/blast-demo/diagnostic.json --last-known-good /tmp/blast-demo/last-good.json --output /tmp/blast-demo/heal-detected.json'

note 'CUT HERE. Splice in the pre-recorded Bright Data wait.'

clear
beat 'blast heal run --heal /tmp/blast-demo/heal-detected.json --recorded fixtures/heal/awaiting-approval.progress.json --output /tmp/blast-demo/heal-gated.json'
beat 'blast heal approve --heal /tmp/blast-demo/heal-gated.json --recorded fixtures/heal/resumed-done.progress.json --output /tmp/blast-demo/heal-approved.json'
beat 'blast heal rerun --heal /tmp/blast-demo/heal-approved.json --fixture fixtures/collector-health/healed-rerun.json --output /tmp/blast-demo/heal-rerun.json'

clear
beat 'blast report --scan /tmp/blast-demo/scan.json --heal /tmp/blast-demo/heal-rerun.json --output /tmp/blast-demo/report-with-heal.html'
beat 'wslview /tmp/blast-demo/report-with-heal.html'

clear
beat 'npm run metrics'

clear
beat 'git blame -L 6,6 fixtures/repository/src/slack-upload.ts'

note 'End of demo.'
