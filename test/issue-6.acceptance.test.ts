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
const openAINotice = resolve(repositoryRoot, "fixtures/openai-notice.json");
const directRepository = resolve(repositoryRoot, "fixtures/repository-openai");
const aliasesRepository = resolve(repositoryRoot, "fixtures/repository-openai-aliases");
const contextRepository = resolve(repositoryRoot, "fixtures/repository-openai-context");
const crossFileRepository = resolve(repositoryRoot, "fixtures/repository-openai-cross-file");
const unsupportedRepository = resolve(repositoryRoot, "fixtures/repository-openai-unsupported");

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
  const output = runCli(["collect", "--fixture", openAINotice, "--output", outputPath]);
  assert.match(output, /Verified OpenAI VendorNotice/);
  return outputPath;
}

function scanTo(directory: string, repositoryPath: string) {
  const collectionPath = collectTo(directory);
  const scanPath = resolve(directory, "scan-result.json");
  const output = runCli(["scan", repositoryPath, "--collection", collectionPath, "--output", scanPath]);
  // SAFETY: the CLI writes this file as the validated scan-result artifact for the same fixture.
  const result = JSON.parse(readFileSync(scanPath, "utf8")) as StoredScanArtifact;
  return { output, path: scanPath, result };
}

test("collect stores the gated OpenAI Assistants API VendorNotice", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-6-collection-");
  const outputPath = resolve(directory, "vendor-notice.json");
  const output = collectTo(directory);
  const artifact = JSON.parse(readFileSync(output, "utf8"));

  assert.equal(outputPath, output);
  assert.match(readFileSync(outputPath, "utf8"), /Assistants API/);
  assert.equal(artifact.notice.vendor, "OpenAI");
  assert.equal(artifact.notice.sourceUrl, "https://developers.openai.com/api/docs/assistants/migration");
  assert.equal(artifact.notice.excerpt, "After achieving feature parity in the Responses API, we've deprecated the Assistants API. It will shut down on August 26, 2026.");
  assert.equal(artifact.capabilityChange.canonicalIdentifier, "openai.assistants");
  assert.equal(artifact.capabilityChange.deadlineOriginal, "August 26, 2026");
  assert.equal(artifact.capabilityChange.deadlineIso, "2026-08-26");
});

test("scan proves direct OpenAI import and require usage with provenance", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-6-direct-");
  const scan = scanTo(directory, directRepository);

  assert.match(scan.output, /2 proven CodeMatches/);
  assert.match(scan.output, /Impact: openai\.assistants/);
  assert.deepEqual(scan.result.codeMatches.slice().sort((left, right) => left.line - right.line), [
    {
      vendor: "OpenAI",
      capabilityIdentifier: "openai.assistants",
      file: "src/assistants.ts",
      line: 6,
      evidenceStrength: "direct",
      context: "source",
      evidence: "return client.beta.assistants.create({ model });"
    },
    {
      vendor: "OpenAI",
      capabilityIdentifier: "openai.assistants",
      file: "src/assistants.ts",
      line: 13,
      evidenceStrength: "direct",
      context: "source",
      evidence: "return requiredClient.beta.assistants.create({ model });"
    }
  ] satisfies StoredCodeMatch[]);
  assert.ok(scan.result.impact);
  assert.equal(scan.result.impact.codeMatches.length, 2);
});

