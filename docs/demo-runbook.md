# Demo runbook

How to record the Blast Radius demo video, from an empty screen to a submitted file.

`scripts/demo.sh` drives the recording. It types each beat's real command, waits for a keypress,
runs it, and waits again. Every line it types is a command a judge can run themselves, so the
recording shows the tool rather than a script pretending to be one. This file covers what to say
over it and what to prepare first.

Target length: three minutes.

## Before you record

### 1. Build and confirm green

```bash
npm install && npm run build && npm test
```

### 2. Install the `blast` command

The demo lines have to be short enough to read at 1080p, so link the binary once instead of typing
`node dist/src/cli.js` on camera:

```bash
npm link
```

### 3. Clone the demo repositories

The demo scans two real repositories at pinned commits rather than a fixture, because a judge can
clone the same commit and get the same answer. Keep them in `~/demo`, outside this repository:

```bash
mkdir -p ~/demo && cd ~/demo
for s in "openai-node https://github.com/openai/openai-node a0d68cc53125c2cb82eab31271b8984b8d65d4b2" \
         "assistant-chat https://github.com/admineral/OpenAI-Assistant-API-Chat 9b63620662f3afa4ee34aad3de16afd7d48033fb"; do
  set -- $s
  mkdir -p $1 && git -C $1 init -q && git -C $1 remote add origin $2 \
  && git -C $1 fetch -q --depth 1 origin $3 && git -C $1 checkout -q FETCH_HEAD
done
```

They are scan targets, not dependencies. Nothing is installed or executed inside them.

### 4. Rehearse the one live command

The live collection beat is the only step that touches the network:

```bash
blast collect --live --vendor Slack --output /tmp/blast-demo/live-notice.json
```

Run it once before recording so you know how long it takes and that your credentials load. It reads
`BRIGHTDATA_API_KEY` and `BRIGHTDATA_COLLECTOR_ID` from `.env` in the current directory, so it has
to run from the repository root. Never run `discover` live: slow, expensive, and different every
time. Never display `.env` on camera.

### 5. Pre-record the heal wait

A real Bright Data heal takes two to three minutes, which a three-minute video cannot wait for.
Record that wait separately and cut it in. `scripts/demo.sh` prints a dim `CUT HERE` line at exactly
the point it belongs. The approval gate itself is a status read and appears instantly, so it stays
live in the main recording.

### 6. Set up the screen

- `PS1='$ '` for the session. A 70-character prompt wraps lines and steals the width the output
  needs.
- Font at 18 to 20pt. The three-vendor run prints 28 lines and has to fit without scrolling.
- Clear the scrollback, not just the screen. In Windows Terminal that is Clear Buffer.
- Close anything that can raise a notification, and turn on Do Not Disturb.
- Have the browser open on a blank tab.

### 7. Rehearse the whole thing for free

```bash
./scripts/demo-reset.sh
SKIP_LIVE=1 ./scripts/demo.sh
```

`SKIP_LIVE=1` drops the only beat that spends credits. `TYPE_DELAY=0` turns off the typing
animation, `TYPE_DELAY=0.06` slows it down.

## The beat sheet

Run `./scripts/demo-reset.sh`, then `./scripts/demo.sh`. Press any key to advance. Times are
cumulative targets, not a script to read aloud.

### 1. Hook, 0:00 to 0:10

> "Your code is already broken. Nobody has told you yet."

Nothing on screen but a prompt.

### 2. Before, 0:10 to 0:25

`npm outdated` returns almost nothing. The dependencies are current. It still has no idea that an
API this repository calls is being switched off, because no version bump ever happened. That gap is
the product.

### 3. One command on a real repository, 0:25 to 1:05

`blast check openai-node` scans 711 files and comes back with one Impact, five proven line numbers,
and a countdown.

This is the moment the demo exists for. Say the claim plainly: OpenAI's own SDK, at a commit anyone
can clone, calls the API OpenAI is shutting down. Hold the cursor on the countdown, then on a
`file:line`. Say the two receipts out loud: the vendor published the notice, the scanner proved the
line.

Then the three Analysis Limitations underneath, all Azure call sites. That is code it could not
prove, disclosed instead of guessed.

### 4. Three vendors at once, 1:05 to 1:25

`blast check fixtures/repository-multi-vendor` returns Slack, OpenAI, and Cloudflare in one pass,
each with its own deadline and line number.

### 5. It is not a fixture, 1:25 to 1:50

Live Bright Data, on camera. Point out that the evidence sentence differs word for word from the
stored fixture, which is what proves the page was actually read.

### 6. Reveal, 1:50 to 2:10

The Impact Report opens in the browser. Click one row. The vendor's own published sentence sits
beside your line number. Scroll to Analysis Limitations.

### 7. The heal, 2:10 to 2:45

The diagnostic collection exits 1 and withholds its output rather than passing a broken row
downstream. `heal detect` composes a prompt naming the exact field that collapsed.

Cut to the pre-recorded wait, then come back live at the approval gate. The line is: no human wrote
a selector. Say plainly that the replayed steps are marked `recorded` in the artifact, so replayed
evidence is never shown as a live call.

### 8. Result, 2:45 to 2:55

Ten vendors watched, three capabilities provable, and the README eval table generated by
`npm run metrics` rather than typed. Say the smaller number out loud. Publishing the gap is the
point.

### 9. Close, 2:55 to 3:00

`git blame` on the Slack call site. A line, an author, a date, and a vendor deadline nobody
connected to it until now.

## Between takes

```bash
./scripts/demo-reset.sh
```

Then Clear Buffer. Skip the live beat on takes two onward with `SKIP_LIVE=1` unless the take is
otherwise perfect. Each run spends credits and the footage from take one can be reused.

## After recording

1. Cut the heal wait to a jump cut with a visible time marker so the edit is disclosed, not hidden.
2. Watch it once at full speed without pausing. If the countdown and the line number are not
   readable, the take failed regardless of what was said.
3. Work the submission checklist in [issue #15](https://github.com/sivaratrisrinivas/blastradius/issues/15).

## Honest notes

- The deadline countdown is real and moves. The OpenAI notice reads August 26, 2026, so the number
  on screen depends on the day you record. Do not re-record to get a rounder number.
- The `--live` beat is the only unrehearsed-by-default step. If the network fails mid-take, the
  offline fixture path produces the same artifact shape and the demo survives. Say so on camera
  rather than cutting.
- `check` exits 0 whether or not it finds an Impact. For the zero-Impact contrast, run
  `blast check fixtures/repository-clean`.
- `scripts/demo.sh` never wraps or abbreviates a CLI call. If a beat needs a different command,
  change the command in the script rather than adding a shortcut to the CLI.
