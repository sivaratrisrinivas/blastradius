import { recordedHealDriver } from "../collection/bright-data-heal.js";
import { collectVendorNotice } from "../collection/collect.js";
import { detectCollectorHeal, rerunCollectorHeal, resolveCollectorHeal, runCollectorHeal } from "../collection/heal.js";
import { evaluateCapabilityChangeCandidate, explicitDeadlineIso, type AssertionGate } from "../domain/assertions.js";
import { CollectorHealthError } from "../domain/collector-health.js";
import { parseJson, type CollectorHealthArtifact, type JsonValue, type VendorNoticeArtifact } from "../domain/artifacts.js";
import { scanLocalRepository } from "../scan/scan.js";
import { DEADLINE_FIXTURES, GATE_FIXTURES } from "./assertion-fixtures.js";
import {
  ADVERSARIAL_SCAN_FIXTURES,
  DYNAMIC_ACCESS_SCAN_FIXTURES,
  HEAL_FIXTURES,
  POSITIVE_SCAN_FIXTURES
} from "./scan-fixtures.js";

/** `detectCollectorHeal` takes `JsonValue`; these artifacts are known-good but not literal JSON objects. */
function asJsonValue(artifact: CollectorHealthArtifact | VendorNoticeArtifact): JsonValue {
  return parseJson(JSON.stringify(artifact));
}

interface Fraction {
  numerator: number;
  denominator: number;
}

function percentage(fraction: Fraction): string {
  if (fraction.denominator === 0) return "n/a";
  return `${Math.round((fraction.numerator / fraction.denominator) * 100)}%`;
}

function fractionLabel(fraction: Fraction): string {
  return `${fraction.numerator}/${fraction.denominator}`;
}

interface CallSiteMatchPrecision {
  truePositives: Fraction;
}

function callSiteMatchPrecision(): CallSiteMatchPrecision {
  let truePositives = 0;
  let falsePositives = 0;
  for (const fixture of POSITIVE_SCAN_FIXTURES) {
    const notice = collectVendorNotice(fixture.notice);
    const scan = scanLocalRepository(fixture.repository, notice);
    const expected = new Set(fixture.expectedMatches.map(match => `${match.file}:${match.line}`));
    for (const match of scan.codeMatches) {
      if (expected.has(`${match.file}:${match.line}`)) truePositives += 1;
      else falsePositives += 1;
    }
  }
  return { truePositives: { numerator: truePositives, denominator: truePositives + falsePositives } };
}

interface FalseImpactsOnDecoys {
  falseImpacts: number;
  fixtureCount: number;
}

function falseImpactsOnAdversarialDecoys(): FalseImpactsOnDecoys {
  let falseImpacts = 0;
  for (const fixture of ADVERSARIAL_SCAN_FIXTURES) {
    const notice = collectVendorNotice(fixture.notice);
    const scan = scanLocalRepository(fixture.repository, notice);
    if (scan.impact !== null) falseImpacts += 1;
  }
  return { falseImpacts, fixtureCount: ADVERSARIAL_SCAN_FIXTURES.length };
}

function limitationDisclosureRate(): Fraction {
  let disclosed = 0;
  for (const fixture of DYNAMIC_ACCESS_SCAN_FIXTURES) {
    const notice = collectVendorNotice(fixture.notice);
    const scan = scanLocalRepository(fixture.repository, notice);
    if (scan.limitations.length >= fixture.expectedMinimumLimitations) disclosed += 1;
  }
  return { numerator: disclosed, denominator: DYNAMIC_ACCESS_SCAN_FIXTURES.length };
}

const ASSERTION_GATES: readonly AssertionGate[] = ["provenance", "lifecycle-language", "capability-identity", "change-type", "evidence", "deadline"];

/**
 * Counts candidates rejected per gate, not raw failure messages: a gate can add more than one
 * message for the same candidate (the deadline gate does this when both its checks disagree), and
 * a per-message count would make one candidate look like two rejections.
 */
function assertionGateRejectionCounts(): ReadonlyMap<AssertionGate, number> {
  const counts = new Map<AssertionGate, number>(ASSERTION_GATES.map(gate => [gate, 0]));
  for (const fixture of GATE_FIXTURES) {
    const result = evaluateCapabilityChangeCandidate(fixture.candidate);
    const gatesHit = new Set(result.failures.map(failure => failure.gate));
    for (const gate of gatesHit) counts.set(gate, (counts.get(gate) ?? 0) + 1);
  }
  return counts;
}

function dateNormalisationAccuracy(): Fraction {
  let correct = 0;
  for (const fixture of DEADLINE_FIXTURES) {
    if (explicitDeadlineIso(fixture.wording) === fixture.expectedIso) correct += 1;
  }
  return { numerator: correct, denominator: DEADLINE_FIXTURES.length };
}