test("scan traces OpenAI aliases, destructuring, and one-file assignment chains", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-6-aliases-");
  const scan = scanTo(directory, aliasesRepository);

  assert.match(scan.output, /4 proven CodeMatches/);
  assert.deepEqual(scan.result.codeMatches.slice().sort((left, right) => left.line - right.line), [
    {
      vendor: "OpenAI",
      capabilityIdentifier: "openai.assistants",
      file: "src/assistants.ts",
      line: 8,
      evidenceStrength: "alias-traced",
      context: "source",
      evidence: "return assistants.create({ model });"
    },
    {
      vendor: "OpenAI",
      capabilityIdentifier: "openai.assistants",
      file: "src/assistants.ts",
      line: 15,
      evidenceStrength: "alias-traced",
      context: "source",
      evidence: "return destructuredAssistants.create({ model });"
    },
    {
      vendor: "OpenAI",
      capabilityIdentifier: "openai.assistants",
      file: "src/assistants.ts",
      line: 22,
      evidenceStrength: "alias-traced",
      context: "source",
      evidence: "return assignedAssistants.create({ model });"
    },
    {
      vendor: "OpenAI",
      capabilityIdentifier: "openai.assistants",
      file: "src/assistants.ts",
      line: 28,
      evidenceStrength: "alias-traced",
      context: "source",
      evidence: "return clientAlias.beta.assistants.create({ model });"
    }
  ]);
});

test("scan records source, test, and example context for OpenAI CodeMatches", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-6-context-");
  const scan = scanTo(directory, contextRepository);

  assert.deepEqual(scan.result.codeMatches.slice().sort((left, right) => left.file.localeCompare(right.file)), [
    {
      vendor: "OpenAI",
      capabilityIdentifier: "openai.assistants",
      file: "examples/assistant.ts",
      line: 6,
      evidenceStrength: "direct",
      context: "example",
      evidence: "return client.beta.assistants.create({ model });"
    },
    {
      vendor: "OpenAI",
      capabilityIdentifier: "openai.assistants",
      file: "src/assistant.ts",
      line: 6,
      evidenceStrength: "direct",
      context: "source",
      evidence: "return client.beta.assistants.create({ model });"
    },
    {
      vendor: "OpenAI",
      capabilityIdentifier: "openai.assistants",
      file: "test/assistant.test.ts",
      line: 6,
      evidenceStrength: "direct",
      context: "test",
      evidence: "return client.beta.assistants.create({ model });"
    }
  ]);
});

test("cross-file OpenAI aliases remain unresolved and cannot create an Impact", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-6-cross-file-");
  const scan = scanTo(directory, crossFileRepository);

  assert.match(scan.output, /0 proven CodeMatch/);
  assert.match(scan.output, /not proven to be an OpenAI client/);
  assert.equal(scan.result.codeMatches.length, 0);
  assert.equal(scan.result.impact, null);
  assert.ok(scan.result.limitations.some((limitation: { file: string; line: number }) => limitation.file === "src/consumer.ts" && limitation.line === 4));
  assert.equal(existsSync(resolve(directory, "scan-result.json")), true);
});

test("unsupported OpenAI access and shadowed loaders remain limitations", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-6-unsupported-");
  const scan = scanTo(directory, unsupportedRepository);

  assert.match(scan.output, /0 proven CodeMatch/);
  assert.match(scan.output, /No Impact: no proven CodeMatch was found/);
  assert.equal(scan.result.codeMatches.length, 0);
  assert.equal(scan.result.impact, null);
  assert.ok(scan.result.limitations.length >= 3);
  assert.ok(scan.result.limitations.some(limitation => /dynamic OpenAI Assistants API/.test(limitation.reason)));
  assert.ok(scan.result.limitations.some(limitation => /not proven to be an OpenAI client/.test(limitation.reason)));
});

test("report renders the OpenAI Impact through the local workflow", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-6-report-");
  const scan = scanTo(directory, directRepository);
  const reportPath = resolve(directory, "impact-report.html");

  runCli(["report", "--scan", scan.path, "--output", reportPath]);
  const report = readFileSync(reportPath, "utf8");

  assert.match(report, /OpenAI <code>Assistants API<\/code>/);
  assert.match(report, /It will shut down on August 26, 2026/);
  assert.match(report, /openai\.assistants/);
  assert.match(report, /src\/assistants\.ts:6/);
  assert.match(report, /Repository analysis stayed local/);
});
