import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
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

function runCli(args: string[]): string {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
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
  assert.doesNotMatch(output, /Impact: slack\.files\.upload/);
  assert.doesNotMatch(output, /Confirmed Impact/);
  assert.equal(result.codeMatches.length, 0);
  assert.equal(result.impact, null);
  assert.ok(result.limitations.length >= 2);
});

test("scan preserves a proven Slack match when a decoy shadows its name", () => {
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
  assert.ok(result.limitations.some((limitation: { file: string; line: number; reason: string }) =>
    limitation.file === "src/mixed.ts" &&
    limitation.line === 15 &&
    limitation.reason === "The files.upload receiver is not proven to be a Slack client."
  ));
});
