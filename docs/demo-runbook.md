# Demo runbook

How to record the Blast Radius demo video, from an empty screen to a submitted file.

The demo now opens with one command. `blast check <repo>` answers for every matched capability at
once, so the operator never has to know which vendor notice to pick first. Everything below is
built around that.

Target length: three minutes. Plan on five takes minimum.

## Before you record

### 1. Build and rehearse offline (10 minutes)

```bash
npm install
npm run build
npm test
```

Then walk the whole demo once with no camera running, using the commands in the beat sheet below.
Every offline command in this runbook has been rehearsed end to end and takes under a second.

### 2. Rehearse the one live command (once, on credits)

The live collection beat is the only step that touches the network:

```bash
node dist/src/cli.js collect --live --vendor Slack --output /tmp/blast-demo/live-notice.json
```

Run it once before recording so you know how long it takes on your connection and that your
credentials are loaded. It reads `BRIGHTDATA_API_KEY` and `BRIGHTDATA_COLLECTOR_ID` from `.env`.
Never run `discover` live: slow, expensive, and different every time.

### 3. Pre-record the heal wait (before the camera rolls)

A real Bright Data heal takes two to three minutes, which a three-minute video cannot wait for.
Record that wait separately and cut it in. The approval gate itself is a status read and appears
instantly, so it stays live in the main recording.

### 4. Pre-stage the artifacts the heal beat needs

The heal beat shows the collector template diff inside an Impact Report, and `report --heal` needs
a single-capability scan artifact. `check --report-dir` writes reports directly and does not take
`--heal`, so stage this part before recording rather than on camera:

```bash
mkdir -p /tmp/blast-demo
node dist/src/cli.js collect --fixture fixtures/slack-notice.json --output /tmp/blast-demo/last-good.json
node dist/src/cli.js scan fixtures/repository --collection /tmp/blast-demo/last-good.json --output /tmp/blast-demo/scan.json
```

### 5. Set up the screen

- Terminal font large enough to read at 1080p. `check fixtures/repository-openai` prints 15 lines;
  the three-vendor run prints 28. Size the window so the three-vendor output fits without scrolling,
  or use the OpenAI repository for the tight shot.
- Clear the scrollback before each take.
- Close anything that can raise a notification.
- Have the browser open on a blank tab, ready for the report.

## The beat sheet

Times are cumulative targets, not a script to read aloud.

### 1. Hook — 0:00 to 0:10

> "Your code is already broken. Nobody has told you yet."

Nothing on screen but a prompt.

### 2. Before — 0:10 to 0:25

```bash
npm outdated
```

It lists version numbers. It does not know that `files.upload` stopped working in November, because
no version bump ever happened. That gap is the product.

### 3. One command — 0:25 to 1:00

```bash
node dist/src/cli.js check fixtures/repository-multi-vendor --report-dir /tmp/blast-demo/reports
```

This is the moment the demo exists for. One command, and three vendors come back with dates and
line numbers:

```
Checked fixtures/repository-multi-vendor: 4 file(s) scanned, 3 capabilities checked, 3 Impacts found.

Impact: OpenAI — Assistants API (openai.assistants)
Deadline: August 26, 2026 (2026-08-26), 6 days remaining
```

Point at the countdown. Point at `src/assistants.ts:6`. Say the two receipts out loud: the vendor
published the notice, the scanner proved the line.

### 4. It is not a fixture — 1:00 to 1:30

```bash
node dist/src/cli.js collect --live --vendor Slack --output /tmp/blast-demo/live-notice.json
```

Live Bright Data, on camera. The notice the previous command used is the same shape this one just
fetched. Show the printed source URL and excerpt.

### 5. Reveal — 1:30 to 1:55

Open the report `check` already wrote:

```bash
explorer.exe /tmp/blast-demo/reports/impact-openai-assistants.html   # WSL
# or: xdg-open, open, wslview
```

Click one row. The vendor's own published sentence sits beside your line number. Scroll to Analysis
Limitations and say the quiet part: this is the code it could not prove, disclosed rather than
guessed.

### 6. The heal — 1:55 to 2:40

```bash
node dist/src/cli.js collect --fixture fixtures/collector-health/required-field-collapse.json --output /tmp/blast-demo/diagnostic.json
```

It exits 1 and withholds the output. Then:

```bash
node dist/src/cli.js heal detect --diagnostic /tmp/blast-demo/diagnostic.json --last-known-good /tmp/blast-demo/last-good.json --output /tmp/blast-demo/heal-detected.json
```

The composed prompt names the field that collapsed. **Cut to the pre-recorded wait.** Come back
live at the gate:

```bash
node dist/src/cli.js heal run --heal /tmp/blast-demo/heal-detected.json --recorded fixtures/heal/awaiting-approval.progress.json --output /tmp/blast-demo/heal-gated.json
node dist/src/cli.js heal approve --heal /tmp/blast-demo/heal-gated.json --recorded fixtures/heal/resumed-done.progress.json --output /tmp/blast-demo/heal-approved.json
node dist/src/cli.js heal rerun --heal /tmp/blast-demo/heal-approved.json --fixture fixtures/collector-health/healed-rerun.json --output /tmp/blast-demo/heal-rerun.json
```

Then show the template diff in the report:

```bash
node dist/src/cli.js report --scan /tmp/blast-demo/scan.json --heal /tmp/blast-demo/heal-rerun.json --output /tmp/blast-demo/report-with-heal.html
```

The line: *no human wrote a selector.* Say plainly that the replayed steps are marked `recorded` in
the artifact, so replayed evidence is never shown as a live call.

### 7. Result — 2:40 to 2:50

Ten vendors watched, three capabilities provable, and the README's eval table generated by
`npm run metrics` rather than typed. Say the smaller number out loud. Publishing the gap is the
point.

### 8. Close — 2:50 to 3:00

```bash
git blame -L 6,6 fixtures/repository/src/slack-upload.ts
```

A line, an author, a date, and a vendor deadline nobody connected to it until now.

## Between takes

Reset so every take starts identical:

```bash
rm -rf /tmp/blast-demo && mkdir -p /tmp/blast-demo
node dist/src/cli.js collect --fixture fixtures/slack-notice.json --output /tmp/blast-demo/last-good.json
node dist/src/cli.js scan fixtures/repository --collection /tmp/blast-demo/last-good.json --output /tmp/blast-demo/scan.json
clear
```

Skip the live collection command on takes two through five unless the take is otherwise perfect.
Each run spends credits, and the footage from take one can be reused.

## After recording

1. Cut the heal wait to a jump-cut with a visible time marker so the edit is disclosed, not hidden.
2. Watch it once at full speed without pausing. If the countdown and the line number are not
   readable, the take failed regardless of what was said.
3. Work the submission checklist in [issue #15](https://github.com/sivaratrisrinivas/blastradius/issues/15).

## Honest notes

- The deadline countdown is real and moves. The OpenAI notice reads August 26, 2026, so the number
  on screen depends on the day you record. Do not re-record to get a rounder number.
- The `--live` beat is the only unrehearsed-by-default step. If the network fails mid-take, the
  offline fixture path produces the same artifact shape and the demo survives; say so on camera
  rather than cutting.
- `check` exits 0 whether or not it finds an Impact. If you want the zero-Impact contrast on
  camera, `node dist/src/cli.js check fixtures/repository-clean` shows it in one line.
