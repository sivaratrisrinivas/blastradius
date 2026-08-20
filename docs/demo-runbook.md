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

Run `./scripts/demo-reset.sh`, then `./scripts/demo.sh`. Press any key to advance. The quoted text
is the narration. The notes underneath are cues for what to point at, not more lines to read.

### 1. Hook, 0:00 to 0:10

> "The dangerous API change is the one your package manager can't see. A vendor can shut off a capability your code still calls, and you find out when a user does."

Nothing on screen but a prompt.

### 2. Before, 0:10 to 0:25

> "`npm outdated` says this repo is up to date. That's the trap. Package versions can be current while a vendor puts one of the APIs inside them on a deadline. The dependencies look healthy. The integration may not be."

`npm outdated` returns almost nothing. Keep the cursor on the empty result.

### 3. One command on a real repository, 0:25 to 1:05

> "Now I want the question `npm outdated` can't answer. Does this repository call a capability that a vendor is shutting down? `blast check` takes the vendor notice, then scans the repository locally. Here it checks 711 files and finds one Impact, five exact line numbers, and a deadline."

> "This is OpenAI's own SDK, pinned to a commit anyone can clone, calling the API OpenAI is shutting down. The vendor published the notice. The scanner proved the line. We need both receipts before we call this an Impact."

Hold the cursor on the countdown, then on a `file:line`. Point to the three Azure call sites under
Analysis Limitations.

> "Those Azure call sites stay out of the Impact because the scanner couldn't prove the connection. That is the boundary. Blast Radius may miss something. It does not turn a guess into an outage."

### 4. Three vendors at once, 1:05 to 1:25

> "This is not an OpenAI-only problem. The same thing happens when a team depends on several vendors whose plans live outside the repo. One command checks Slack, OpenAI, and Cloudflare. Each deadline stays attached to its capability, and each result still needs a line the scanner can prove."

`blast check fixtures/repository-multi-vendor` returns Slack, OpenAI, and Cloudflare in one pass,
each with its own deadline and line number.

### 5. It is not a fixture, 1:25 to 1:50

> "Before we trust the result, check where it came from. This next collection is live. Bright Data reads Slack's public notice, and the evidence sentence is different from the stored fixture. It came from the page we fetched, not from text I typed into the demo. Bright Data receives the public vendor material. The repository stays on this machine."

Point out the changed evidence sentence on screen.

### 6. Reveal, 1:50 to 2:10

> "Now the report puts the two things a person needs next to each other. The vendor's own sentence beside the file and line that matched it. Nobody has to turn a generic deprecation notice into a new code search project. Scroll down and the limits are there too. The report tells us what it found and where its proof stops."

The Impact Report opens in the browser. Click one row, then scroll to Analysis Limitations.

### 7. The heal, 2:10 to 2:45

> "There is another way a tool loses trust. It can pretend its own collection never breaks. Here we force a collector failure. A required field collapses, so the diagnostic command exits 1 and withholds the broken result."

> "`heal detect` names the field that failed and composes a repair prompt for Bright Data. No human writes a selector. Blast Radius still stops at an approval gate, because a proposed repair is not proof that the repair is right."

Cut to the pre-recorded wait, then come back live at the approval gate.

> "The wait is recorded because a real heal takes two to three minutes. The artifact labels those steps `recorded`, so replayed evidence is never presented as a live call. We approve the proposal, rerun the collection, and check the result again."

### 8. Result, 2:45 to 2:55

> "Here is the number I want you to notice. Ten vendors watched. Three capabilities provable. The gap is not hidden, and it is not a rounding error. Watching a vendor does not mean Blast Radius can prove your repo uses it. The honest answer is smaller, but it is an answer you can trust."

The README eval table is generated by `npm run metrics`, not typed into the demo.

### 9. Close, 2:55 to 3:00

> "Finally, we follow one line back to the person who last changed it. `git blame` gives us the author and date. The vendor deadline tells us when that line matters. That is the job. Connect a public change to the exact code it affects before a customer discovers it for us."

`git blame` on the Slack call site. Hold on the line, author, date, and vendor deadline.

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
