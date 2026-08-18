import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { collectBrightDataVendorNotice, type BrightDataConfig } from "../src/collection/bright-data.js";
import { CollectorHealthError } from "../src/domain/collector-health.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const slackRepository = resolve(repositoryRoot, "fixtures/repository");
const healthFixtures = {
  zeroResults: resolve(repositoryRoot, "fixtures/collector-health/zero-results.json"),
  requiredFieldCollapse: resolve(repositoryRoot, "fixtures/collector-health/required-field-collapse.json"),
  schemaFailure: resolve(repositoryRoot, "fixtures/collector-health/schema-failure.json")
};

interface HealthDiagnostic {
  kind: string;
  collectorHealth: {
    status: string;
    signal: string | null;
    collector: { identity: string; version: string };
    checks: Record<string, string>;
  };
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
}

function readStored(directory: string, fixture: string): { result: ReturnType<typeof runCli>; outputPath: string; diagnostic: HealthDiagnostic } {
  const outputPath = resolve(directory, "collector-health.json");
  const result = runCli(["collect", "--fixture", fixture, "--output", outputPath]);
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(existsSync(outputPath), true);
  const diagnostic: HealthDiagnostic = JSON.parse(readFileSync(outputPath, "utf8"));
  return { result, outputPath, diagnostic };
}

test("zero results are stored as drifted CollectorHealth and cannot enter scanning", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-10-zero-");
  const { result, outputPath, diagnostic } = readStored(directory, healthFixtures.zeroResults);

  assert.match(result.stderr, /CollectorHealth drift detected/);
  assert.match(result.stderr, /zero-results/);
  assert.match(result.stderr, /deterministic-fixture@fixture-v1/);
  assert.equal(diagnostic.kind, "collector-health");
  assert.equal(diagnostic.collectorHealth.status, "drifted");
  assert.equal(diagnostic.collectorHealth.signal, "zero-results");
  assert.equal(diagnostic.collectorHealth.collector.version, "fixture-v1");

  const scan = runCli(["scan", slackRepository, "--collection", outputPath, "--output", resolve(directory, "scan-result.json")]);
  assert.notEqual(scan.status, 0);
  assert.match(scan.stderr, /drifted collector output/);
  assert.match(scan.stderr, /zero-results/);
});

test("required-field collapse is stored as drifted CollectorHealth", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-10-fields-");
  const { result, diagnostic } = readStored(directory, healthFixtures.requiredFieldCollapse);

  assert.match(result.stderr, /required-field-collapse/);
  assert.match(result.stderr, /excerpt/);
  assert.equal(diagnostic.collectorHealth.status, "drifted");
  assert.equal(diagnostic.collectorHealth.signal, "required-field-collapse");
  assert.equal(diagnostic.collectorHealth.collector.identity, "deterministic-fixture");
});

test("schema failure is stored as drifted CollectorHealth before interpretation", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-10-schema-");
  const { result, diagnostic } = readStored(directory, healthFixtures.schemaFailure);

  assert.match(result.stderr, /schema-failure/);
  assert.match(result.stderr, /fixture-v1/);
  assert.equal(diagnostic.collectorHealth.status, "drifted");
  assert.equal(diagnostic.collectorHealth.signal, "schema-failure");
  assert.equal(diagnostic.collectorHealth.collector.version, "fixture-v1");
});

test("healthy collection and scan describe only the three supported health checks", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-10-healthy-");
  const collectionPath = resolve(directory, "vendor-notice.json");
  const scanPath = resolve(directory, "scan-result.json");
  const collected = runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]);
  assert.equal(collected.status, 0, collected.stderr);
  assert.match(collected.stdout, /CollectorHealth: passed zero-results, required-field-collapse, and schema-failure checks only/);
  assert.match(collected.stdout, /does not establish semantic correctness or completeness/);

  const collection = JSON.parse(readFileSync(collectionPath, "utf8"));
  assert.equal(collection.collectorHealth.status, "healthy");
  assert.equal(collection.collectorHealth.signal, null);
  assert.deepEqual(collection.collectorHealth.checks, {
    zeroResults: "passed",
    requiredFields: "passed",
    schema: "passed"
  });

  const scanned = runCli(["scan", slackRepository, "--collection", collectionPath, "--output", scanPath]);
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.match(scanned.stdout, /CollectorHealth: passed zero-results, required-field-collapse, and schema-failure checks only/);
  const scan = JSON.parse(readFileSync(scanPath, "utf8"));
  assert.equal(scan.collectorHealth.status, "healthy");
  assert.equal(scan.impact.codeMatches.length, 1);
});

test("a drifted health record cannot be rendered as a confirmed Impact", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-10-report-");
  const collectionPath = resolve(directory, "vendor-notice.json");
  const scanPath = resolve(directory, "scan-result.json");
  const reportPath = resolve(directory, "impact-report.html");
  assert.equal(runCli(["collect", "--fixture", slackFixture, "--output", collectionPath]).status, 0);
  assert.equal(runCli(["scan", slackRepository, "--collection", collectionPath, "--output", scanPath]).status, 0);

  const scan = JSON.parse(readFileSync(scanPath, "utf8"));
  scan.collectorHealth = {
    ...scan.collectorHealth,
    status: "drifted",
    signal: "schema-failure",
    checks: { zeroResults: "not-evaluated", requiredFields: "not-evaluated", schema: "failed" }
  };
  writeFileSync(scanPath, `${JSON.stringify(scan)}\n`, "utf8");

  const report = runCli(["report", "--scan", scanPath, "--output", reportPath]);
  assert.notEqual(report.status, 0);
  assert.match(report.stderr, /drifted CollectorHealth output cannot be rendered as a confirmed Impact/);
  assert.equal(existsSync(reportPath), false);
});

test("the live collection boundary classifies the same three supported health signals", async () => {
  const config: BrightDataConfig = {
    apiKey: "test-token",
    collectorId: "c_health",
    collectorVersion: "health-fixture-v1",
    apiBaseUrl: "https://brightdata.test",
    pollIntervalMs: 0,
    maxPollAttempts: 1
  };
  const sourceUrl = "https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/";
  const cases = [
    { signal: "zero-results", body: "[]" },
    {
      signal: "required-field-collapse",
      body: JSON.stringify([{
        vendor: "Slack",
        sourceUrl,
        content: "The files.upload method stopped functioning on November 12, 2025.",
        excerpt: "",
        capabilityIdentifier: "slack.files.upload",
        changeType: "shutdown",
        deadlineOriginal: "November 12, 2025",
        deadlineIso: "2025-11-12"
      }])
    },
    { signal: "schema-failure", body: "not-json" }
  ] as const;

  for (const healthCase of cases) {
    const responses = [new Response(JSON.stringify({ collection_id: "j_health" })), new Response(healthCase.body)];
    await assert.rejects(
      collectBrightDataVendorNotice(
        { vendor: "Slack", sourceUrl },
        config,
        async () => responses.shift() ?? new Response("[]"),
        async () => {}
      ),
      error => {
        assert.ok(error instanceof CollectorHealthError);
        assert.equal(error.artifact.collectorHealth.status, "drifted");
        assert.equal(error.artifact.collectorHealth.signal, healthCase.signal);
        assert.equal(error.artifact.collectorHealth.collector.version, "health-fixture-v1");
        return true;
      }
    );
  }
});