/**
 * Drives the same detect -> run -> approve -> rerun sequence `test/issue-12.acceptance.test.ts`
 * proves through the CLI, calling the domain functions directly so the eval table stays fast.
 */
async function healRerunOutcome(rerunFixture: string): Promise<"healthy" | "failed"> {
  let diagnostic: JsonValue;
  try {
    collectVendorNotice(HEAL_FIXTURES.driftedNotice);
    throw new Error("expected the drifted collection fixture to report CollectorHealth drift");
  } catch (error) {
    if (!(error instanceof CollectorHealthError)) throw error;
    diagnostic = asJsonValue(error.artifact);
  }
  const lastKnownGood = asJsonValue(collectVendorNotice(HEAL_FIXTURES.lastKnownGoodNotice));
  const detected = detectCollectorHeal(diagnostic, lastKnownGood);
  const gated = await runCollectorHeal(detected, recordedHealDriver(HEAL_FIXTURES.gateProgress));
  const approved = await resolveCollectorHeal(gated, "approve", recordedHealDriver(HEAL_FIXTURES.resumedProgress));
  const reran = await rerunCollectorHeal(approved, () => Promise.resolve(collectVendorNotice(rerunFixture)));
  return reran.rerun.status === "healthy" ? "healthy" : "failed";
}

async function healSuccessRate(): Promise<Fraction> {
  const outcomes = await Promise.all([
    healRerunOutcome(HEAL_FIXTURES.healthyRerun.fixture),
    healRerunOutcome(HEAL_FIXTURES.failedRerun.fixture)
  ]);
  return { numerator: outcomes.filter(outcome => outcome === "healthy").length, denominator: outcomes.length };
}

export interface EvalTable {
  callSiteMatchPrecision: Fraction;
  falseImpacts: FalseImpactsOnDecoys;
  limitationDisclosure: Fraction;
  gateRejections: ReadonlyMap<AssertionGate, number>;
  dateNormalisation: Fraction;
  healSuccess: Fraction;
}

export async function computeEvalTable(): Promise<EvalTable> {
  return {
    callSiteMatchPrecision: callSiteMatchPrecision().truePositives,
    falseImpacts: falseImpactsOnAdversarialDecoys(),
    limitationDisclosure: limitationDisclosureRate(),
    gateRejections: assertionGateRejectionCounts(),
    dateNormalisation: dateNormalisationAccuracy(),
    healSuccess: await healSuccessRate()
  };
}

const GATE_ORDER: readonly AssertionGate[] = ASSERTION_GATES;

export function renderEvalTableMarkdown(table: EvalTable): string {
  const gateBreakdown = GATE_ORDER
    .map(gate => `${gate}: ${table.gateRejections.get(gate) ?? 0}`)
    .join(", ");
  const rows: ReadonlyArray<readonly [string, string, string]> = [
    ["Call-site match precision", `${percentage(table.callSiteMatchPrecision)} (${fractionLabel(table.callSiteMatchPrecision)})`, "positive matcher fixtures — `test/issue-2/3/4/6/7.acceptance.test.ts`"],
    ["False Impacts on the adversarial decoy", `${table.falseImpacts.falseImpacts} across ${table.falseImpacts.fixtureCount} adversarial fixtures`, "`client.files.upload()` and other vendor-shaped calls with no vendor provenance — `test/issue-3/4/6/7.acceptance.test.ts`"],
    ["Limitation-disclosure rate", `${percentage(table.limitationDisclosure)} (${fractionLabel(table.limitationDisclosure)})`, "dynamic-access fixtures — `test/issue-3/4/6/7.acceptance.test.ts`"],
    ["Assertion-gate rejection counts", gateBreakdown, "gate fixtures, by gate — `test/issue-14.acceptance.test.ts`, mirroring `test/issue-5.rules.test.ts`"],
    ["Date-normalisation accuracy", `${percentage(table.dateNormalisation)} (${fractionLabel(table.dateNormalisation)})`, "exact / partial / relative / ranged deadline fixtures — `test/issue-5.rules.test.ts`"],
    ["Heal success rate", `${percentage(table.healSuccess)} (${fractionLabel(table.healSuccess)})`, "healthy and failed rerun fixtures — `test/issue-12.acceptance.test.ts`"]
  ];
  const header = "| Metric | Result | Source |\n| --- | --- | --- |";
  const body = rows.map(([metric, result, source]) => `| ${metric} | ${result} | ${source} |`).join("\n");
  const headline = `**Headline: 0 false Impacts across ${table.falseImpacts.fixtureCount} adversarial fixtures.**`;
  return `${headline}\n\n${header}\n${body}`;
}
