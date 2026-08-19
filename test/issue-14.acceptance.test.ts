import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { evaluateCapabilityChangeCandidate, explicitDeadlineIso } from "../src/domain/assertions.js";
import { scanLocalRepository } from "../src/scan/scan.js";
import { collectVendorNotice } from "../src/collection/collect.js";
import { DEADLINE_FIXTURES, GATE_FIXTURES } from "../src/metrics/assertion-fixtures.js";
import {
  ADVERSARIAL_SCAN_FIXTURES,
  DYNAMIC_ACCESS_SCAN_FIXTURES,
  POSITIVE_SCAN_FIXTURES
} from "../src/metrics/scan-fixtures.js";
import { computeEvalTable, renderEvalTableMarkdown } from "../src/metrics/eval-table.js";
import { spliceEvalTable } from "../src/metrics/generate.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const readmePath = resolve(repositoryRoot, "README.md");

test("every gate fixture is rejected by the gate it names", () => {
  for (const fixture of GATE_FIXTURES) {
    const result = evaluateCapabilityChangeCandidate(fixture.candidate);
    assert.equal(result.accepted, false, `${fixture.gate} candidate (${fixture.description}) was unexpectedly accepted`);
    assert.ok(
      result.failures.some(failure => failure.gate === fixture.gate),
      `${fixture.gate} candidate (${fixture.description}) did not fail the ${fixture.gate} gate; failures were ${JSON.stringify(result.failures)}`
    );
  }
});

test("every deadline fixture normalises the way its category promises", () => {
  for (const fixture of DEADLINE_FIXTURES) {
    assert.equal(
      explicitDeadlineIso(fixture.wording),
      fixture.expectedIso,
      `"${fixture.wording}" (${fixture.category}) did not normalise to ${JSON.stringify(fixture.expectedIso)}`
    );
  }
});

test("every positive scan fixture produces exactly its expected CodeMatches and nothing else", () => {
  for (const fixture of POSITIVE_SCAN_FIXTURES) {
    const notice = collectVendorNotice(fixture.notice);
    const scan = scanLocalRepository(fixture.repository, notice);
    const actual = scan.codeMatches.map(match => `${match.file}:${match.line}`).sort();
    const expected = fixture.expectedMatches.map(match => `${match.file}:${match.line}`).sort();
    assert.deepEqual(actual, expected, `${fixture.description} (${fixture.provenBy}) produced unexpected matches`);
  }
});

test("every adversarial fixture produces no Impact", () => {
  for (const fixture of ADVERSARIAL_SCAN_FIXTURES) {
    const notice = collectVendorNotice(fixture.notice);
    const scan = scanLocalRepository(fixture.repository, notice);
    assert.equal(scan.impact, null, `${fixture.description} (${fixture.provenBy}) unexpectedly produced an Impact`);
  }
});

test("every dynamic-access fixture discloses at least its expected number of limitations", () => {
  for (const fixture of DYNAMIC_ACCESS_SCAN_FIXTURES) {
    const notice = collectVendorNotice(fixture.notice);
    const scan = scanLocalRepository(fixture.repository, notice);
    assert.ok(
      scan.limitations.length >= fixture.expectedMinimumLimitations,
      `${fixture.description} (${fixture.provenBy}) disclosed ${scan.limitations.length} limitation(s), expected at least ${fixture.expectedMinimumLimitations}`
    );
  }
});

test("the headline invariant holds: zero false Impacts across every adversarial fixture", async () => {
  const table = await computeEvalTable();
  assert.equal(table.falseImpacts.falseImpacts, 0);
  assert.ok(table.falseImpacts.fixtureCount > 0);
});

test("the README eval table is generated from the suite, not typed by hand", async () => {
  const table = await computeEvalTable();
  const expectedMarkdown = renderEvalTableMarkdown(table);
  const readme = readFileSync(readmePath, "utf8");
  const regenerated = spliceEvalTable(readme, expectedMarkdown);

  assert.equal(readme, regenerated, "README.md eval table is out of date; run `npm run metrics` to regenerate it");
});
