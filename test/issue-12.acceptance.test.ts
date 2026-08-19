import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { brightDataHealDriver, recordedHealDriver } from "../src/collection/bright-data-heal.js";
import { detectCollectorHeal, resolveCollectorHeal, runCollectorHeal } from "../src/collection/heal.js";
import { assertCollectorHealArtifact, parseJson, type CollectorHealArtifact } from "../src/domain/artifacts.js";
import type { BrightDataConfig } from "../src/collection/bright-data.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const driftFixture = resolve(repositoryRoot, "fixtures/collector-health/required-field-collapse.json");
const zeroResultsFixture = resolve(repositoryRoot, "fixtures/collector-health/zero-results.json");
const healedRerunFixture = resolve(repositoryRoot, "fixtures/collector-health/healed-rerun.json");
const gateProgress = resolve(repositoryRoot, "fixtures/heal/awaiting-approval.progress.json");
const inProgressProgress = resolve(repositoryRoot, "fixtures/heal/in-progress.progress.json");
const resumedProgress = resolve(repositoryRoot, "fixtures/heal/resumed-done.progress.json");

const brightDataConfig: BrightDataConfig = {
  apiKey: "test-token-that-must-not-leak",
  collectorId: "c_public-notice",
  collectorVersion: "fixture-v1",
  apiBaseUrl: "https://brightdata.test",
  pollIntervalMs: 0,
  maxPollAttempts: 5
};

interface RecordedCall {
  method: string;
  url: string;
  body: string;
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repositoryRoot, encoding: "utf8" });
}

function readArtifact(path: string): CollectorHealArtifact {
  return assertCollectorHealArtifact(parseJson(readFileSync(path, "utf8")));
}

function fixtureResponse(path: string): Response {
  return new Response(readFileSync(path, "utf8"), { status: 200, headers: { "content-type": "application/json" } });
}

function recordingFetcher(calls: RecordedCall[], responses: Response[]): typeof fetch {
  return async (input, init) => {
    calls.push({ method: init?.method ?? "GET", url: String(input), body: String(init?.body ?? "") });
    const next = responses.shift();
    if (!next) throw new Error("test response queue exhausted");
    return next;
  };
}

/**
 * The heal prompt names what a field last held, so it needs a stored notice from a healthy
 * collection — the artifact `blast collect` writes, not the raw fixture behind it.
 */
function lastKnownGoodNotice(): string {
  const directory = mkdtempSync("/tmp/blast-radius-issue-12-known-good-");
  const noticePath = resolve(directory, "vendor-notice.json");
  const collected = runCli(["collect", "--fixture", slackFixture, "--output", noticePath]);
  assert.equal(collected.status, 0, collected.stderr);
  return noticePath;
}

function detectedDiagnostic(): ReturnType<typeof parseJson> {
  const directory = mkdtempSync("/tmp/blast-radius-issue-12-diagnostic-");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const detected = runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]);
  assert.notEqual(detected.status, 0, detected.stdout);
  return parseJson(readFileSync(diagnosticPath, "utf8"));
}

function detectedHeal(): CollectorHealArtifact {
  return detectCollectorHeal(detectedDiagnostic(), parseJson(readFileSync(lastKnownGoodNotice(), "utf8")));
}

test("a detected CollectorHealth signal composes a heal prompt naming the collapsed field", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-12-detect-");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const healPath = resolve(directory, "heal-detected.json");

  const detected = runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]);
  assert.notEqual(detected.status, 0, detected.stdout);
  assert.equal(existsSync(diagnosticPath), true);

  const composed = runCli(["heal", "detect", "--diagnostic", diagnosticPath, "--last-known-good", lastKnownGoodNotice(), "--output", healPath]);
  assert.equal(composed.status, 0, composed.stderr);

  const heal = readArtifact(healPath);
  assert.equal(heal.kind, "collector-heal");
  assert.equal(heal.stage, "detected");
  assert.equal(heal.detected.signal, "required-field-collapse");
  assert.deepEqual(heal.prompt.fields, ["capabilityIdentifier"]);
  assert.match(heal.prompt.text, /capabilityIdentifier/);
  assert.match(heal.prompt.text, /slack\.files\.upload/);
  assert.ok(heal.prompt.text.length <= 1000, `prompt was ${heal.prompt.text.length} characters`);
  assert.equal(heal.collector.identity, "deterministic-fixture");
  assert.equal(heal.collector.version, "fixture-v1");
  assert.equal(heal.approval.status, "not-requested");
  assert.equal(heal.heal.diff, null);
  assert.match(composed.stdout, /capabilityIdentifier/);
});

