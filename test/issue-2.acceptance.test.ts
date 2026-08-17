import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const scanFixtureRepository = resolve(repositoryRoot, "fixtures/repository");

function runCli(args: string[]): string {
  const result = runCliResult(args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function runCliResult(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
}

function collectTo(directory: string): string {
  const outputPath = resolve(directory, "vendor-notice.json");
  runCli(["collect", "--fixture", slackFixture, "--output", outputPath]);
  return outputPath;
}

test("collect stores a versioned Slack VendorNotice artifact", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-");
  const outputPath = resolve(outputDirectory, "vendor-notice.json");

  const output = runCli(["collect", "--fixture", slackFixture, "--output", outputPath]);

  const artifact = JSON.parse(readFileSync(outputPath, "utf8"));

  assert.match(output, /Verified Slack VendorNotice/);
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.kind, "vendor-notice");
  assert.equal(artifact.notice.vendor, "Slack");
  assert.equal(
    artifact.notice.sourceUrl,
    "https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/"
  );
  assert.equal(artifact.notice.retrievedAt, "2026-08-18T00:00:00Z");
  assert.equal(
    artifact.notice.excerpt,
    "The files.upload method stopped functioning on November 12, 2025."
  );
});

test("scan proves one direct Slack CodeMatch and constructs one Impact", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-");
  const collectionPath = collectTo(outputDirectory);
  const scanPath = resolve(outputDirectory, "scan-result.json");

  const output = runCli([
    "scan",
    scanFixtureRepository,
    "--collection",
    collectionPath,
    "--output",
    scanPath
  ]);
  const result = JSON.parse(readFileSync(scanPath, "utf8"));

  assert.match(output, /1 proven CodeMatch/);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, "scan-result");
  assert.deepEqual(result.codeMatches, [
    {
      vendor: "Slack",
      capabilityIdentifier: "slack.files.upload",
      file: "src/slack-upload.ts",
      line: 6,
      evidenceStrength: "direct",
      context: "source",
      evidence: "return slack.files.upload({ channels: channel, file });"
    }
  ]);
  assert.equal(result.impact.capabilityChange.canonicalIdentifier, "slack.files.upload");
  assert.equal(result.impact.codeMatches.length, 1);
});

test("report renders the proven Impact and the three-action local workflow", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-");
  const collectionPath = collectTo(outputDirectory);
  const scanPath = resolve(outputDirectory, "scan-result.json");
  runCli(["scan", scanFixtureRepository, "--collection", collectionPath, "--output", scanPath]);
  const reportPath = resolve(outputDirectory, "impact-report.html");

  const output = runCli(["report", "--scan", scanPath, "--output", reportPath]);
  const report = readFileSync(reportPath, "utf8");

  assert.match(output, /Generated local Impact Report/);
  assert.equal((report.match(/<button[^>]*data-primary-action/g) ?? []).length, 3);
  assert.match(report, /Verify the vendor notice/);
  assert.match(report, /Scan the local repository/);
  assert.match(report, /Open the impact report/);
  assert.match(report, /The files\.upload method stopped functioning on November 12, 2025\./);
  assert.match(report, /November 12, 2025/);
  assert.match(report, /src\/slack-upload\.ts:6/);
  assert.match(report, /return slack\.files\.upload\(\{ channels: channel, file \}\);/);
  assert.match(report, /Confirmed Impact/);
  assert.match(report, /Repository analysis stayed local/);
});

test("a failed collection gate returns a non-zero status and an actionable message", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-");
  const invalidFixture = resolve(outputDirectory, "invalid-notice.json");
  const outputPath = resolve(outputDirectory, "vendor-notice.json");
  writeFileSync(invalidFixture, JSON.stringify({
    vendor: "Slack",
    sourceUrl: "https://example.com/slack-notice",
    retrievedAt: "2026-08-18T00:00:00Z",
    excerpt: "The files.upload method stopped functioning on November 12, 2025.",
    capabilityIdentifier: "slack.files.upload",
    changeType: "shutdown",
    deadlineOriginal: "November 12, 2025",
    deadlineIso: "2025-11-12"
  }), "utf8");

  const result = runCliResult(["collect", "--fixture", invalidFixture, "--output", outputPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /collection fixture is not an allowed first-party Slack source/);
});
