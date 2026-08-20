import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkLocalRepository, impactedChecks, limitationCount, repositoryCheckArtifact } from "../src/check/check.js";
import { collectVendorNotice } from "../src/collection/collect.js";
import { assertScanArtifact, isRecord, parseJson } from "../src/domain/artifacts.js";
import { capabilitiesProvable, curatedCapabilities, curatedVendorCount } from "../src/domain/capabilities.js";
import { bundledPath } from "../src/package-root.js";
import { daysUntilDeadline, deadlineStatus } from "../src/report/render.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const cliPath = resolve(repositoryRoot, "dist/src/cli.js");
const multiVendorRepository = resolve(repositoryRoot, "fixtures/repository-multi-vendor");
const openAIRepository = resolve(repositoryRoot, "fixtures/repository-openai");
const cleanRepository = resolve(repositoryRoot, "fixtures/repository-clean");
const unsupportedRepository = resolve(repositoryRoot, "fixtures/repository-openai-unsupported");

/** Every `check` run is spawned from a temporary directory: bundled fixtures must not need the CWD. */
function runCheck(args: string[]) {
  return spawnSync(process.execPath, [cliPath, "check", ...args], {
    cwd: mkdtempSync(resolve(tmpdir(), "blast-check-cwd-")),
    encoding: "utf8"
  });
}

function temporaryDirectory(): string {
  return mkdtempSync(resolve(tmpdir(), "blast-check-"));
}

/** The countdown the CLI must print for a deadline, decided by the same clock the CLI uses. */
function expectedCountdown(deadlineIso: string, now: Date): string {
  if (deadlineStatus(deadlineIso, now) !== "upcoming") return "";
  const days = daysUntilDeadline(deadlineIso, now);
  if (days === 0) return ", due today";
  return `, ${days} day${days === 1 ? "" : "s"} remaining`;
}

test("the countdown shares deadlineStatus's injected-clock UTC convention", () => {
  assert.equal(daysUntilDeadline("2026-08-26", new Date("2026-08-20T00:00:00.000Z")), 6);
  assert.equal(daysUntilDeadline("2026-08-26", new Date("2026-08-20T23:59:59.000Z")), 6);
  assert.equal(daysUntilDeadline("2026-08-26", new Date("2026-08-26T13:00:00.000Z")), 0);
  assert.equal(daysUntilDeadline("2025-11-12", new Date("2026-08-20T00:00:00.000Z")), -281);
  assert.equal(daysUntilDeadline(null, new Date("2026-08-20T00:00:00.000Z")), null);

  const onTheDay = new Date("2026-08-26T13:00:00.000Z");
  assert.equal(deadlineStatus("2026-08-26", onTheDay), "upcoming");
  assert.equal(daysUntilDeadline("2026-08-26", onTheDay), 0);
});

test("every matched capability is collected from a bundled fixture that names it", () => {
  for (const capability of curatedCapabilities()) {
    const notice = collectVendorNotice(bundledPath(capability.noticeFixture));
    assert.equal(notice.capabilityChange.vendor, capability.vendor);
    assert.ok(
      capability.acceptedIdentifiers.includes(notice.capabilityChange.canonicalIdentifier),
      `${capability.noticeFixture} does not collect ${capability.canonicalIdentifier}`
    );
  }
});

test("one run scans every matched capability and no watched vendor", () => {
  const check = checkLocalRepository(openAIRepository);
  assert.equal(check.checks.length, capabilitiesProvable());
  assert.ok(capabilitiesProvable() < curatedVendorCount(), "watched vendors outnumber matched capabilities");
  assert.deepEqual(
    check.checks.map(entry => entry.capability.vendor),
    curatedCapabilities().map(capability => capability.vendor)
  );
  for (const entry of check.checks) {
    assert.notEqual(entry.capability.matcher, null, `${entry.capability.vendor} was scanned without a matcher`);
  }
  assert.equal(impactedChecks(check).length, 1);
});

test("every Impact in a multi-vendor repository is reported, never only the first", () => {
  const check = checkLocalRepository(multiVendorRepository);
  const impacted = impactedChecks(check);
  assert.equal(impacted.length, capabilitiesProvable());

  const result = runCheck([multiVendorRepository]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /3 capabilities checked, 3 Impacts found\./);
  for (const entry of impacted) {
    assert.ok(
      result.stdout.includes(`Impact: ${entry.capability.reportLabel} (${entry.scan.capabilityChange.canonicalIdentifier})`),
      `${entry.capability.reportLabel} was missing from the summary`
    );
    for (const match of entry.scan.impact?.codeMatches ?? []) {
      assert.ok(result.stdout.includes(`${match.file}:${match.line}: ${match.evidence}`), `${match.file}:${match.line} was missing its evidence line`);
    }
    assert.ok(result.stdout.includes(entry.scan.notice.excerpt), `${entry.capability.vendor}'s own excerpt was missing`);
  }
});