test("the composed prompt still names the collapsed field without a last known good collection", () => {
  const heal = detectCollectorHeal(detectedDiagnostic());
  assert.deepEqual(heal.prompt.fields, ["capabilityIdentifier"]);
  assert.match(heal.prompt.text, /capabilityIdentifier/);
  assert.doesNotMatch(heal.prompt.text, /previously extracted/);
});

test("a live heal polls Bright Data to the approval gate and keeps the recorded before and after", async () => {
  const calls: RecordedCall[] = [];
  const fetcher = recordingFetcher(calls, [
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    fixtureResponse(inProgressProgress),
    fixtureResponse(gateProgress)
  ]);

  const gated = await runCollectorHeal(detectedHeal(), brightDataHealDriver(brightDataConfig, fetcher, async () => {}));

  assert.equal(gated.stage, "awaiting-approval");
  assert.equal(gated.heal.source, "bright-data");
  assert.equal(gated.approval.status, "requested");
  assert.ok(gated.heal.diff);
  assert.match(gated.heal.diff.parseCodeBefore, /article p:first-of-type code/);
  assert.match(gated.heal.diff.parseCodeAfter, /article h1/);
  assert.deepEqual(gated.heal.completedSteps, [
    "planner",
    "control_preview_runner",
    "code_fixer",
    "step_preview_runner",
    "request_fulfillment_validator",
    "step_advance"
  ]);

  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url, "https://brightdata.test/dca/collectors/c_public-notice/refactor_template");
  assert.deepEqual(parseJson(calls[0]?.body ?? ""), { prompt: gated.prompt.text, custom_input: [] });
  assert.equal(calls[1]?.url, "https://brightdata.test/dca/collectors/c_public-notice/refactor_template/progress");
  assert.equal(calls.length, 3);
  assert.doesNotMatch(JSON.stringify(gated), /test-token-that-must-not-leak/);
});

test("approval sends an explicit human decision and never asks Bright Data to save automatically", async () => {
  const calls: RecordedCall[] = [];
  const gatedFetcher = recordingFetcher(calls, [
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    fixtureResponse(gateProgress),
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    fixtureResponse(resumedProgress)
  ]);
  const driver = brightDataHealDriver(brightDataConfig, gatedFetcher, async () => {});
  const gated = await runCollectorHeal(detectedHeal(), driver);
  const approved = await resolveCollectorHeal(gated, "approve", driver);

  assert.equal(approved.stage, "approved");
  assert.equal(approved.approval.status, "approved");
  assert.equal(approved.collector.version, "fixture-v1", "healing moves the template, never the collector identity");
  assert.ok(approved.heal.diff, "the approved artifact keeps the reviewed diff");

  const resume = calls.find(call => call.url.endsWith("resume_automation_job"));
  assert.ok(resume, "approval must resume the paused heal job");
  assert.equal(resume.method, "POST");
  assert.deepEqual(parseJson(resume.body), { message: true });
  assert.doesNotMatch(resume.body, /auto_save|auto_approve/);
});

test("rejection resumes with a negative decision and leaves the collector untouched", async () => {
  const calls: RecordedCall[] = [];
  const fetcher = recordingFetcher(calls, [
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    fixtureResponse(gateProgress),
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    fixtureResponse(resumedProgress)
  ]);
  const driver = brightDataHealDriver(brightDataConfig, fetcher, async () => {});
  const rejected = await resolveCollectorHeal(await runCollectorHeal(detectedHeal(), driver), "reject", driver);

  assert.equal(rejected.stage, "rejected");
  assert.equal(rejected.approval.status, "rejected");
  assert.equal(rejected.rerun.status, "not-run");
  assert.equal(rejected.collector.version, "fixture-v1");
  const resume = calls.find(call => call.url.endsWith("resume_automation_job"));
  assert.deepEqual(parseJson(resume?.body ?? ""), { message: false });
});

