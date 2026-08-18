import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCapabilityChangeCandidate, type CapabilityChangeCandidate } from "../src/domain/assertions.js";
import { deadlineStatus, renderImpactReport } from "../src/report/render.js";

const validCandidate: CapabilityChangeCandidate = {
  vendor: "Slack",
  sourceUrl: "https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/",
  retrievedAt: "2026-08-18T00:00:00Z",
  excerpt: "The files.upload method stopped functioning on November 12, 2025.",
  capabilityIdentifier: "slack.files.upload",
  changeType: "shutdown",
  deadlineOriginal: "November 12, 2025",
  deadlineIso: "2025-11-12"
};

test("assertion gates accept and retain a valid CapabilityChange candidate", () => {
  const result = evaluateCapabilityChangeCandidate(validCandidate);

  assert.equal(result.accepted, true);
  assert.deepEqual(result.candidate, validCandidate);
  assert.deepEqual(result.failures, []);
});

test("assertion gates retain a rejected candidate for diagnostic review without accepting it", () => {
  const candidate = {
    ...validCandidate,
    excerpt: "The files.upload method is documented on November 12, 2025.",
    changeType: "breaking-change"
  };

  const result = evaluateCapabilityChangeCandidate(candidate);

  assert.equal(result.accepted, false);
  assert.deepEqual(result.candidate, candidate);
  assert.ok(result.failures.some(failure => failure.gate === "lifecycle-language"));
  assert.ok(result.failures.some(failure => failure.gate === "change-type"));
});

test("assertion gates reject unproven source and unnamed capability", () => {
  const foreignSource = evaluateCapabilityChangeCandidate({
    ...validCandidate,
    sourceUrl: "https://vendor.example/deprecation"
  });
  const unnamedCapability = evaluateCapabilityChangeCandidate({
    ...validCandidate,
    capabilityIdentifier: ""
  });

  assert.equal(foreignSource.accepted, false);
  assert.ok(foreignSource.failures.some(failure => failure.gate === "provenance"));
  assert.equal(unnamedCapability.accepted, false);
  assert.ok(unnamedCapability.failures.some(failure => failure.gate === "capability-identity"));
});

test("assertion gates reject lifecycle language that is not tied to the named capability", () => {
  const result = evaluateCapabilityChangeCandidate({
    ...validCandidate,
    excerpt: "The files.upload method remains available while the unrelated API is deprecated on November 12, 2025."
  });

  assert.equal(result.accepted, false);
  assert.ok(result.failures.some(failure => failure.gate === "lifecycle-language"));
});

test("deadline gates preserve exact wording and withhold invented precision", () => {
  const exact = evaluateCapabilityChangeCandidate({
    ...validCandidate,
    excerpt: "The files.upload method stopped functioning by November 12, 2025.",
    deadlineOriginal: "by November 12, 2025"
  });
  const partial = evaluateCapabilityChangeCandidate({
    ...validCandidate,
    excerpt: "The files.upload method is deprecated in November 2025.",
    changeType: "deprecation",
    deadlineOriginal: "November 2025",
    deadlineIso: null
  });
  const relative = evaluateCapabilityChangeCandidate({
    ...validCandidate,
    excerpt: "The files.upload method will be removed in 30 days.",
    changeType: "removal",
    deadlineOriginal: "in 30 days",
    deadlineIso: null
  });
  const ranged = evaluateCapabilityChangeCandidate({
    ...validCandidate,
    excerpt: "The files.upload method will be removed between November 12, 2025 and December 1, 2025.",
    changeType: "removal",
    deadlineOriginal: "between November 12, 2025 and December 1, 2025",
    deadlineIso: null
  });
  const qualified = evaluateCapabilityChangeCandidate({
    ...validCandidate,
    excerpt: "The files.upload method will be removed after November 12, 2025.",
    changeType: "removal",
    deadlineOriginal: "after November 12, 2025",
    deadlineIso: null
  });

  assert.equal(exact.accepted, true);
  assert.equal(exact.candidate.deadlineOriginal, "by November 12, 2025");
  assert.equal(partial.accepted, true);
  assert.equal(relative.accepted, true);
  assert.equal(ranged.accepted, true);
  assert.equal(qualified.accepted, true);
});

test("deadline status uses only the injected report-time clock", () => {
  assert.equal(deadlineStatus("2026-08-19", new Date("2026-08-18T23:59:59Z")), "upcoming");
  assert.equal(deadlineStatus("2026-08-18", new Date("2026-08-18T00:00:00Z")), "upcoming");
  assert.equal(deadlineStatus("2026-08-17", new Date("2026-08-18T00:00:00Z")), "past");
  assert.equal(deadlineStatus(null, new Date("2026-08-18T00:00:00Z")), "date-not-stated");
});

test("rendered reports use the injected clock for deadline status", () => {
  const reportInput = (deadlineOriginal: string, deadlineIso: string | null, excerpt: string) => JSON.parse(JSON.stringify({
    schemaVersion: 1,
    kind: "scan-result",
    notice: {
      vendor: "Slack",
      sourceUrl: validCandidate.sourceUrl,
      retrievedAt: validCandidate.retrievedAt,
      excerpt
    },
    capabilityChange: {
      vendor: "Slack",
      canonicalIdentifier: "slack.files.upload",
      changeType: "shutdown",
      deadlineOriginal,
      deadlineIso
    },
    codeMatches: [{
      vendor: "Slack",
      capabilityIdentifier: "slack.files.upload",
      file: "src/slack-upload.ts",
      line: 6,
      evidenceStrength: "direct",
      context: "source",
      evidence: "return slack.files.upload({ channels: channel, file });"
    }],
    limitations: [],
    impact: {
      capabilityChange: {
        vendor: "Slack",
        canonicalIdentifier: "slack.files.upload",
        changeType: "shutdown",
        deadlineOriginal,
        deadlineIso
      },
      codeMatches: [{
        vendor: "Slack",
        capabilityIdentifier: "slack.files.upload",
        file: "src/slack-upload.ts",
        line: 6,
        evidenceStrength: "direct",
        context: "source",
        evidence: "return slack.files.upload({ channels: channel, file });"
      }]
    }
  }));

  assert.match(renderImpactReport(reportInput("August 19, 2026", "2026-08-19", "The files.upload method stopped functioning on August 19, 2026."), new Date("2026-08-18T00:00:00Z")), /<strong>upcoming<\/strong>/);
  assert.match(renderImpactReport(reportInput("August 17, 2026", "2026-08-17", "The files.upload method stopped functioning on August 17, 2026."), new Date("2026-08-18T00:00:00Z")), /<strong>past<\/strong>/);
  assert.match(renderImpactReport(reportInput("in 30 days", null, "The files.upload method stopped functioning in 30 days."), new Date("2026-08-18T00:00:00Z")), /<strong>date-not-stated<\/strong>/);
});
