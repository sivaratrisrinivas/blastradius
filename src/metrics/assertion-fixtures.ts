import type { AssertionGate, CapabilityChangeCandidate } from "../domain/assertions.js";

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

/**
 * One candidate per assertion gate, each crafted to fail exactly that gate (or, where a gate's
 * check is coupled to another, to fail the pair the same way a real drifted extraction would).
 * `test/issue-14.acceptance.test.ts` proves every candidate hits the gate it names; the eval table
 * counts the same rejections by running `evaluateCapabilityChangeCandidate` over this list.
 */
export interface GateFixture {
  gate: AssertionGate;
  description: string;
  candidate: CapabilityChangeCandidate;
}

export const GATE_FIXTURES: readonly GateFixture[] = [
  {
    gate: "provenance",
    description: "source URL outside the curated first-party allowlist",
    candidate: { ...validCandidate, sourceUrl: "https://vendor.example/deprecation" }
  },
  {
    gate: "lifecycle-language",
    description: "capability named but lifecycle language ties to something else",
    candidate: {
      ...validCandidate,
      excerpt: "The files.upload method remains available while the unrelated API is deprecated on November 12, 2025."
    }
  },
  {
    gate: "capability-identity",
    description: "candidate does not name a curated capability identifier",
    candidate: { ...validCandidate, capabilityIdentifier: "" }
  },
  {
    gate: "change-type",
    description: "change type outside deprecation, sunset, shutdown, or removal",
    candidate: { ...validCandidate, changeType: "breaking-change" }
  },
  {
    gate: "evidence",
    description: "excerpt is empty",
    candidate: { ...validCandidate, excerpt: "" }
  },
  {
    gate: "deadline",
    description: "deadlineIso does not match the explicit date in the original wording",
    candidate: { ...validCandidate, deadlineIso: "2025-01-01" }
  }
];

export type DeadlineCategory = "exact" | "partial" | "relative" | "ranged";

/**
 * Deadline wordings the assertion gate already normalises in `test/issue-5.rules.test.ts`. The
 * eval table re-runs `explicitDeadlineIso` over the same wordings and checks the result against
 * `expectedIso` rather than trusting a stored accuracy figure.
 */
export interface DeadlineFixture {
  category: DeadlineCategory;
  wording: string;
  expectedIso: string | null;
}

export const DEADLINE_FIXTURES: readonly DeadlineFixture[] = [
  { category: "exact", wording: "November 12, 2025", expectedIso: "2025-11-12" },
  { category: "exact", wording: "by November 12, 2025", expectedIso: "2025-11-12" },
  { category: "partial", wording: "November 2025", expectedIso: null },
  { category: "relative", wording: "in 30 days", expectedIso: null },
  { category: "ranged", wording: "between November 12, 2025 and December 1, 2025", expectedIso: null },
  { category: "ranged", wording: "after November 12, 2025", expectedIso: null }
];
