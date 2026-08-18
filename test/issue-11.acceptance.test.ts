import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { assertCollectorRepairArtifact, parseJson, type CollectorRepairArtifact } from "../src/domain/artifacts.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const driftFixture = resolve(repositoryRoot, "fixtures/collector-health/required-field-collapse.json");
const zeroResultsFixture = resolve(repositoryRoot, "fixtures/collector-health/zero-results.json");
const healthyRepairFixture = resolve(repositoryRoot, "fixtures/collector-health/healthy-repair-v2.json");

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
}

function readArtifact(path: string): CollectorRepairArtifact {
  return assertCollectorRepairArtifact(parseJson(readFileSync(path, "utf8")));
}

test("collector recovery requires validation and approval before a healthy rerun", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-11-happy-");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const proposalPath = resolve(directory, "repair-proposal.json");
  const validatedPath = resolve(directory, "repair-validated.json");
  const activatedPath = resolve(directory, "repair-activated.json");
  const recoveredPath = resolve(directory, "repair-recovered.json");

  const detected = runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]);
  assert.notEqual(detected.status, 0, detected.stdout);
  assert.equal(existsSync(diagnosticPath), true);

  const proposed = runCli(["repair", "diagnose", "--diagnostic", diagnosticPath, "--output", proposalPath]);
  assert.equal(proposed.status, 0, proposed.stderr);
  const proposal = readArtifact(proposalPath);
  assert.equal(proposal.kind, "collector-repair");
  assert.equal(proposal.stage, "proposed");
  assert.equal(proposal.detected.signal, "required-field-collapse");
  assert.match(proposal.diagnosis, /required-field-collapse/);
  assert.equal(proposal.activeCollector.version, "fixture-v1");
  assert.equal(proposal.proposedCollector.version, "fixture-v2");
  assert.equal(proposal.validation.status, "not-run");
  assert.equal(proposal.approval.status, "not-requested");
  assert.equal(proposal.activation.status, "not-activated");

  const validated = runCli(["repair", "validate", "--proposal", proposalPath, "--fixture", healthyRepairFixture, "--output", validatedPath]);
  assert.equal(validated.status, 0, validated.stderr);
  const validation = readArtifact(validatedPath);
  assert.equal(validation.stage, "approval-requested");
  assert.equal(validation.validation.status, "passed");
  assert.deepEqual(validation.validation.checks, {
    collectionContract: "passed",
    zeroResults: "passed",
    requiredFields: "passed",
    schema: "passed"
  });
  assert.equal(validation.approval.status, "requested");
  assert.equal(validation.activeCollector.version, "fixture-v1");
  assert.equal(validation.proposedCollector.version, "fixture-v2");
  assert.match(validated.stdout, /approval is required/i);

  const approved = runCli(["repair", "approve", "--proposal", validatedPath, "--output", activatedPath]);
  assert.equal(approved.status, 0, approved.stderr);
  const activation = readArtifact(activatedPath);
  assert.equal(activation.stage, "activated");
  assert.equal(activation.approval.status, "approved");
  assert.equal(activation.activation.status, "activated");
  assert.ok(activation.activation.previousCollector);
  assert.equal(activation.activation.previousCollector.version, "fixture-v1");
  assert.equal(activation.activeCollector.version, "fixture-v2");
  assert.equal(activation.rerun.status, "not-run");

  const recovered = runCli(["repair", "rerun", "--proposal", activatedPath, "--fixture", healthyRepairFixture, "--output", recoveredPath]);
  assert.equal(recovered.status, 0, recovered.stderr);
  const recovery = readArtifact(recoveredPath);
  assert.equal(recovery.stage, "recovered");
  assert.equal(recovery.rerun.status, "healthy");
  assert.ok(recovery.rerun.collectorHealth);
  assert.equal(recovery.rerun.collectorHealth.status, "healthy");
  assert.equal(recovery.rerun.collectorHealth.collector.version, "fixture-v2");
  assert.match(recovered.stdout, /healthy rerun/i);
  assert.match(recovered.stdout, /does not establish semantic correctness or completeness/);
});

test("failed validation and unapproved activation remain non-activating", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-11-negative-");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const proposalPath = resolve(directory, "repair-proposal.json");
  const failedValidationPath = resolve(directory, "repair-validation-failed.json");
  const unapprovedActivationPath = resolve(directory, "repair-unapproved.json");

  assert.notEqual(runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]).status, 0);
  assert.equal(runCli(["repair", "diagnose", "--diagnostic", diagnosticPath, "--output", proposalPath]).status, 0);

  const failedValidation = runCli(["repair", "validate", "--proposal", proposalPath, "--fixture", zeroResultsFixture, "--output", failedValidationPath]);
  assert.notEqual(failedValidation.status, 0);
  const failed = readArtifact(failedValidationPath);
  assert.equal(failed.stage, "validation-failed");
  assert.equal(failed.validation.status, "failed");
  assert.equal(failed.approval.status, "not-requested");
  assert.equal(failed.activation.status, "not-activated");
  assert.equal(failed.activeCollector.version, "fixture-v1");
  assert.equal(failed.proposedCollector.version, "fixture-v2");

  const unapproved = runCli(["repair", "approve", "--proposal", proposalPath, "--output", unapprovedActivationPath]);
  assert.notEqual(unapproved.status, 0);
  const unchanged = readArtifact(unapprovedActivationPath);
  assert.equal(unchanged.stage, "proposed");
  assert.equal(unchanged.activation.status, "not-activated");
  assert.equal(unchanged.activeCollector.version, "fixture-v1");
});

test("the Impact Report exposes recovery only as an optional post-report second act", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-11-report-");
  const collectionPath = resolve(directory, "vendor-notice.json");
  const scanPath = resolve(directory, "scan-result.json");
  const reportPath = resolve(directory, "impact-report.html");
  const diagnosticPath = resolve(directory, "collector-health.json");
  const proposalPath = resolve(directory, "repair-proposal.json");
  const validatedPath = resolve(directory, "repair-validated.json");
  const activatedPath = resolve(directory, "repair-activated.json");
  const recoveredPath = resolve(directory, "repair-recovered.json");

  assert.equal(runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]).status, 0);
  assert.equal(runCli(["scan", resolve(repositoryRoot, "fixtures/repository"), "--collection", collectionPath, "--output", scanPath]).status, 0);
  assert.notEqual(runCli(["collect", "--fixture", driftFixture, "--output", diagnosticPath]).status, 0);
  assert.equal(runCli(["repair", "diagnose", "--diagnostic", diagnosticPath, "--output", proposalPath]).status, 0);
  assert.equal(runCli(["repair", "validate", "--proposal", proposalPath, "--fixture", healthyRepairFixture, "--output", validatedPath]).status, 0);
  assert.equal(runCli(["repair", "approve", "--proposal", validatedPath, "--output", activatedPath]).status, 0);
  assert.equal(runCli(["repair", "rerun", "--proposal", activatedPath, "--fixture", healthyRepairFixture, "--output", recoveredPath]).status, 0);
  const report = runCli(["report", "--scan", scanPath, "--repair", recoveredPath, "--output", reportPath]);
  assert.equal(report.status, 0, report.stderr);
  const html = readFileSync(reportPath, "utf8");
  assert.match(html, /See how collector recovery works/);
  assert.match(html, /The active collector remains/);
  assert.match(html, /Validation passed/);
  assert.match(html, /healthy rerun completed/i);
  assert.match(html, /only these three checks/);
});
