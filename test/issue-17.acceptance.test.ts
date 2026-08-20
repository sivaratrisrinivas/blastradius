import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { daysUntilDeadline, deadlineStatus } from "../src/report/render.js";
import { createStyler, deadlineUrgency, styleEnabled, type UrgencyLevel } from "../src/report/style.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const multiVendorRepository = resolve(repositoryRoot, "fixtures/repository-multi-vendor");

function strip(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

/** A fresh, non-global regex per call: `.test()` on a shared global regex carries `lastIndex` state across calls. */
function hasAnsiEscape(value: string): boolean {
  return /\x1b\[[0-9;]*m/.test(value);
}

/** Every plain (piped) run is spawned from a temporary directory: bundled fixtures must not need the CWD. */
function runCheckPiped(args: string[]) {
  return spawnSync(process.execPath, [cliPath, "check", ...args], {
    cwd: mkdtempSync(resolve(tmpdir(), "blast-check-cwd-")),
    encoding: "utf8"
  });
}

/**
 * `script` allocates a real pty so `process.stdout.isTTY` is true in the child, exactly like a
 * terminal running `blast check` directly. `stty -onlcr -echo` turns off the pty's own newline
 * translation and echo so the captured bytes are exactly what the CLI wrote, nothing added by the tty layer.
 */
function runCheckTty(repositoryPath: string, env: Readonly<Record<string, string>> = {}) {
  const envPrefix = Object.entries(env).map(([key, value]) => `${key}=${value} `).join("");
  const inner = `stty -onlcr -echo; ${envPrefix}${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} check ${JSON.stringify(repositoryPath)}`;
  return spawnSync("script", ["-qec", inner, "/dev/null"], {
    cwd: mkdtempSync(resolve(tmpdir(), "blast-check-pty-")),
    encoding: "utf8"
  });
}

const scriptAvailable = spawnSync("script", ["-V"]).status === 0;
const ttyTest = scriptAvailable ? test : test.skip;

test("styleEnabled requires both a real TTY and no NO_COLOR opt-out", () => {
  assert.equal(styleEnabled({ isTTY: true }, {}), true);
  assert.equal(styleEnabled({ isTTY: false }, {}), false);
  assert.equal(styleEnabled({}, {}), false);
  assert.equal(styleEnabled({ isTTY: true }, { NO_COLOR: "1" }), false);
  assert.equal(styleEnabled({ isTTY: true }, { NO_COLOR: "" }), false);
});

test("deadlineUrgency: red under 14 days or past, amber under 90, unstyled beyond or unstated", () => {
  assert.equal(deadlineUrgency("past", -1), "critical");
  assert.equal(deadlineUrgency("date-not-stated", null), "none");
  assert.equal(deadlineUrgency("upcoming", 0), "critical");
  assert.equal(deadlineUrgency("upcoming", 13), "critical");
  assert.equal(deadlineUrgency("upcoming", 14), "warning");
  assert.equal(deadlineUrgency("upcoming", 89), "warning");
  assert.equal(deadlineUrgency("upcoming", 90), "none");
  assert.equal(deadlineUrgency("upcoming", 365), "none");
});

test("a disabled styler is a pure passthrough", () => {
  const styler = createStyler(false);
  assert.equal(styler.bold("Impact: OpenAI"), "Impact: OpenAI");
  assert.equal(styler.dim("4 file(s) scanned"), "4 file(s) scanned");
  assert.equal(styler.cyan("src/assistants.ts:6"), "src/assistants.ts:6");
  assert.equal(styler.boldCyan("OpenAI"), "OpenAI");
  assert.equal(styler.urgency("Deadline: August 26, 2026", "critical"), "Deadline: August 26, 2026");
});

test("an enabled styler wraps text in resetting escape codes and leaves empty text alone", () => {
  const styler = createStyler(true);
  assert.equal(styler.bold("x"), "\x1b[1mx\x1b[0m");
  assert.equal(styler.dim("x"), "\x1b[2mx\x1b[0m");
  assert.equal(styler.cyan("x"), "\x1b[36mx\x1b[0m");
  assert.equal(styler.boldCyan("x"), "\x1b[1;36mx\x1b[0m");
  assert.equal(styler.urgency("x", "critical"), "\x1b[31mx\x1b[0m");
  assert.equal(styler.urgency("x", "warning"), "\x1b[33mx\x1b[0m");
  assert.equal(styler.urgency("x", "none"), "x");
  assert.equal(styler.bold(""), "");
});

test("blast check | cat produces exactly the bytes it produces today: no escape codes", () => {
  const result = runCheckPiped([multiVendorRepository]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(hasAnsiEscape(result.stdout), false, "piped output must carry no escape codes");
});

/** The colour `deadlineLine` would carry for one deadline, computed the same way the CLI computes it. */
function urgencyCode(level: UrgencyLevel): string {
  return level === "critical" ? "\x1b[31m" : level === "warning" ? "\x1b[33m" : "";
}

function urgencyLevel(deadlineIso: string, now: Date): UrgencyLevel {
  return deadlineUrgency(deadlineStatus(deadlineIso, now), daysUntilDeadline(deadlineIso, now));
}

ttyTest("on a real terminal, blast check styles the countdown, the locations, and the coverage numbers", () => {
  const now = new Date();
  const result = runCheckTty(multiVendorRepository);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(hasAnsiEscape(result.stdout), "a TTY run must carry escape codes");

  // Slack's 2025-11-12 deadline is already behind "now" for any date this repository can run at: always urgent, in red.
  const slackLevel = urgencyLevel("2025-11-12", now);
  assert.equal(slackLevel, "critical", "Slack's deadline is in the past and must always read as urgent");
  assert.ok(
    result.stdout.includes(`${urgencyCode(slackLevel)}Deadline: November 12, 2025`),
    `Slack's deadline line was not styled ${slackLevel}:\n${result.stdout}`
  );
  // Cloudflare's deadline moves through the calendar; colour it the same way deadlineUrgency would today.
  const cloudflareLevel = urgencyLevel("2026-10-15", now);
  assert.ok(
    result.stdout.includes(`${urgencyCode(cloudflareLevel)}Deadline: October 15, 2026`),
    `Cloudflare's deadline line was not styled ${cloudflareLevel}:\n${result.stdout}`
  );
  // file:line reads in cyan, ahead of its dimmed source snippet.
  assert.match(result.stdout, /\x1b\[36msrc\/slack-upload\.ts:6\x1b\[0m: \x1b\[2mreturn slack\.files\.upload/);
  // The Analysis Limitations block, including its heading, is dim.
  assert.match(result.stdout, /\x1b\[2mAnalysis Limitations: none\.\x1b\[0m/);
  // Coverage keeps the watched number dim and the provable number bold, per ADR 0002.
  assert.match(result.stdout, /Coverage: \x1b\[2m\d+\x1b\[0m vendors watched, \x1b\[1m\d+\x1b\[0m capabilities provable\./);
});

ttyTest("stripping ANSI from the styled output yields the plain output exactly", () => {
  const plain = runCheckPiped([multiVendorRepository]);
  const styled = runCheckTty(multiVendorRepository);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(styled.status, 0, styled.stderr);
  assert.equal(strip(styled.stdout), plain.stdout);
});

ttyTest("NO_COLOR on a real terminal produces those same plain bytes", () => {
  const plain = runCheckPiped([multiVendorRepository]);
  const noColor = runCheckTty(multiVendorRepository, { NO_COLOR: "1" });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(noColor.status, 0, noColor.stderr);
  assert.equal(hasAnsiEscape(noColor.stdout), false, "NO_COLOR must suppress every escape code");
  assert.equal(noColor.stdout, plain.stdout);
});

test("deadlineStatus agrees with deadlineUrgency's vocabulary", () => {
  const now = new Date("2026-08-21T00:00:00.000Z");
  assert.equal(deadlineStatus("2025-11-12", now), "past");
  assert.equal(deadlineUrgency(deadlineStatus("2025-11-12", now), -282), "critical");
});