test("approval is impossible without an explicit human step", async () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-12-approval-");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const detectedPath = resolve(directory, "heal-detected.json");
  const unapprovedPath = resolve(directory, "heal-unapproved.json");

  assert.notEqual(runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]).status, 0);
  assert.equal(runCli(["heal", "detect", "--diagnostic", diagnosticPath, "--output", detectedPath]).status, 0);

  const driver = recordedHealDriver(resumedProgress);
  await assert.rejects(
    () => resolveCollectorHeal(readArtifact(detectedPath), "approve", driver),
    /approval gate/,
    "a heal that never reached the gate cannot be approved"
  );

  const premature = runCli(["heal", "approve", "--heal", detectedPath, "--recorded", resumedProgress, "--output", unapprovedPath]);
  assert.notEqual(premature.status, 0);
  assert.equal(readArtifact(unapprovedPath).stage, "detected");

  const autoApprove = runCli(["heal", "run", "--heal", detectedPath, "--recorded", gateProgress, "--auto-approve", "--output", unapprovedPath]);
  assert.notEqual(autoApprove.status, 0);
  assert.match(autoApprove.stderr, /auto-approve/);

  const autoSave = runCli(["heal", "approve", "--heal", detectedPath, "--recorded", resumedProgress, "--auto-save", "--output", unapprovedPath]);
  assert.notEqual(autoSave.status, 0);
  assert.match(autoSave.stderr, /auto-save/);
});

test("a replayed heal is reported as recorded evidence, never as a live call", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-12-recorded-");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const detectedPath = resolve(directory, "heal-detected.json");
  const gatedPath = resolve(directory, "heal-gated.json");

  assert.notEqual(runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]).status, 0);
  assert.equal(runCli(["heal", "detect", "--diagnostic", diagnosticPath, "--last-known-good", lastKnownGoodNotice(), "--output", detectedPath]).status, 0);

  const gated = runCli(["heal", "run", "--heal", detectedPath, "--recorded", gateProgress, "--output", gatedPath]);
  assert.equal(gated.status, 0, gated.stderr);
  const artifact = readArtifact(gatedPath);
  assert.equal(artifact.stage, "awaiting-approval");
  assert.equal(artifact.heal.source, "recorded");
  assert.match(gated.stdout, /recorded/i);
});

test("an approved heal reruns the collector and reports only the health it can prove", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-12-rerun-");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const detectedPath = resolve(directory, "heal-detected.json");
  const gatedPath = resolve(directory, "heal-gated.json");
  const approvedPath = resolve(directory, "heal-approved.json");
  const rerunPath = resolve(directory, "heal-rerun.json");

  assert.notEqual(runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]).status, 0);
  assert.equal(runCli(["heal", "detect", "--diagnostic", diagnosticPath, "--last-known-good", lastKnownGoodNotice(), "--output", detectedPath]).status, 0);
  assert.equal(runCli(["heal", "run", "--heal", detectedPath, "--recorded", gateProgress, "--output", gatedPath]).status, 0);
  assert.equal(runCli(["heal", "approve", "--heal", gatedPath, "--recorded", resumedProgress, "--output", approvedPath]).status, 0);

  const rerun = runCli(["heal", "rerun", "--heal", approvedPath, "--fixture", healedRerunFixture, "--output", rerunPath]);
  assert.equal(rerun.status, 0, rerun.stderr);
  const artifact = readArtifact(rerunPath);
  assert.equal(artifact.stage, "rerun-healthy");
  assert.equal(artifact.rerun.status, "healthy");
  assert.equal(artifact.rerun.collectorHealth?.status, "healthy");
  assert.equal(artifact.rerun.collectorHealth?.collector.version, "fixture-v1");
  assert.match(rerun.stdout, /does not establish semantic correctness or completeness/);
});

