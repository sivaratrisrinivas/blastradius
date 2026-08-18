import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const slackFixture = resolve(repositoryRoot, "fixtures/slack-notice.json");
const noMatchFixtureRepository = resolve(repositoryRoot, "fixtures/repository-decoys");

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

type CandidateChanges = Record<string, string | null | undefined>;
interface CollectionCandidatePaths {
  fixturePath: string;
  outputPath: string;
}

function writeCandidate(directory: string, changes: CandidateChanges): string {
  const candidate = {
    ...JSON.parse(readFileSync(slackFixture, "utf8")),
    ...changes
  };
  const fixturePath = resolve(directory, "candidate.json");
  writeFileSync(fixturePath, JSON.stringify(candidate), "utf8");
  return fixturePath;
}

function collectCandidate(directory: string, changes: CandidateChanges): CollectionCandidatePaths {
  const fixturePath = writeCandidate(directory, changes);
  const outputPath = resolve(directory, "vendor-notice.json");
  return { fixturePath, outputPath };
}

test("collection withholds candidates that fail provenance or assertion gates", () => {
  const cases = [
    {
      name: "foreign source",
      changes: { sourceUrl: "https://vendor.example/deprecation" },
      message: /allowed first-party Slack source/
    },
    {
      name: "missing lifecycle language",
      changes: { excerpt: "The files.upload method is documented on November 12, 2025." },
      message: /lifecycle-language/
    },
    {
      name: "missing capability identity",
      changes: { capabilityIdentifier: "" },
      message: /capabilityIdentifier must be a non-empty string/
    },
    {
      name: "unsupported change type",
      changes: { changeType: "breaking-change", excerpt: "The files.upload method is deprecated on November 12, 2025." },
      message: /change-type/
    }
  ];

  for (const candidateCase of cases) {
    const directory = mkdtempSync(`/tmp/blast-radius-issue-5-${candidateCase.name.replaceAll(" ", "-")}-`);
    const candidate = collectCandidate(directory, candidateCase.changes);
    const result = runCliResult(["collect", "--fixture", candidate.fixturePath, "--output", candidate.outputPath]);

    assert.notEqual(result.status, 0, candidateCase.name);
    assert.match(result.stderr, candidateCase.message, candidateCase.name);
    assert.equal(existsSync(candidate.outputPath), false, candidateCase.name);
  }
});

test("collection preserves original deadline wording and withholds precision for non-exact dates", () => {
  const cases = [
    {
      name: "exact",
      changes: {
        excerpt: "The files.upload method stopped functioning by November 12, 2025.",
        deadlineOriginal: "by November 12, 2025"
      },
      deadlineIso: "2025-11-12"
    },
    {
      name: "partial",
      changes: {
        excerpt: "The files.upload method is deprecated in November 2025.",
        changeType: "deprecation",
        deadlineOriginal: "November 2025",
        deadlineIso: null
      },
      deadlineIso: null
    },
    {
      name: "relative",
      changes: {
        excerpt: "The files.upload method will be removed in 30 days.",
        changeType: "removal",
        deadlineOriginal: "in 30 days",
        deadlineIso: null
      },
      deadlineIso: null
    },
    {
      name: "ranged",
      changes: {
        excerpt: "The files.upload method will be removed between November 12, 2025 and December 1, 2025.",
        changeType: "removal",
        deadlineOriginal: "between November 12, 2025 and December 1, 2025",
        deadlineIso: null
      },
      deadlineIso: null
    }
  ];

  for (const deadlineCase of cases) {
    const directory = mkdtempSync(`/tmp/blast-radius-issue-5-deadline-${deadlineCase.name}-`);
    const candidate = collectCandidate(directory, deadlineCase.changes);
    runCli(["collect", "--fixture", candidate.fixturePath, "--output", candidate.outputPath]);
    const artifact = JSON.parse(readFileSync(candidate.outputPath, "utf8"));

    assert.equal(artifact.capabilityChange.deadlineOriginal, deadlineCase.changes.deadlineOriginal, deadlineCase.name);
    assert.equal(artifact.capabilityChange.deadlineIso, deadlineCase.deadlineIso, deadlineCase.name);
    assert.equal(artifact.notice.excerpt, deadlineCase.changes.excerpt, deadlineCase.name);
  }
});

test("an accepted CapabilityChange with no proven CodeMatch produces no Impact", () => {
  const directory = mkdtempSync("/tmp/blast-radius-issue-5-no-match-");
  const candidate = collectCandidate(directory, {});
  runCli(["collect", "--fixture", candidate.fixturePath, "--output", candidate.outputPath]);
  const scanPath = resolve(directory, "scan-result.json");
  const output = runCli(["scan", noMatchFixtureRepository, "--collection", candidate.outputPath, "--output", scanPath]);
  const scan = JSON.parse(readFileSync(scanPath, "utf8"));

  assert.match(output, /0 proven CodeMatch/);
  assert.match(output, /No Impact: no proven CodeMatch was found/);
  assert.equal(scan.codeMatches.length, 0);
  assert.equal(scan.impact, null);
});
