import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

interface StoredCodeMatch {
  vendor: string;
  capabilityIdentifier: string;
  file: string;
  line: number;
  evidenceStrength: string;
  context: string;
  evidence: string;
}

interface StoredScanArtifact {
  codeMatches: StoredCodeMatch[];
  limitations: Array<{ file: string; line: number; reason: string }>;
  impact: { codeMatches: StoredCodeMatch[] } | null;
}

interface ScanExecution {
  output: string;
  path: string;
  result: StoredScanArtifact;
}

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const mixedFixtureRepository = resolve(repositoryRoot, "fixtures/repository-with-analysis-limitations");
const unresolvedFixtureRepository = resolve(repositoryRoot, "fixtures/repository-with-unresolved-usage");
const crossFileAliasFixtureRepository = resolve(repositoryRoot, "fixtures/repository-with-cross-file-alias");

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

function scanTo(directory: string, repositoryPath: string): ScanExecution {
  const collectionPath = collectTo(directory);
  const scanPath = resolve(directory, "scan-result.json");
  const output = runCli(["scan", repositoryPath, "--collection", collectionPath, "--output", scanPath]);
  const result = JSON.parse(readFileSync(scanPath, "utf8"));
  return { output, path: scanPath, result };
}

test("scan stores proven CodeMatches and separate Analysis Limitations at the CLI boundary", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-4-");
  const scan = scanTo(outputDirectory, mixedFixtureRepository);

  assert.match(scan.output, /1 proven CodeMatch; 3 unresolved usage\(s\)/);
  assert.match(scan.output, /Analysis Limitations:/);
  assert.match(scan.output, /src\/mixed\.ts:10:.*dynamic.*statically proven/i);
  assert.match(scan.output, /src\/mixed\.ts:14:.*dynamic.*statically proven/i);
  assert.match(scan.output, /src\/mixed\.ts:18:.*dynamic.*statically proven/i);
  assert.match(scan.output, /Impact: slack\.files\.upload/);
  assert.equal(scan.result.codeMatches.length, 1);
  assert.deepEqual(scan.result.codeMatches[0], {
    vendor: "Slack",
    capabilityIdentifier: "slack.files.upload",
    file: "src/mixed.ts",
    line: 6,
    evidenceStrength: "direct",
    context: "source",
    evidence: "return slack.files.upload({ channels: channel, file });"
  });
  assert.deepEqual(scan.result.limitations.map(limitation => [limitation.file, limitation.line]), [
    ["src/mixed.ts", 10],
    ["src/mixed.ts", 14],
    ["src/mixed.ts", 18]
  ]);
  assert.equal(scan.result.impact?.codeMatches.length, 1);
});

test("the local report keeps Analysis Limitations structurally separate from CodeMatches", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-4-");
  const scan = scanTo(outputDirectory, mixedFixtureRepository);
  const reportPath = resolve(outputDirectory, "impact-report.html");

  runCli(["report", "--scan", scan.path, "--output", reportPath]);
  const report = readFileSync(reportPath, "utf8");

  assert.match(report, /<section[^>]*data-section="proven-code-matches"[^>]*aria-labelledby="proven-code-matches-heading"/);
  assert.match(report, /<h2 id="proven-code-matches-heading">Proven CodeMatches<\/h2>/);
  assert.match(report, /<section[^>]*data-section="analysis-limitations"[^>]*aria-labelledby="analysis-limitations-heading"/);
  assert.match(report, /<h2 id="analysis-limitations-heading">Analysis Limitations<\/h2>/);
  assert.match(report, /data-record-kind="code-match"/);
  assert.match(report, /data-record-kind="analysis-limitation"/);
  assert.match(report, /src\/mixed\.ts:10/);
  assert.match(report, /Computed or dynamic Slack endpoint access cannot be statically proven\./);
});

test("unresolved usage is disclosed without becoming a CodeMatch or Impact", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-4-");
  const scan = scanTo(outputDirectory, unresolvedFixtureRepository);

  assert.match(scan.output, /0 proven CodeMatch; 1 unresolved usage\(s\)/);
  assert.match(scan.output, /No Impact: no proven CodeMatch was found\./);
  assert.doesNotMatch(scan.output, /^Impact:/m);
  assert.match(scan.output, /Analysis Limitations:/);
  assert.match(scan.output, /src\/dynamic\.ts:6/);
  assert.equal(scan.result.codeMatches.length, 0);
  assert.equal(scan.result.impact, null);
  assert.deepEqual(scan.result.limitations.map(limitation => [limitation.file, limitation.line]), [["src/dynamic.ts", 6]]);
});

test("cross-file Slack aliases are disclosed as unresolved instead of guessed", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-4-");
  const scan = scanTo(outputDirectory, crossFileAliasFixtureRepository);

  assert.match(scan.output, /0 proven CodeMatch/);
  assert.match(scan.output, /Analysis Limitations:/);
  assert.match(scan.output, /src\/consumer\.ts:4:.*not proven to be a Slack client/);
  assert.equal(scan.result.codeMatches.length, 0);
  assert.equal(scan.result.impact, null);
  assert.ok(scan.result.limitations.some(limitation => limitation.file === "src/consumer.ts" && limitation.line === 4));
  assert.equal(existsSync(resolve(outputDirectory, "scan-result.json")), true);
});