test("a rerun that drifts again is recorded as a failed rerun rather than a healthy one", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-12-rerun-failed-");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const detectedPath = resolve(directory, "heal-detected.json");
  const gatedPath = resolve(directory, "heal-gated.json");
  const approvedPath = resolve(directory, "heal-approved.json");
  const failedPath = resolve(directory, "heal-rerun-failed.json");

  assert.notEqual(runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]).status, 0);
  assert.equal(runCli(["heal", "detect", "--diagnostic", diagnosticPath, "--output", detectedPath]).status, 0);
  assert.equal(runCli(["heal", "run", "--heal", detectedPath, "--recorded", gateProgress, "--output", gatedPath]).status, 0);
  assert.equal(runCli(["heal", "approve", "--heal", gatedPath, "--recorded", resumedProgress, "--output", approvedPath]).status, 0);

  const failed = runCli(["heal", "rerun", "--heal", approvedPath, "--fixture", zeroResultsFixture, "--output", failedPath]);
  assert.notEqual(failed.status, 0);
  const artifact = readArtifact(failedPath);
  assert.equal(artifact.stage, "rerun-failed");
  assert.equal(artifact.rerun.status, "failed");
});

test("the Impact Report renders the real before and after parse_code at the approval gate", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-12-report-");
  const collectionPath = resolve(directory, "vendor-notice.json");
  const scanPath = resolve(directory, "scan-result.json");
  const reportPath = resolve(directory, "impact-report.html");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const detectedPath = resolve(directory, "heal-detected.json");
  const gatedPath = resolve(directory, "heal-gated.json");
  const approvedPath = resolve(directory, "heal-approved.json");
  const rerunPath = resolve(directory, "heal-rerun.json");

  assert.equal(runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]).status, 0);
  assert.equal(runCli(["scan", resolve(repositoryRoot, "fixtures/repository"), "--collection", collectionPath, "--output", scanPath]).status, 0);
  assert.notEqual(runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]).status, 0);
  assert.equal(runCli(["heal", "detect", "--diagnostic", diagnosticPath, "--last-known-good", lastKnownGoodNotice(), "--output", detectedPath]).status, 0);
  assert.equal(runCli(["heal", "run", "--heal", detectedPath, "--recorded", gateProgress, "--output", gatedPath]).status, 0);
  assert.equal(runCli(["heal", "approve", "--heal", gatedPath, "--recorded", resumedProgress, "--output", approvedPath]).status, 0);
  assert.equal(runCli(["heal", "rerun", "--heal", approvedPath, "--fixture", healedRerunFixture, "--output", rerunPath]).status, 0);

  const report = runCli(["report", "--scan", scanPath, "--heal", rerunPath, "--output", reportPath]);
  assert.equal(report.status, 0, report.stderr);
  const html = readFileSync(reportPath, "utf8");

  assert.match(html, /See how collector healing works/);
  assert.match(html, /capabilityIdentifier/);
  assert.match(html, /article p:first-of-type code/, "the report shows the parse_code Bright Data replaced");
  assert.match(html, /article h1/, "the report shows the parse_code Bright Data proposed");
  assert.match(html, /data-diff-line="removed"/);
  assert.match(html, /data-diff-line="added"/);
  assert.match(html, /only these three checks/);
  assert.doesNotMatch(html, /\brepair\b/i);
  assert.doesNotMatch(html, /auto-fix/i);
  assert.doesNotMatch(html, /recover/i);
});

/**
 * A detected heal has a prompt but no proposal yet, so the approval gate has nothing to show.
 * The report must say so rather than offer a button to a screen that never renders.
 */
test("a report for a heal that was never sent offers no approval gate", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-12-report-detected-");
  const collectionPath = resolve(directory, "vendor-notice.json");
  const scanPath = resolve(directory, "scan-result.json");
  const reportPath = resolve(directory, "impact-report.html");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const detectedPath = resolve(directory, "heal-detected.json");

  assert.equal(runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]).status, 0);
  assert.equal(runCli(["scan", resolve(repositoryRoot, "fixtures/repository"), "--collection", collectionPath, "--output", scanPath]).status, 0);
  assert.notEqual(runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]).status, 0);
  assert.equal(runCli(["heal", "detect", "--diagnostic", diagnosticPath, "--output", detectedPath]).status, 0);

  const report = runCli(["report", "--scan", scanPath, "--heal", detectedPath, "--output", reportPath]);
  assert.equal(report.status, 0, report.stderr);
  const html = readFileSync(reportPath, "utf8");

  assert.match(html, /data-section="heal-prompt"/, "the composed prompt is still shown");
  assert.match(html, /data-section="heal-not-sent"/);
  assert.doesNotMatch(html, /data-next="approval"/);
  assert.doesNotMatch(html, /data-screen="approval"/);
  assert.doesNotMatch(html, /data-screen="healed"/);
});