test("the demo command prints a dated countdown for an upcoming deadline from any directory", () => {
  const now = new Date();
  const result = runCheck([openAIRepository]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("Impact: OpenAI Assistants API (openai.assistants)"));
  assert.ok(result.stdout.includes("src/assistants.ts:6"));
  assert.ok(
    result.stdout.includes(`Deadline: August 26, 2026 (2026-08-26)${expectedCountdown("2026-08-26", now)}`),
    `deadline line did not carry the expected countdown:\n${result.stdout}`
  );
});

test("a repository with no vendor usage reports zero Impacts and exits 0", () => {
  const result = runCheck([cleanRepository]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 Impacts found\./);
  assert.ok(result.stdout.includes("No Impact: no proven CodeMatch was found for any matched capability."));
  assert.ok(!result.stdout.includes("\nImpact:"), "a repository with no vendor usage must not report an Impact");
  assert.ok(result.stdout.includes("Analysis Limitations: none."));
});

test("Analysis Limitations are disclosed and never counted as Impacts", () => {
  const check = checkLocalRepository(unsupportedRepository);
  assert.equal(impactedChecks(check).length, 0);
  assert.ok(limitationCount(check) > 0);

  const result = runCheck([unsupportedRepository]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 Impacts found\./);
  assert.ok(result.stdout.includes(`Analysis Limitations (${limitationCount(check)} disclosed, none counted as an Impact):`));
  for (const entry of check.checks) {
    for (const limitation of entry.scan.limitations) {
      assert.ok(result.stdout.includes(`${limitation.file}:${limitation.line}: ${limitation.reason}`), `${limitation.file}:${limitation.line} was not disclosed`);
    }
  }
});

test("the coverage line names both numbers and the privacy line is always printed", () => {
  const result = runCheck([multiVendorRepository]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Coverage: ${curatedVendorCount()} vendors watched, ${capabilitiesProvable()} capabilities provable.`));
  assert.ok(result.stdout.includes("Privacy: Repository analysis stayed local"));
});

test("--report-dir writes one Impact Report per impacted capability, and none without an Impact", () => {
  const impactedDirectory = temporaryDirectory();
  const impacted = runCheck([multiVendorRepository, "--report-dir", impactedDirectory]);
  assert.equal(impacted.status, 0, impacted.stderr);
  const written = readdirSync(impactedDirectory).sort();
  assert.equal(written.length, capabilitiesProvable());
  for (const file of written) {
    const reportPath = resolve(impactedDirectory, file);
    assert.ok(impacted.stdout.includes(`Impact Report: ${reportPath}`), `${reportPath} was written without being reported`);
    assert.ok(readFileSync(reportPath, "utf8").includes("Confirmed Impact"));
  }

  const emptyDirectory = temporaryDirectory();
  const clean = runCheck([cleanRepository, "--report-dir", emptyDirectory]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.deepEqual(readdirSync(emptyDirectory), []);
  assert.ok(clean.stdout.includes("No Impact, so no Impact Report was written."));
});

test("--output writes one combined artifact holding every scan of the run", () => {
  const outputPath = resolve(temporaryDirectory(), "combined.json");
  const result = runCheck([multiVendorRepository, "--output", outputPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Combined scan artifact: ${outputPath}`));

  const stored = parseJson(readFileSync(outputPath, "utf8"));
  assert.ok(isRecord(stored));
  assert.equal(stored.kind, "repository-check");
  assert.equal(stored.capabilitiesChecked, capabilitiesProvable());
  assert.equal(stored.vendorsWatched, curatedVendorCount());
  assert.equal(stored.impactCount, capabilitiesProvable());
  assert.ok(Array.isArray(stored.scans));
  assert.equal(stored.scans.length, capabilitiesProvable());
  for (const scan of stored.scans) assert.ok(assertScanArtifact(scan).impact !== null);

  const expected = repositoryCheckArtifact(checkLocalRepository(multiVendorRepository));
  assert.equal(stored.filesScanned, expected.filesScanned);
  assert.equal(stored.limitationCount, expected.limitationCount);
});
