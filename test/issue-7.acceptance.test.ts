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

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const cloudflareFixture = resolve(repositoryRoot, "fixtures/cloudflare-kv-notice.json");
const cloudflareRepository = resolve(repositoryRoot, "fixtures/repository-cloudflare");
const cloudflareDecoysRepository = resolve(repositoryRoot, "fixtures/repository-cloudflare-decoys");

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
  runCli(["collect", "--fixture", cloudflareFixture, "--output", outputPath]);
  return outputPath;
}

test("Cloudflare collection stores a gated VendorNotice with the stop-working deadline", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-7-");
  const outputPath = resolve(outputDirectory, "vendor-notice.json");

  const output = runCli(["collect", "--fixture", cloudflareFixture, "--output", outputPath]);
  const artifact = JSON.parse(readFileSync(outputPath, "utf8"));

  assert.match(output, /Verified Cloudflare VendorNotice/);
  assert.match(output, /October 15, 2026/);
  assert.equal(artifact.notice.vendor, "Cloudflare");
  assert.equal(artifact.capabilityChange.canonicalIdentifier, "cloudflare.workers.kv.legacy-namespace-routes");
  assert.equal(artifact.capabilityChange.deadlineIso, "2026-10-15");
});

test("scan proves Cloudflare literal and structured configuration endpoints and discloses dynamic access", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-7-");
  const collectionPath = collectTo(outputDirectory);
  const scanPath = resolve(outputDirectory, "scan-result.json");

  const output = runCli([
    "scan",
    cloudflareRepository,
    "--collection",
    collectionPath,
    "--output",
    scanPath
  ]);
  // SAFETY: the CLI writes this file as the validated scan-result artifact for the same fixture.
  const result = JSON.parse(readFileSync(scanPath, "utf8")) as StoredScanArtifact;

  assert.match(output, /2 proven CodeMatches; 1 unresolved usage\(s\)/);
  assert.match(output, /Impact: cloudflare\.workers\.kv\.legacy-namespace-routes/);
  assert.match(output, /config\/cloudflare\.json:4/);
  assert.match(output, /src\/kv-client\.ts:2/);
  assert.match(output, /src\/kv-client\.ts:10:.*dynamic.*statically proven/i);
  assert.equal(result.codeMatches.length, 2);
  assert.deepEqual(result.codeMatches, [
    {
      vendor: "Cloudflare",
      capabilityIdentifier: "cloudflare.workers.kv.legacy-namespace-routes",
      file: "config/cloudflare.json",
      line: 4,
      evidenceStrength: "direct",
      context: "source",
      evidence: "\"namespaceEndpoint\": \"https://api.cloudflare.com/client/v4/accounts/abc123/workers/namespaces/ns123/values/key\""
    },
    {
      vendor: "Cloudflare",
      capabilityIdentifier: "cloudflare.workers.kv.legacy-namespace-routes",
      file: "src/kv-client.ts",
      line: 2,
      evidenceStrength: "direct",
      context: "source",
      evidence: "return fetch(\"https://api.cloudflare.com/client/v4/accounts/abc123/workers/namespaces/ns123/values/key\");"
    }
  ]);
  assert.equal(result.impact?.codeMatches.length, 2);
  assert.deepEqual(result.limitations.map(limitation => [limitation.file, limitation.line]), [["src/kv-client.ts", 10]]);
  assert.doesNotMatch(output, /storage\/kv/);
  assert.doesNotMatch(output, /namespaces-old/);
});

test("Cloudflare near-miss strings, comments, and replacement routes produce no Impact", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-7-");
  const collectionPath = collectTo(outputDirectory);
  const scanPath = resolve(outputDirectory, "scan-result.json");

  const output = runCli([
    "scan",
    cloudflareDecoysRepository,
    "--collection",
    collectionPath,
    "--output",
    scanPath
  ]);
  // SAFETY: the CLI writes this file as the validated scan-result artifact for the same fixture.
  const result = JSON.parse(readFileSync(scanPath, "utf8")) as StoredScanArtifact;

  assert.match(output, /0 proven CodeMatch/);
  assert.match(output, /No Impact: no proven CodeMatch was found/);
  assert.equal(result.codeMatches.length, 0);
  assert.equal(result.impact, null);
  assert.deepEqual(result.limitations.map(limitation => [limitation.file, limitation.line]), [["src/decoys.ts", 5]]);
  assert.equal(existsSync(resolve(outputDirectory, "scan-result.json")), true);
});

test("Cloudflare report keeps proven locations and limitations in the local artifact path", () => {
  const outputDirectory = mkdtempSync("/tmp/blast-radius-issue-7-");
  const collectionPath = collectTo(outputDirectory);
  const scanPath = resolve(outputDirectory, "scan-result.json");
  runCli(["scan", cloudflareRepository, "--collection", collectionPath, "--output", scanPath]);
  const reportPath = resolve(outputDirectory, "impact-report.html");

  runCli(["report", "--scan", scanPath, "--output", reportPath]);
  const report = readFileSync(reportPath, "utf8");

  assert.match(report, /Cloudflare/);
  assert.match(report, /legacy-namespace-routes/);
  assert.match(report, /config\/cloudflare\.json:4/);
  assert.match(report, /src\/kv-client\.ts:2/);
  assert.match(report, /data-section="analysis-limitations"/);
  assert.match(report, /src\/kv-client\.ts:10/);
  assert.match(report, /Repository analysis stayed local/);
});
