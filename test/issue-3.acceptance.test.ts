import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const decoyFixtureRepository = resolve(repositoryRoot, "fixtures/repository-decoys");
const shadowedDecoyFixtureRepository = resolve(repositoryRoot, "fixtures/repository-with-shadowed-decoy");

function runCliResult(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
}

function runCli(args: string[]): string {
  const result = runCliResult(args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function collectTo(directory: string): string {
  const outputPath = resolve(directory, "vendor-notice.json");
  runCli(["collect", "--fixture", slackFixture, "--output", outputPath]);
  return outputPath;
}

test("scan rejects Slack-shaped decoys and creates no Impact", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-3-");
  const collectionPath = collectTo(outputDirectory);
  const scanPath = resolve(outputDirectory, "scan-result.json");

  const output = runCli([
    "scan",
    decoyFixtureRepository,
    "--collection",
    collectionPath,
    "--output",
    scanPath
  ]);
  const result = JSON.parse(readFileSync(scanPath, "utf8"));

  assert.match(output, /0 proven CodeMatch/);
  assert.match(output, /No Impact: no proven CodeMatch was found/);
  assert.doesNotMatch(output, /^Impact:/m);
  assert.equal(result.codeMatches.length, 0);
  assert.equal(result.impact, null);
  assert.ok(result.limitations.length >= 2);

  const reportPath = resolve(outputDirectory, "impact-report.html");
  const reportResult = runCliResult(["report", "--scan", scanPath, "--output", reportPath]);
  assert.notEqual(reportResult.status, 0);
  assert.match(reportResult.stderr, /cannot generate an Impact Report without a proven CodeMatch/);
  assert.equal(existsSync(reportPath), false);
});

test("scan preserves a proven Slack match across shadowing, reassignment, and unsupported scopes", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-3-");
  const collectionPath = collectTo(outputDirectory);
  const scanPath = resolve(outputDirectory, "scan-result.json");

  const output = runCli([
    "scan",
    shadowedDecoyFixtureRepository,
    "--collection",
    collectionPath,
    "--output",
    scanPath
  ]);
  const result = JSON.parse(readFileSync(scanPath, "utf8"));

  assert.match(output, /1 proven CodeMatch/);
  assert.match(output, /Impact: slack\.files\.upload/);
  assert.deepEqual(result.codeMatches, [
    {
      vendor: "Slack",
      capabilityIdentifier: "slack.files.upload",
      file: "src/mixed.ts",
      line: 6,
      evidenceStrength: "direct",
      context: "source",
      evidence: "return slack.files.upload({ channels: channel, file });"
    }
  ]);
  assert.equal(result.impact.codeMatches.length, 1);
  assert.deepEqual(
    result.limitations
      .filter((limitation: { file: string }) => limitation.file === "src/mixed.ts")
      .map((limitation: { line: number }) => limitation.line)
      .sort((left: number, right: number) => left - right),
    [15, 21, 26, 34, 44, 49, 55, 59, 66, 75]
  );
});
